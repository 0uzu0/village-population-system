import { Router, Request, Response } from 'express';
import { query, queryOne, execute, withTransaction } from '../config/db';
import { authMiddleware } from '../middleware/auth';
import { requirePermission } from '../middleware/rbac';
import { ok, okPage, AppError, PageResult } from '../utils/response';
import { writeAudit } from '../middleware/audit';
import { validateIdCard, birthFromIdCard, genderFromIdCard } from '../utils/idcard';
import { formatDate } from '../utils/date';
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
  birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional().or(z.literal('')),
  idCard: z.string().nullable().optional().or(z.literal('')),
  phone: z.string().nullable().optional().or(z.literal('')),
  phoneBackup: z.string().nullable().optional().or(z.literal('')),
  hukouAddress: z.string().max(255).nullable().optional().or(z.literal('')),
  liveAddress: z.string().max(255).nullable().optional().or(z.literal('')),
  village: z.string().max(128).nullable().optional().or(z.literal('')),
  gridNo: z.string().nullable().optional().or(z.literal('')),
  familyNo: z.string().nullable().optional().or(z.literal('')),
  relation: z.string().nullable().optional().or(z.literal('')),
  handleNote: z.string().max(255).nullable().optional().or(z.literal('')),
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
  };
  for (const [k, col] of Object.entries(map)) {
    const v = (body as any)[k];
    if (v !== undefined) { sets.push(`${col} = ?`); params.push(v === '' ? null : v); }
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

  await withTransaction(async (conn) => {
    const r: any = await conn.query(
      `INSERT INTO person (person_no, name, gender, birth_date, id_card, phone, phone_backup,
        hukou_address, live_address, village, grid_id, family_id, relation, status, data_source, created_by, updated_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        personNo, p.name, gender, birthDate, idCard, p.phone || null, p.phone_backup || null,
        p.hukou_address || null, p.live_address || null, p.village || null,
        gridId, familyId, relation, 'NORMAL', 'PENDING_CONFIRM', req.user!.id, req.user!.id,
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

const batchSchema = z.object({ ids: z.array(z.coerce.number()).min(1, '请选择要删除的记录') });

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

export default router;
