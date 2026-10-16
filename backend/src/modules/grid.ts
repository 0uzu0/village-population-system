import { Router, Request, Response } from 'express';
import { query, queryOne, execute, withTransaction } from '../config/db';
import { authMiddleware } from '../middleware/auth';
import { requirePermission, buildGridFilter } from '../middleware/rbac';
import { ok, okPage, fail, AppError, PageResult } from '../utils/response';
import { writeAudit } from '../middleware/audit';
import { z } from 'zod';

const router = Router();
router.use(authMiddleware);

const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(20),
  keyword: z.string().optional(),
});

/**
 * 重点人群统计口径：展示字段 -> 标签编码（编码取自 V002 种子数据的 tag_definition）
 * 党员含正式党员与预备党员；五保沿用现名「特困供养对象」。
 */
const FOCUS_TAGS: { field: string; codes: string[] }[] = [
  { field: 'party_count', codes: ['PARTY_MEMBER', 'PARTY_PROBATIONARY'] },
  { field: 'disabled_count', codes: ['DISABLED_PERSON'] },
  { field: 'extreme_poverty_count', codes: ['EXTREME_POVERTY_PERSON'] },
  { field: 'low_income_count', codes: ['LOW_INCOME_PERSON'] },
  { field: 'veteran_count', codes: ['VETERAN'] },
  { field: 'preferential_count', codes: ['PREFERENTIAL_OBJECT'] },
];

const PERSON_ACTIVE = "p_.status IN ('NORMAL','MOVED_IN')";

/**
 * 生成「按标签编码统计人数」的子查询列。
 * 标签编码为代码内常量，直接拼入 SQL，不使用占位符，避免与主查询参数错位。
 */
function focusTagSelects(personMatch: string): string {
  return FOCUS_TAGS.map(
    ({ field, codes }) =>
      `(SELECT COUNT(DISTINCT pt.person_id) FROM person_tag pt
          JOIN tag_definition td ON td.id = pt.tag_id
          JOIN person p_ ON p_.id = pt.person_id
        WHERE td.code IN (${codes.map((c) => `'${c}'`).join(',')})
          AND pt.status = 'ACTIVE'
          AND ${personMatch}
          AND ${PERSON_ACTIVE}) AS ${field}`
  ).join(', ');
}

/** 网格列表（含人口数、家庭数与重点人群统计） */
router.get('/', requirePermission('grid:view'), async (req: Request, res: Response) => {
  const q = listSchema.parse(req.query);
  const where: string[] = ['1=1'];
  const params: any[] = [];
  if (q.keyword) {
    where.push('(g.name LIKE ? OR g.grid_no LIKE ?)');
    params.push(`%${q.keyword}%`, `%${q.keyword}%`);
  }
  const gridFilter = buildGridFilter(req, 'g.id');
  if (gridFilter.where) {
    where.push(gridFilter.where.replace(/^ AND /, ''));
    params.push(...gridFilter.params);
  }

  const whereSql = where.join(' AND ');
  const totalRow = await queryOne<any>(`SELECT COUNT(*) AS cnt FROM grid g WHERE ${whereSql}`, params);
  const total = Number(totalRow?.cnt || 0);

  const rows = await query<any>(
    `SELECT g.*,
       (SELECT COUNT(*) FROM person p WHERE p.grid_id = g.id AND p.status IN ('NORMAL','MOVED_IN')) AS person_count,
       (SELECT COUNT(*) FROM family f WHERE f.grid_id = g.id AND f.status = 1) AS family_count,
       ${focusTagSelects('p_.grid_id = g.id')}
     FROM grid g WHERE ${whereSql} ORDER BY g.id LIMIT ? OFFSET ?`,
    [...params, q.pageSize, (q.page - 1) * q.pageSize]
  );
  const result: PageResult<any> = { list: rows, total, page: q.page, pageSize: q.pageSize };
  return okPage(res, result);
});

/**
 * 村庄（小村庄）维度统计。
 * 村庄名取自 person.village（导入时由户籍地址推导，如艾园村、仓门口村）。
 * 家庭数按「该村庄有成员的在册家庭」统计（family 表无 village 列，故由成员反查）。
 * 负责人 / 手机号来自 village_contact（V012），村庄维度下可编辑。
 */
router.get('/villages', requirePermission('grid:view'), async (req: Request, res: Response) => {
  const q = z.object({ keyword: z.string().optional() }).parse(req.query);
  const where: string[] = ["p.village IS NOT NULL", "p.village <> ''", "p.status IN ('NORMAL','MOVED_IN')"];
  const params: any[] = [];

  if (q.keyword) {
    where.push('p.village LIKE ?');
    params.push(`%${q.keyword}%`);
  }
  const gridFilter = buildGridFilter(req, 'p.grid_id');
  if (gridFilter.where) {
    where.push(gridFilter.where.replace(/^ AND /, ''));
    params.push(...gridFilter.params);
  }
  const whereSql = where.join(' AND ');

  const rows = await query<any>(
    `SELECT p.village AS name,
       vc.manager,
       vc.phone,
       COUNT(*) AS person_count,
       (SELECT COUNT(DISTINCT fm.family_id) FROM family_member fm
          JOIN person pf ON pf.id = fm.person_id
        WHERE pf.village = p.village AND pf.status IN ('NORMAL','MOVED_IN')) AS family_count,
       (SELECT GROUP_CONCAT(DISTINCT g.name ORDER BY g.id SEPARATOR '、')
          FROM grid g
         WHERE g.id IN (SELECT DISTINCT pg.grid_id FROM person pg
                         WHERE pg.village = p.village AND pg.grid_id IS NOT NULL)) AS grid_names,
       ${focusTagSelects('p_.village = p.village')}
     FROM person p
     LEFT JOIN village_contact vc ON vc.village_name = p.village
     WHERE ${whereSql}
     GROUP BY p.village, vc.manager, vc.phone
     ORDER BY person_count DESC, p.village ASC`
  );

  return ok(res, { list: rows, total: rows.length }, `共 ${rows.length} 个村庄`);
});

/** 村庄联系人字段（可空字符串用 nullable().optional()：编辑态后端可能回 null） */
export const villageContactSchema = z.object({
  villageName: z.string().min(1, '村庄名必填').max(128),
  manager: z.string().max(64).nullable().optional(),
  phone: z.string().max(20).nullable().optional(),
});

/**
 * 保存村庄负责人 / 手机号（落库到 village_contact，V012）。
 * - 村庄必须仍存在于人员档案中（且在当前用户的数据范围内），避免写出无主记录；
 * - 负责人与手机号同时为空时删除该行，回到「未维护」状态（无残留空记录）。
 */
router.put('/villages/contact', requirePermission('grid:manage'), async (req: Request, res: Response) => {
  const body = villageContactSchema.parse(req.body);
  const village = body.villageName.trim();
  const manager = (body.manager || '').trim();
  const phone = (body.phone || '').trim();

  const conds: string[] = ['p.village = ?'];
  const params: any[] = [village];
  const gridFilter = buildGridFilter(req, 'p.grid_id');
  if (gridFilter.where) {
    conds.push(gridFilter.where.replace(/^ AND /, ''));
    params.push(...gridFilter.params);
  }
  const exists = await queryOne<any>(`SELECT 1 AS ok FROM person p WHERE ${conds.join(' AND ')} LIMIT 1`, params);
  if (!exists) throw new AppError('村庄不存在或不在你的数据范围内', 404, 'VILLAGE_NOT_FOUND');

  if (!manager && !phone) {
    await execute('DELETE FROM village_contact WHERE village_name = ?', [village]);
  } else {
    await execute(
      `INSERT INTO village_contact (village_name, manager, phone, created_by, updated_by)
       VALUES (?,?,?,?,?)
       ON DUPLICATE KEY UPDATE manager = VALUES(manager), phone = VALUES(phone), updated_by = VALUES(updated_by)`,
      [village, manager || null, phone || null, req.user!.id, req.user!.id]
    );
  }

  await writeAudit({
    userId: req.user!.id,
    username: req.user!.username,
    action: 'village:save_contact',
    request: { village, manager, phone },
    result: 'SUCCESS',
    ip: req.ip,
  });
  return ok(res, { villageName: village, manager: manager || null, phone: phone || null }, '已保存');
});

/** 删除网格（物理删除；若网格下仍有人口/家庭则拒绝，需先转移或删除） */
router.delete('/:id', requirePermission('grid:manage'), async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const grid = await queryOne<any>('SELECT id, name FROM grid WHERE id = ?', [id]);
  if (!grid) throw new AppError('网格不存在', 404, 'NOT_FOUND');

  const personCount = Number(
    (await queryOne<any>("SELECT COUNT(*) AS cnt FROM person WHERE grid_id = ? AND status IN ('NORMAL','MOVED_IN')", [id]))?.cnt || 0
  );
  const familyCount = Number(
    (await queryOne<any>('SELECT COUNT(*) AS cnt FROM family WHERE grid_id = ? AND status = 1', [id]))?.cnt || 0
  );
  if (personCount > 0 || familyCount > 0) {
    throw new AppError(
      `网格「${grid.name}」下仍有 ${personCount} 名在册人员、${familyCount} 户家庭，请先转移或删除后再删除网格`,
      409,
      'GRID_IN_USE'
    );
  }

  await execute('DELETE FROM grid WHERE id = ?', [id]);
  await writeAudit({
    userId: req.user!.id,
    username: req.user!.username,
    action: 'grid:delete',
    request: { id, name: grid.name },
    result: 'SUCCESS',
    ip: req.ip,
  });
  return ok(res, { id }, '网格已删除');
});

/** 网格详情 */
router.get('/:id', requirePermission('grid:view'), async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const row = await queryOne<any>('SELECT * FROM grid WHERE id = ?', [id]);
  if (!row) throw new AppError('网格不存在', 404, 'NOT_FOUND');
  return ok(res, row);
});

const gridSchema = z.object({
  gridNo: z.string().min(1, '网格编号必填').max(64),
  name: z.string().min(1, '网格名称必填').max(128),
  manager: z.string().max(64).nullable().optional(),
  staff: z.string().max(255).nullable().optional(),
  description: z.string().max(500).nullable().optional(),
  status: z.coerce.number().min(0).max(1).optional(),
});

/** 新增网格 */
router.post('/', requirePermission('grid:manage'), async (req: Request, res: Response) => {
  const body = gridSchema.parse(req.body);
  const dup = await queryOne<any>('SELECT id FROM grid WHERE grid_no = ?', [body.gridNo]);
  if (dup) throw new AppError('网格编号已存在', 409, 'DUPLICATE_GRID_NO');
  const result = await execute(
    'INSERT INTO grid (grid_no, name, manager, staff, description, status) VALUES (?,?,?,?,?,?)',
    [body.gridNo, body.name, body.manager || null, body.staff || null, body.description || null, body.status ?? 1]
  );
  await writeAudit({ userId: req.user!.id, username: req.user!.username, action: 'grid:create', request: { name: body.name }, result: 'SUCCESS', ip: req.ip });
  return ok(res, { id: result.insertId }, '网格已创建');
});

/** 编辑网格 */
router.put('/:id', requirePermission('grid:manage'), async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const body = gridSchema.parse(req.body);
  await execute(
    'UPDATE grid SET grid_no = ?, name = ?, manager = ?, staff = ?, description = ?, status = ? WHERE id = ?',
    [body.gridNo, body.name, body.manager || null, body.staff || null, body.description || null, body.status ?? 1, id]
  );
  return ok(res, { id }, '网格已更新');
});

const transferSchema = z.object({
  personIds: z.array(z.number()).min(1),
  targetGridId: z.coerce.number(),
  reason: z.string().max(255).nullable().optional(),
});

/** 跨网格人员转移（记录原网格、新网格、操作时间、操作人） */
router.post('/transfer-person', requirePermission('person:edit'), async (req: Request, res: Response) => {
  const { personIds, targetGridId, reason } = transferSchema.parse(req.body);
  const target = await queryOne<any>('SELECT id FROM grid WHERE id = ?', [targetGridId]);
  if (!target) throw new AppError('目标网格不存在', 404, 'NOT_FOUND');

  // 一次性取回待转移人员的原网格，避免在事务里逐条 SELECT（原实现是 N+1）。
  // 已在目标网格的人直接跳过，不产生无意义的变更日志。
  const placeholders = personIds.map(() => '?').join(',');
  const rows = await query<any>(
    `SELECT id, grid_id FROM person WHERE id IN (${placeholders})`,
    personIds
  );
  const moving = rows.filter((p) => p.grid_id !== targetGridId);

  await withTransaction(async (conn) => {
    for (const person of moving) {
      await conn.query('UPDATE person SET grid_id = ?, updated_by = ? WHERE id = ?', [
        targetGridId,
        req.user!.id,
        person.id,
      ]);
      await conn.query(
        `INSERT INTO person_change_log (person_id, field_name, old_value, new_value, change_type, reason, operator_id)
         VALUES (?, 'grid_id', ?, ?, 'UPDATE', ?, ?)`,
        [person.id, String(person.grid_id || ''), String(targetGridId), reason || '网格转移', req.user!.id]
      );
    }
  });

  await writeAudit({
    userId: req.user!.id,
    username: req.user!.username,
    action: 'grid:transfer_person',
    request: { personIds: moving.length, targetGridId },
    result: 'SUCCESS',
    ip: req.ip,
  });
  return ok(res, { transferred: moving.length }, moving.length ? '人员已转移' : '所选人员已在目标网格，无需转移');
});

export default router;
