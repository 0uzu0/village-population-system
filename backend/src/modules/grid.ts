import { Router, Request, Response } from 'express';
import { query, queryOne, execute, withTransaction } from '../config/db';
import { authMiddleware } from '../middleware/auth';
import { requirePermission, buildGridFilter } from '../middleware/rbac';
import { ok, okPage, AppError, PageResult } from '../utils/response';
import { writeAudit } from '../middleware/audit';
import { activeSql } from '../utils/personStatus';
import { FOCUS_GROUPS } from '../utils/focusGroups';
import { z } from 'zod';

const router = Router();
router.use(authMiddleware);

const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(20),
  keyword: z.string().optional(),
});

/**
 * 重点人群统计口径：人群定义统一取自 `utils/focusGroups.ts`（唯一来源），
 * 不再在本文件里另写一份 FOCUS_TAGS —— 原先同一批人群在 keygroup / grid /
 * statistics / excel 四处各写一遍，改一处要同步四处，极易漏。
 */
const COUNTABLE_FOCUS_GROUPS = FOCUS_GROUPS.filter(
  (g): g is (typeof FOCUS_GROUPS)[number] & { countField: string } =>
    !!g.countField && g.tagCodes.length > 0
);

/**
 * 重点人群人数：用「条件聚合」一次算完，替代原先每行 6 个相关子查询。
 *
 * 原实现 `focusTagSelects()` 会给结果集每一行拼 6 个
 * `(SELECT COUNT(DISTINCT pt.person_id) FROM person_tag ... )`，
 * 村庄/网格列表有 N 行就是 **6N 次** person_tag 扫描。
 * 现在对同一张 `person ⋈ person_tag(ACTIVE) ⋈ tag_definition` 只做一次
 * GROUP BY + `COUNT(DISTINCT CASE WHEN ...)`，扫描次数降为 1 次。
 *
 * 调用方需保证 FROM 中存在别名 p（person）、pt（person_tag）、td（tag_definition）。
 */
function focusCountColumns(): string {
  return COUNTABLE_FOCUS_GROUPS.map(
    (g) =>
      `COUNT(DISTINCT CASE WHEN td.code IN (${g.tagCodes.map((c) => `'${c}'`).join(',')}) THEN p.id END) AS ${g.countField}`
  ).join(',\n         ');
}

/** 重点人群聚合所需的连接片段（p 必须是 person 的别名） */
const FOCUS_TAG_JOINS = `
       LEFT JOIN person_tag pt ON pt.person_id = p.id AND pt.status = 'ACTIVE'
       LEFT JOIN tag_definition td ON td.id = pt.tag_id`;

/** 某网格没有任何命中时补 0，保证前端表格不会出现 undefined */
function focusCountsOf(row: any): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const g of COUNTABLE_FOCUS_GROUPS) counts[g.countField] = Number(row?.[g.countField] || 0);
  return counts;
}

/**
 * 一次性算出给定网格集合的重点人群人数。
 *
 * 为什么单独发一条查询：标签连接会让 person 行数翻倍，若直接并进分页主查询，
 * LIMIT 的含义就被破坏（一行网格会变成多行）。所以按「主查询取分页 → 本查询
 * 按 id 聚合 → 内存里合并」的方式做，两条查询都只扫一遍。
 */
async function loadGridFocusCounts(gridIds: number[]): Promise<Map<number, Record<string, number>>> {
  const map = new Map<number, Record<string, number>>();
  if (!gridIds.length) return map;

  const rows = await query<any>(
    `SELECT g.id AS grid_id,
            ${focusCountColumns()}
     FROM grid g
     LEFT JOIN person p ON p.grid_id = g.id AND ${activeSql('p')}${FOCUS_TAG_JOINS}
     WHERE g.id IN (${gridIds.map(() => '?').join(',')})
     GROUP BY g.id`,
    gridIds
  );
  for (const row of rows) map.set(row.grid_id, focusCountsOf(row));
  return map;
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
       (SELECT COUNT(*) FROM person p WHERE p.grid_id = g.id AND ${activeSql('p')}) AS person_count,
       (SELECT COUNT(*) FROM family f WHERE f.grid_id = g.id AND f.status = 1) AS family_count
     FROM grid g WHERE ${whereSql} ORDER BY g.id LIMIT ? OFFSET ?`,
    [...params, q.pageSize, (q.page - 1) * q.pageSize]
  );

  // 重点人群人数：对本页网格一次性聚合后合并（见 loadGridFocusCounts 说明）
  const focusMap = await loadGridFocusCounts(rows.map((r: any) => r.id));
  const list = rows.map((r: any) => ({ ...r, ...focusCountsOf(focusMap.get(r.id)) }));

  const result: PageResult<any> = { list, total, page: q.page, pageSize: q.pageSize };
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
  const where: string[] = [
    'p.village IS NOT NULL',
    "p.village <> ''",
    activeSql('p'),
  ];
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

  // 重点人群人数改为「条件聚合」：连接 person_tag 会让每个村庄多出若干行，
  // 因此 person_count 必须用 COUNT(DISTINCT p.id)，否则会被标签行数放大。
  const rows = await query<any>(
    `SELECT p.village AS name,
       vc.manager,
       vc.phone,
       COUNT(DISTINCT p.id) AS person_count,
       (SELECT COUNT(DISTINCT fm.family_id) FROM family_member fm
          JOIN person pf ON pf.id = fm.person_id
        WHERE pf.village = p.village AND ${activeSql('pf')}) AS family_count,
       (SELECT GROUP_CONCAT(DISTINCT g.name ORDER BY g.id SEPARATOR '、')
          FROM grid g
         WHERE g.id IN (SELECT DISTINCT pg.grid_id FROM person pg
                         WHERE pg.village = p.village AND pg.grid_id IS NOT NULL)) AS grid_names,
       ${focusCountColumns()}
     FROM person p
     LEFT JOIN village_contact vc ON vc.village_name = p.village${FOCUS_TAG_JOINS}
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
    (await queryOne<any>(
      `SELECT COUNT(*) AS cnt FROM person WHERE grid_id = ? AND ${activeSql('person')}`,
      [id]
    ))?.cnt || 0
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
