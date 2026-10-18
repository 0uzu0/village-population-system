import { Router, Request, Response } from 'express';
import { query, queryOne, execute, withTransaction } from '../config/db';
import { authMiddleware } from '../middleware/auth';
import { requirePermission } from '../middleware/rbac';
import { ok, okPage, AppError, PageResult } from '../utils/response';
import { writeAudit } from '../middleware/audit';
import { validateIdCard, birthFromIdCard, genderFromIdCard } from '../utils/idcard';
import { formatDate } from '../utils/date';
import { syncPersonTags } from '../services/personTags';
import { PERSON_STATUSES, isActiveStatus } from '../utils/personStatus';
import { pickPopulationTags } from '../utils/populationTags';
import { z } from 'zod';

const router = Router();
router.use(authMiddleware);

/**
 * 导入待核查人员
 * Excel 导入时身份证号为空或非法的行会落到这里，不进入 person 正式档案。
 * 人工补齐身份证号后可「确认入库」，也可忽略或直接删除。
 */

const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(20),
  status: z.string().optional(),
  reason: z.string().optional(),
  batchNo: z.string().optional(),
  keyword: z.string().optional(),
});

/** 待核查列表 */
router.get('/', requirePermission('excel:import'), async (req: Request, res: Response) => {
  const q = listSchema.parse(req.query);
  const where: string[] = ['1=1'];
  const params: any[] = [];

  if (q.status) { where.push('ip.status = ?'); params.push(q.status); }
  if (q.reason) { where.push('ip.reason = ?'); params.push(q.reason); }
  if (q.batchNo) { where.push('ip.batch_no = ?'); params.push(q.batchNo); }
  if (q.keyword) { where.push('(ip.name LIKE ? OR ip.id_card LIKE ? OR ip.phone LIKE ?)'); params.push(`%${q.keyword}%`, `%${q.keyword}%`, `%${q.keyword}%`); }

  const whereSql = where.join(' AND ');
  const totalRow = await queryOne<any>(`SELECT COUNT(*) AS cnt FROM import_pending ip WHERE ${whereSql}`, params);
  const total = Number(totalRow?.cnt || 0);

  const rows = await query<any>(
    `SELECT ip.*, u.real_name AS operator_name
     FROM import_pending ip LEFT JOIN sys_user u ON u.id = ip.created_by
     WHERE ${whereSql}
     ORDER BY ip.status ASC, ip.id DESC
     LIMIT ? OFFSET ?`,
    [...params, q.pageSize, (q.page - 1) * q.pageSize]
  );

  const result: PageResult<any> = { list: rows, total, page: q.page, pageSize: q.pageSize };
  return okPage(res, result);
});

/** 统计概览（各状态/原因数量，便于页面顶部展示） */
router.get('/summary', requirePermission('excel:import'), async (_req: Request, res: Response) => {
  const rows = await query<any>(
    `SELECT status, reason, COUNT(*) AS cnt FROM import_pending GROUP BY status, reason`
  );
  const byStatus: Record<string, number> = {};
  const byReason: Record<string, number> = {};
  let total = 0;
  for (const r of rows) {
    byStatus[r.status] = (byStatus[r.status] || 0) + Number(r.cnt);
    byReason[r.reason] = (byReason[r.reason] || 0) + Number(r.cnt);
    total += Number(r.cnt);
  }
  return ok(res, { total, byStatus, byReason });
});

/** 详情 */
router.get('/:id', requirePermission('excel:import'), async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const row = await queryOne<any>('SELECT * FROM import_pending WHERE id = ?', [id]);
  if (!row) throw new AppError('待核查记录不存在', 404, 'NOT_FOUND');
  return ok(res, row);
});

const updateSchema = z.object({
  name: z.string().min(1).max(64).optional(),
  gender: z.enum(['MALE', 'FEMALE']).nullable().optional(),
  // 空串按「未填」处理：PC 补录弹窗整份表单提交，出生日期留空时传的是 ''，
  // 不做归一会被格式校验直接拒绝，导致整个补录保存失败（v2.1.1）
  birthDate: z.preprocess(
    (v) => (v === '' ? null : v),
    z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional()
  ),
  idCard: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  phoneBackup: z.string().nullable().optional(),
  hukouAddress: z.string().max(255).nullable().optional(),
  liveAddress: z.string().max(255).nullable().optional(),
  village: z.string().max(128).nullable().optional(),
  gridNo: z.string().nullable().optional(),
  familyNo: z.string().nullable().optional(),
  relation: z.string().nullable().optional(),
  /** 导入时带过来的状态（v2.3）：确认入库沿用，避免迁出/死亡人员在入库时「复活」成正常 */
  personStatus: z.enum(PERSON_STATUSES).nullable().optional(),
  handleNote: z.string().max(255).nullable().optional(),
});

/** 编辑 / 补录（允许先存非法身份证，正式入库时再校验） */
router.put('/:id', requirePermission('excel:import'), async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const existing = await queryOne<any>('SELECT * FROM import_pending WHERE id = ?', [id]);
  if (!existing) throw new AppError('待核查记录不存在', 404, 'NOT_FOUND');
  if (existing.status === 'RESOLVED') throw new AppError('该记录已入库，不可再修改', 409, 'ALREADY_RESOLVED');

  const body = updateSchema.parse(req.body);
  const sets: string[] = [];
  const params: any[] = [];
  const map: Record<string, string> = {
    name: 'name', gender: 'gender', birthDate: 'birth_date', idCard: 'id_card',
    phone: 'phone', phoneBackup: 'phone_backup', hukouAddress: 'hukou_address',
    liveAddress: 'live_address', village: 'village', gridNo: 'grid_no',
    familyNo: 'family_no', relation: 'relation', handleNote: 'handle_note',
    personStatus: 'person_status',
  };
  for (const [k, col] of Object.entries(map)) {
    const v = (body as any)[k];
    if (v === undefined) continue;
    // 性别/出生日期的空值不进 SET，交给下方「身份证派生」补齐（避免同列重复 SET）
    if ((k === 'gender' || k === 'birthDate') && !v) continue;
    sets.push(`${col} = ?`); params.push(v === '' ? null : v);
  }
  // 补录身份证时自动派生出生日期与性别（v2.1.1，与确认入库/建档同口径）：
  // 用户只填身份证号，保存后列表里就能看到日期性别，不用等到确认入库。
  // 「空值 = 未填」（PC 弹窗整份提交，没填的字段传 null/''），一律以身份证
  // 派生值填充；调用方显式传了非空值才以调用方为准。身份证非法时不派生
  // 也不报错（本接口允许先存非法号码，入库时再校验）。
  if (body.idCard) {
    const check = validateIdCard(String(body.idCard));
    if (check.valid && check.normalized) {
      const derivedBirth = birthFromIdCard(check.normalized);
      const derivedGender = genderFromIdCard(check.normalized);
      if (!body.gender && derivedGender) { sets.push('gender = ?'); params.push(derivedGender); }
      if (!body.birthDate && derivedBirth) { sets.push('birth_date = ?'); params.push(derivedBirth); }
    }
  }
  if (!sets.length) return ok(res, { id }, '无字段更新');

  params.push(id);
  await execute(`UPDATE import_pending SET ${sets.join(', ')} WHERE id = ?`, params);
  return ok(res, { id }, '已保存');
});

/** 确认入库：补齐身份证后写入正式人员档案 */
router.post('/:id/confirm', requirePermission('excel:import'), async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const p = await queryOne<any>('SELECT * FROM import_pending WHERE id = ?', [id]);
  if (!p) throw new AppError('待核查记录不存在', 404, 'NOT_FOUND');
  if (p.status === 'RESOLVED') throw new AppError('该记录已入库', 409, 'ALREADY_RESOLVED');

  if (!p.id_card) throw new AppError('请先补录身份证号', 400, 'ID_CARD_REQUIRED');
  const check = validateIdCard(String(p.id_card));
  if (!check.valid) throw new AppError(`身份证号：${check.message}`, 400, 'INVALID_ID_CARD');
  const idCard = check.normalized!;

  const dup = await queryOne<any>('SELECT id FROM person WHERE id_card = ?', [idCard]);
  if (dup) throw new AppError('该身份证号已存在于人员档案中', 409, 'DUPLICATE_ID_CARD');

  // 网格 / 家庭编号解析（填写了就必须存在，避免产生悬空引用）
  let gridId: number | null = null;
  if (p.grid_no) {
    const g = await queryOne<any>('SELECT id FROM grid WHERE grid_no = ?', [p.grid_no]);
    if (!g) throw new AppError(`网格编号「${p.grid_no}」不存在`, 400, 'GRID_NOT_FOUND');
    gridId = g.id;
  }
  let familyId: number | null = null;
  if (p.family_no) {
    const f = await queryOne<any>('SELECT id FROM family WHERE family_no = ?', [p.family_no]);
    if (!f) throw new AppError(`家庭编号「${p.family_no}」不存在`, 400, 'FAMILY_NOT_FOUND');
    familyId = f.id;
  }

  const relation = p.relation === '户主' ? 'HEAD' : p.relation || null;
  // 出生日期以身份证为准（年龄口径）：确认入库前已校验身份证合法，优先按证上日期；
  // 证上日期不存在（如 02-30）时才回退到原表登记值。
  // 注意：回退写入 birth_date 时必须用按本地时区取值的 formatDate，不能用 toISOString()
  const birthDate = birthFromIdCard(idCard) || formatDate(p.birth_date);
  const gender = p.gender || genderFromIdCard(idCard) || 'MALE';

  const personNo = `P${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  // 导入时记下的状态：迁出/死亡人员在补录身份证后仍然保持原状态，
  // 不能因为「确认入库」这一步就变回正常（否则他会重新出现在所有人口统计里）。
  const personStatus = p.person_status || 'NORMAL';

  await withTransaction(async (conn) => {
    const r: any = await conn.query(
      `INSERT INTO person (person_no, name, gender, birth_date, id_card, phone, phone_backup,
        hukou_address, live_address, village, grid_id, family_id, relation, status, data_source, created_by, updated_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        personNo, p.name, gender, birthDate, idCard, p.phone || null, p.phone_backup || null,
        p.hukou_address || null, p.live_address || null, p.village || null,
        gridId, familyId, relation, personStatus, 'PENDING_CONFIRM', req.user!.id, req.user!.id,
      ]
    );
    const newId = (r[0] as any).insertId;

    if (familyId) {
      await conn.query(
        'INSERT IGNORE INTO family_member (family_id, person_id, relation, is_householder) VALUES (?,?,?,?)',
        [familyId, newId, relation || 'OTHER', relation === 'HEAD' ? 1 : 0]
      );
      if (relation === 'HEAD') {
        await conn.query('UPDATE family SET head_person_id = ? WHERE id = ? AND head_person_id IS NULL', [newId, familyId]);
      }
    }

    // 回挂建档时选择的标签（v2.1.1）：转待核查分支此前会丢掉 tagIds，
    // 确认入库后档案上没有任何标签，「流动人口」等在列表里就消失了。
    // syncPersonTags 自带互斥组裁决（tag_definition.exclusive_group），
    // 与新建档同一套口径。
    if (p.tag_ids) {
      let tagIds = String(p.tag_ids)
        .split(',')
        .map((s) => parseInt(s, 10))
        .filter((n) => Number.isInteger(n) && n > 0);
      // 非在册人员不带人口归属标签（导入侧已过滤过；这里再兜一次，
      // 保证「直接改数据库 tag_ids」也绕不过不变式）
      if (tagIds.length && !isActiveStatus(personStatus)) {
        const popIds = new Set((await pickPopulationTags(conn, tagIds)).map((d) => d.id));
        tagIds = tagIds.filter((id) => !popIds.has(id));
      }
      if (tagIds.length) await syncPersonTags(conn, newId, tagIds, req.user!.id);
    }

    // 新增动作写进变更流水（v2.1.1，与 POST /persons 口径一致——
    // 此前确认入库建档在「近期人口档案变更」里无任何记录）
    await conn.query(
      `INSERT INTO person_change_log (person_id, change_type, reason, operator_id)
       VALUES (?, 'CREATE', ?, ?)`,
      [newId, '待核查确认入库建档', req.user!.id]
    );

    await conn.query(
      `UPDATE import_pending SET status = 'RESOLVED', handle_note = COALESCE(?, handle_note), handled_by = ?, handled_at = NOW() WHERE id = ?`,
      [req.body?.note || null, req.user!.id, id]
    );
  });

  await writeAudit({
    userId: req.user!.id,
    username: req.user!.username,
    action: 'pending:confirm',
    request: { id, name: p.name, idCard },
    result: 'SUCCESS',
    ip: req.ip,
  });

  return ok(res, { id, personNo }, '已确认入库');
});

/** 忽略该条（不入库，保留痕迹） */
router.post('/:id/ignore', requirePermission('excel:import'), async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const p = await queryOne<any>('SELECT * FROM import_pending WHERE id = ?', [id]);
  if (!p) throw new AppError('待核查记录不存在', 404, 'NOT_FOUND');
  if (p.status === 'RESOLVED') throw new AppError('该记录已入库，不能忽略', 409, 'ALREADY_RESOLVED');
  await execute(
    `UPDATE import_pending SET status = 'IGNORED', handle_note = ?, handled_by = ?, handled_at = NOW() WHERE id = ?`,
    [req.body?.note || '人工确认无需入库', req.user!.id, id]
  );
  return ok(res, { id }, '已忽略');
});

/** 删除单条 */
router.delete('/:id', requirePermission('excel:import'), async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const p = await queryOne<any>('SELECT * FROM import_pending WHERE id = ?', [id]);
  if (!p) throw new AppError('待核查记录不存在', 404, 'NOT_FOUND');
  await execute('DELETE FROM import_pending WHERE id = ?', [id]);
  await writeAudit({
    userId: req.user!.id,
    username: req.user!.username,
    action: 'pending:delete',
    request: { id, name: p.name },
    result: 'SUCCESS',
    ip: req.ip,
  });
  return ok(res, { id }, '已删除');
});

/** 批量操作入参：提示语随动作变化，避免「忽略」时报「请选择要删除的记录」 */
const batchIdsSchema = (emptyMessage: string) =>
  z.object({ ids: z.array(z.coerce.number()).min(1, emptyMessage) });
const batchSchema = batchIdsSchema('请选择要删除的记录');

/** 批量删除 */
router.post('/batch-delete', requirePermission('excel:import'), async (req: Request, res: Response) => {
  const { ids } = batchSchema.parse(req.body);
  await execute(`DELETE FROM import_pending WHERE id IN (${ids.map(() => '?').join(',')})`, ids);
  await writeAudit({
    userId: req.user!.id,
    username: req.user!.username,
    action: 'pending:batch_delete',
    request: { ids },
    result: 'SUCCESS',
    ip: req.ip,
  });
  return ok(res, { count: ids.length }, `已删除 ${ids.length} 条`);
});

/**
 * 批量忽略。
 * 前端原先逐条调 /:id/ignore，选 50 条就是 50 个请求（且中间失败会留下半批状态），
 * 这里收敛成一次 UPDATE。已入库的记录跳过而不是整批报错——用户选中的行里
 * 混着一条已入库的不该让整次操作失败。
 */
router.post('/batch-ignore', requirePermission('excel:import'), async (req: Request, res: Response) => {
  const { ids } = batchIdsSchema('请选择要忽略的记录').parse(req.body);
  const placeholders = ids.map(() => '?').join(',');
  const rows = await query<any>(`SELECT id, status FROM import_pending WHERE id IN (${placeholders})`, ids);
  const ignorable = rows.filter((r) => r.status !== 'RESOLVED').map((r) => Number(r.id));
  if (!ignorable.length) throw new AppError('选中的记录均已入库，无需忽略', 409, 'NOTHING_TO_IGNORE');
  await execute(
    `UPDATE import_pending SET status = 'IGNORED', handle_note = ?, handled_by = ?, handled_at = NOW()
     WHERE id IN (${ignorable.map(() => '?').join(',')})`,
    [req.body?.note || '人工确认无需入库', req.user!.id, ...ignorable]
  );
  await writeAudit({
    userId: req.user!.id,
    username: req.user!.username,
    action: 'pending:batch_ignore',
    request: { ids: ignorable, skipped: ids.length - ignorable.length },
    result: 'SUCCESS',
    ip: req.ip,
  });
  const skipped = ids.length - ignorable.length;
  return ok(
    res,
    { count: ignorable.length, skipped },
    skipped ? `已忽略 ${ignorable.length} 条，跳过已入库 ${skipped} 条` : `已忽略 ${ignorable.length} 条`
  );
});

export default router;
