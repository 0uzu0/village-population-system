import { Router, Request, Response } from 'express';
import { query, queryOne, execute, withTransaction } from '../config/db';
import { authMiddleware } from '../middleware/auth';
import { requirePermission, buildGridFilter } from '../middleware/rbac';
import { ok, okPage, AppError, PageResult } from '../utils/response';
import { writeAudit } from '../middleware/audit';
import { activeSql } from '../utils/personStatus';
import { FOCUS_GROUPS, allFocusTagCodes } from '../utils/focusGroups';
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

/** 全部「可归属到某个人群」的标签编码，用于把 person_tag 的扫描范围收窄到重点标签 */
const FOCUS_TAG_CODE_SQL = allFocusTagCodes()
  .map((c) => `'${c}'`)
  .join(',');

/**
 * 标签编码 → 统计列名 的 CASE 映射。
 *
 * 原先这里拼的是 6 个 `COUNT(DISTINCT CASE WHEN ...)`。语义没错，但 MySQL 对同一个
 * GROUP BY 里的**每一个** COUNT(DISTINCT) 都要单独维护一份去重结构，加上人口数就是
 * 7 份，还要在「person ⋈ person_tag」这种已被标签放大过的行集上逐个跑一遍 ——
 * 这正是「按小村庄查询要等好几秒」的主因。
 *
 * 改成「先按标签归类、再在内存里透视」后，COUNT(DISTINCT) 只剩 1 个，且分组键是
 * (分组列, 人群) 这种小基数列，去重结构的规模从「行数」降到「分组数 × 人群数」。
 */
function focusCountKeySql(): string {
  const whens = COUNTABLE_FOCUS_GROUPS.map(
    (g) => `           WHEN td.code IN (${g.tagCodes.map((c) => `'${c}'`).join(',')}) THEN '${g.countField}'`
  ).join('\n');
  return `CASE\n${whens}\n         END`;
}

/**
 * 重点人群聚合所需的连接片段（p 必须是 person 的别名）。
 *
 * 用 INNER JOIN 而不是 LEFT JOIN：本查询只取重点人群人数，没打过标签的人
 * 不会产生任何非 0 计数，留在结果里纯属浪费。配合 WHERE 上的
 * `td.code IN (重点标签)`，参与聚合的行数收敛到「真正打过重点标签的人」。
 */
const FOCUS_TAG_JOINS = `
       JOIN person_tag pt ON pt.person_id = p.id AND pt.status = 'ACTIVE'
       JOIN tag_definition td ON td.id = pt.tag_id`;

/** 某分组没有任何命中时补 0，保证前端不会出现 undefined */
function focusCountsOf(row: any): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const g of COUNTABLE_FOCUS_GROUPS) counts[g.countField] = Number(row?.[g.countField] || 0);
  return counts;
}

/** 从聚合结果里取某个分组的人数（分组键统一转字符串，避免 number/string 混用取不到） */
function focusCountsAt(map: Map<string, Record<string, number>>, key: string | number): Record<string, number> {
  return focusCountsOf(map.get(String(key)));
}

/**
 * 按「分组值 × 人群」聚合重点人群人数，返回 `Map<分组值, 各人群人数>`。
 *
 * 语义与 `COUNT(DISTINCT CASE WHEN td.code IN (某人群标签) THEN p.id END)` 完全一致：
 * 同一个人在同一人群里挂了多个标签（如「党员」要把正式党员 + 预备党员算一人）时，
 * 他会在该分组下出现多行，但 COUNT(DISTINCT p.id) 仍然只算 1 人。
 *
 * @param groupExpr 分组列表达式，如 'p.grid_id' / 'p.village'
 * @param whereSql  额外的 WHERE 片段（须已含在册口径与数据范围），**不含**标签过滤
 * @param params    whereSql 对应的参数
 */
async function loadFocusCountsBy(
  groupExpr: string,
  whereSql: string,
  params: any[]
): Promise<Map<string, Record<string, number>>> {
  const map = new Map<string, Record<string, number>>();

  // GROUP BY 里重复一遍 CASE 表达式而不是引用列别名：
  // 别名虽然 MySQL 认，但复制一份不依赖任何方言特性，换库/换解析器都不会踩坑。
  const countKeySql = focusCountKeySql();

  const rows = await query<any>(
    `SELECT ${groupExpr} AS grp,
            ${countKeySql} AS count_key,
            COUNT(DISTINCT p.id) AS cnt
       FROM person p${FOCUS_TAG_JOINS}
      WHERE ${whereSql}
        AND td.code IN (${FOCUS_TAG_CODE_SQL})
      GROUP BY ${groupExpr}, ${countKeySql}`,
    params
  );

  for (const row of rows) {
    // CASE 理论上一定有命中（WHERE 已把编码收窄到重点标签集合内），
    // 这里仍然兜一手：真出现映射不到的编码时宁可漏记，也不要写进一个 "null" 字段。
    if (row.count_key == null) continue;
    const key = String(row.grp);
    const counts = map.get(key) ?? focusCountsOf(null);
    counts[row.count_key] = Number(row.cnt || 0);
    map.set(key, counts);
  }
  return map;
}

/**
 * 一次性算出给定网格集合的重点人群人数。
 *
 * 为什么单独发一条查询：标签连接会让 person 行数翻倍，若直接并进分页主查询，
 * LIMIT 的含义就被破坏（一行网格会变成多行）。所以按「主查询取分页 → 本查询
 * 按 id 聚合 → 内存里合并」的方式做，两条查询都只扫一遍。
 */
async function loadGridFocusCounts(gridIds: number[]): Promise<Map<string, Record<string, number>>> {
  if (!gridIds.length) return new Map();
  return loadFocusCountsBy(
    'p.grid_id',
    `p.grid_id IN (${gridIds.map(() => '?').join(',')}) AND ${activeSql('p')}`,
    gridIds
  );
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
  const list = rows.map((r: any) => ({ ...r, ...focusCountsAt(focusMap, r.id) }));

  const result: PageResult<any> = { list, total, page: q.page, pageSize: q.pageSize };
  return okPage(res, result);
});

/**
 * 村庄（小村庄）维度统计。
 * 村庄名取自 person.village（导入时由户籍地址推导，如艾园村、仓门口村）。
 * 家庭数按「该村庄有成员的在册家庭」统计（family 表无 village 列，故由成员反查）。
 * 负责人 / 手机号来自 village_contact（V012），村庄维度下可编辑。
 *
 * 性能说明（「按小村庄查询很慢」的根因）：
 * 原实现是一条大 SQL：人口数来自 `person ⋈ person_tag` 的连接（被标签放大后必须
 * COUNT(DISTINCT)），6 类重点人群是 6 个 `COUNT(DISTINCT CASE WHEN ...)`，
 * 家庭数和网格名则是 SELECT 列表里的**相关子查询**。三者叠加的结果是
 * 「一个 GROUP BY 里 7 个 COUNT(DISTINCT) + 每个村庄各跑两遍子查询」，
 * 村庄越多、标签越密越慢。
 *
 * 现在拆成 4 条各扫一遍的平铺聚合（并行发起）再在内存里按村庄名合并：
 *   1) 人口数：不与标签相连，普通 COUNT(*) 走 (village, status) 索引；
 *   2) 家庭数：一遍 GROUP BY，替代「每村跑一次」的相关子查询；
 *   3) 网格名：一遍 GROUP BY，同上；
 *   4) 重点人群：loadFocusCountsBy（见其说明）。
 * 村庄联系人表是村庄级窄表（几十行），整表取回来按村名映射即可，不必参与聚合。
 */
router.get('/villages', requirePermission('grid:view'), async (req: Request, res: Response) => {
  const q = z.object({ keyword: z.string().optional() }).parse(req.query);

  // 村庄名 + 关键词 + 数据范围：几条查询共用的基础条件（不含在册口径）
  const villageConds: string[] = ['p.village IS NOT NULL', "p.village <> ''"];
  const villageParams: any[] = [];
  if (q.keyword) {
    villageConds.push('p.village LIKE ?');
    villageParams.push(`%${q.keyword}%`);
  }
  const gridFilter = buildGridFilter(req, 'p.grid_id');
  if (gridFilter.where) {
    villageConds.push(gridFilter.where.replace(/^ AND /, ''));
    villageParams.push(...gridFilter.params);
  }
  const villageWhere = villageConds.join(' AND ');
  const activeWhere = `${villageWhere} AND ${activeSql('p')}`;

  const [personRows, familyRows, gridNameRows, focusMap, contactRows] = await Promise.all([
    // 1) 每个村庄的在册人口数
    query<any>(
      `SELECT p.village AS name, COUNT(*) AS person_count
         FROM person p
        WHERE ${activeWhere}
        GROUP BY p.village`,
      villageParams
    ),
    // 2) 每个村庄的家庭数（家庭表没有 village 列，由家庭成员反查）
    //    口径与原相关子查询保持一致：只要求「成员在册」，未额外过滤 family_member.status。
    //    若日后要与家庭列表页的「在册家庭」对齐，属于口径变更，需先确认再改。
    query<any>(
      `SELECT p.village AS name, COUNT(DISTINCT fm.family_id) AS family_count
         FROM person p
         JOIN family_member fm ON fm.person_id = p.id
        WHERE ${activeWhere}
        GROUP BY p.village`,
      villageParams
    ),
    // 3) 每个村庄关联网格名。口径同样沿用原实现：不限人员状态
    //    （原相关子查询只按 village 取 DISTINCT grid_id，未做在册过滤）。
    query<any>(
      `SELECT p.village AS name,
              GROUP_CONCAT(DISTINCT g.name ORDER BY g.id SEPARATOR '、') AS grid_names
         FROM person p
         JOIN grid g ON g.id = p.grid_id
        WHERE ${villageWhere}
          AND p.grid_id IS NOT NULL
        GROUP BY p.village`,
      villageParams
    ),
    // 4) 重点人群人数（一次扫描，按「村庄 × 人群」聚合）
    loadFocusCountsBy('p.village', activeWhere, villageParams),
    // 5) 村庄联系人：整表取回，在内存里按村名映射
    query<any>('SELECT village_name, manager, phone FROM village_contact'),
  ]);

  const familyMap = new Map<string, number>(
    familyRows.map((r: any): [string, number] => [r.name, Number(r.family_count || 0)])
  );
  const gridNameMap = new Map<string, string | null>(
    gridNameRows.map((r: any): [string, string | null] => [r.name, r.grid_names ?? null])
  );
  const contactMap = new Map<string, { manager: string | null; phone: string | null }>(
    contactRows.map((c: any): [string, { manager: string | null; phone: string | null }] => [
      c.village_name,
      { manager: c.manager ?? null, phone: c.phone ?? null },
    ])
  );

  const list = personRows.map((r: any) => {
    const contact = contactMap.get(r.name);
    return {
      name: r.name,
      manager: contact?.manager ?? null,
      phone: contact?.phone ?? null,
      person_count: Number(r.person_count || 0),
      family_count: familyMap.get(r.name) ?? 0,
      grid_names: gridNameMap.get(r.name) ?? null,
      ...focusCountsAt(focusMap, r.name),
    };
  });

  // 与原 SQL 的 `ORDER BY person_count DESC, p.village ASC` 同序。
  // 并列时的中文名先后由 JS 的码点比较决定，与 MySQL 排序规则可能略有出入，
  // 但只影响「人数相同的村庄」之间的先后，不影响任何数字。
  list.sort((a, b) => b.person_count - a.person_count || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  return ok(res, { list, total: list.length }, `共 ${list.length} 个村庄`);
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
