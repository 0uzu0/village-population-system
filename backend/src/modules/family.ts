import { Router, Request, Response } from 'express';
import { query, queryOne, execute, withTransaction } from '../config/db';
import { authMiddleware } from '../middleware/auth';
import { requirePermission, buildGridFilter } from '../middleware/rbac';
import { ok, okPage, fail, AppError, PageResult } from '../utils/response';
import { writeAudit } from '../middleware/audit';
import { buildFamilyTagFilter } from '../utils/tagQuery';
import { z } from 'zod';

const router = Router();
router.use(authMiddleware);

function genFamilyNo(): string {
  const ts = Date.now().toString(36).toUpperCase();
  return `F${ts}${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
}

const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(20),
  keyword: z.string().optional(),
  gridId: z.coerce.number().optional(),
  tagIds: z.string().optional(),
});

/** 家庭列表 */
router.get('/', requirePermission('family:view'), async (req: Request, res: Response) => {
  const q = listSchema.parse(req.query);
  const where: string[] = ['f.status = 1'];
  const params: any[] = [];

  if (q.keyword) {
    where.push('(f.family_no LIKE ? OR p.name LIKE ?)');
    params.push(`%${q.keyword}%`, `%${q.keyword}%`);
  }
  if (q.gridId) {
    where.push('f.grid_id = ?');
    params.push(q.gridId);
  }
  const gridFilter = buildGridFilter(req, 'f.grid_id');
  if (gridFilter.where) {
    where.push(gridFilter.where.replace(/^ AND /, ''));
    params.push(...gridFilter.params);
  }

  if (q.tagIds) {
    const tagIds = q.tagIds.split(',').map((s) => parseInt(s, 10)).filter((n) => !isNaN(n));
    const ft = buildFamilyTagFilter(tagIds, 'f');
    if (ft.where) {
      where.push(ft.where.replace(/^ AND /, '').replace(/p\./g, 'f.'));
      params.push(...ft.params);
    }
  }

  const whereSql = where.join(' AND ');
  const totalRow = await queryOne<any>(`SELECT COUNT(DISTINCT f.id) AS cnt FROM family f LEFT JOIN person p ON p.id = f.head_person_id WHERE ${whereSql}`, params);
  const total = Number(totalRow?.cnt || 0);

  const rows = await query<any>(
    `SELECT f.id, f.family_no, f.address, f.grid_id, f.head_person_id,
            g.name AS grid_name, hp.name AS head_name,
            (SELECT COUNT(*) FROM family_member fm WHERE fm.family_id = f.id AND fm.status = 1) AS member_count
     FROM family f
     LEFT JOIN grid g ON g.id = f.grid_id
     LEFT JOIN person hp ON hp.id = f.head_person_id
     LEFT JOIN person p ON p.id = f.head_person_id
     WHERE ${whereSql}
     ORDER BY f.id
     LIMIT ? OFFSET ?`,
    [...params, q.pageSize, (q.page - 1) * q.pageSize]
  );

  // 家庭标签
  const familyIds = rows.map((r: any) => r.id);
  let tagMap: Map<number, any[]> = new Map();
  if (familyIds.length) {
    const tags = await query<any>(
      `SELECT ft.family_id, td.id, td.name, td.code, td.color
       FROM family_tag ft JOIN tag_definition td ON td.id = ft.tag_id
       WHERE ft.family_id IN (${familyIds.map(() => '?').join(',')}) AND ft.status = 'ACTIVE'`,
      familyIds
    );
    for (const t of tags) {
      if (!tagMap.has(t.family_id)) tagMap.set(t.family_id, []);
      tagMap.get(t.family_id)!.push({ id: t.id, name: t.name, code: t.code, color: t.color });
    }
  }

  const list = rows.map((r: any) => ({ ...r, tags: tagMap.get(r.id) || [] }));
  const result: PageResult<any> = { list, total, page: q.page, pageSize: q.pageSize };
  return okPage(res, result);
});

/** 家庭详情 */
router.get('/:id', requirePermission('family:view'), async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const fam = await queryOne<any>(
    `SELECT f.*, g.name AS grid_name, hp.name AS head_name
     FROM family f LEFT JOIN grid g ON g.id = f.grid_id LEFT JOIN person hp ON hp.id = f.head_person_id
     WHERE f.id = ?`,
    [id]
  );
  if (!fam) throw new AppError('家庭不存在', 404, 'NOT_FOUND');

  const members = await query<any>(
    `SELECT fm.id AS memberId, fm.relation, fm.is_householder, fm.join_date,
            p.id, p.name, p.gender, p.birth_date, p.person_no, p.id_card, p.status
     FROM family_member fm JOIN person p ON p.id = fm.person_id
     WHERE fm.family_id = ? ORDER BY fm.is_householder DESC, fm.id`,
    [id]
  );
  fam.members = members.map((m: any) => ({
    memberId: m.memberId,
    relation: m.relation,
    isHouseholder: !!m.is_householder,
    joinDate: m.join_date,
    person: { id: m.id, name: m.name, gender: m.gender, birthDate: m.birth_date, personNo: m.person_no, idCard: m.id_card, status: m.status },
  }));

  const tags = await query<any>(
    `SELECT ft.id AS linkId, td.id, td.name, td.code, td.color, ft.effect_date, ft.expire_date, ft.status, ft.basis, ft.created_at
     FROM family_tag ft JOIN tag_definition td ON td.id = ft.tag_id WHERE ft.family_id = ? ORDER BY ft.created_at DESC`,
    [id]
  );
  fam.tags = tags;
  return ok(res, fam);
});

const familySchema = z.object({
  address: z.string().max(255).optional().or(z.literal('')),
  gridId: z.coerce.number().nullable().optional(),
  headPersonId: z.coerce.number().nullable().optional(),
});

/** 新增家庭 */
router.post('/', requirePermission('family:manage'), async (req: Request, res: Response) => {
  const body = familySchema.parse(req.body);
  const familyNo = genFamilyNo();
  const result = await execute(
    'INSERT INTO family (family_no, address, grid_id, head_person_id) VALUES (?,?,?,?)',
    [familyNo, body.address || null, body.gridId || null, body.headPersonId || null]
  );
  const fid = result.insertId;

  if (body.headPersonId) {
    // 更新户主与关系
    await execute('UPDATE person SET family_id = ?, relation = ? WHERE id = ?', [fid, 'HEAD', body.headPersonId]);
    await execute(
      `INSERT INTO family_member (family_id, person_id, relation, is_householder) VALUES (?,?,?,1)
       ON DUPLICATE KEY UPDATE relation = 'HEAD', is_householder = 1`,
      [fid, body.headPersonId, 'HEAD']
    );
  }

  await writeAudit({ userId: req.user!.id, username: req.user!.username, action: 'family:create', request: { familyNo }, result: 'SUCCESS', ip: req.ip });
  return ok(res, { id: fid, familyNo }, '家庭已创建');
});

/** 编辑家庭 */
router.put('/:id', requirePermission('family:manage'), async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const body = familySchema.parse(req.body);
  const existing = await queryOne<any>('SELECT * FROM family WHERE id = ?', [id]);
  if (!existing) throw new AppError('家庭不存在', 404, 'NOT_FOUND');
  await execute('UPDATE family SET address = ?, grid_id = ?, head_person_id = ? WHERE id = ?', [
    body.address || null, body.gridId || null, body.headPersonId || existing.head_person_id, id,
  ]);
  return ok(res, { id }, '家庭已更新');
});

const memberSchema = z.object({
  personId: z.coerce.number(),
  relation: z.string().min(1, '与户主关系必填'),
  isHouseholder: z.coerce.number().min(0).max(1).default(0),
});

/** 添加家庭成员 */
router.post('/:id/members', requirePermission('family:manage'), async (req: Request, res: Response) => {
  const fid = Number(req.params.id);
  const { personId, relation, isHouseholder } = memberSchema.parse(req.body);
  const person = await queryOne<any>('SELECT id FROM person WHERE id = ?', [personId]);
  if (!person) throw new AppError('人员不存在', 404, 'NOT_FOUND');

  await withTransaction(async (conn) => {
    await conn.query(
      `INSERT INTO family_member (family_id, person_id, relation, is_householder) VALUES (?,?,?,?)
       ON DUPLICATE KEY UPDATE relation = VALUES(relation), is_householder = VALUES(is_householder), status = 1, leave_date = NULL`,
      [fid, personId, relation, isHouseholder]
    );
    await conn.query('UPDATE person SET family_id = ?, relation = ? WHERE id = ?', [fid, relation, personId]);
    if (isHouseholder) {
      await conn.query('UPDATE family SET head_person_id = ? WHERE id = ?', [personId, fid]);
    }
  });
  return ok(res, null, '成员已添加');
});

/** 删除家庭（物理删除，事务内清理成员关系与家庭标签；成员人员档案保留，仅解除归属） */
router.delete('/:id', requirePermission('family:manage'), async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const family = await queryOne<any>('SELECT id, family_no FROM family WHERE id = ?', [id]);
  if (!family) throw new AppError('家庭不存在', 404, 'NOT_FOUND');

  await withTransaction(async (conn) => {
    // 清理关联数据（库内无外键约束，需手动处理）
    await conn.query('DELETE FROM family_tag WHERE family_id = ?', [id]);
    await conn.query('DELETE FROM family_member WHERE family_id = ?', [id]);
    // 成员只是解除家庭归属，人员档案不删除
    await conn.query('UPDATE person SET family_id = NULL, relation = NULL WHERE family_id = ?', [id]);
    await conn.query('DELETE FROM family WHERE id = ?', [id]);
  });

  await writeAudit({
    userId: req.user!.id,
    username: req.user!.username,
    action: 'family:delete',
    request: { id, familyNo: family.family_no },
    result: 'SUCCESS',
    ip: req.ip,
  });
  return ok(res, { id }, '家庭已删除');
});

/** 移除家庭成员 */
router.delete('/:id/members/:memberId', requirePermission('family:manage'), async (req: Request, res: Response) => {
  const fid = Number(req.params.id);
  const memberId = Number(req.params.memberId);
  const member = await queryOne<any>('SELECT * FROM family_member WHERE id = ? AND family_id = ?', [memberId, fid]);
  if (!member) throw new AppError('成员关系不存在', 404, 'NOT_FOUND');

  await withTransaction(async (conn) => {
    await conn.query('UPDATE family_member SET status = 0, leave_date = CURDATE() WHERE id = ?', [memberId]);
    await conn.query('UPDATE person SET family_id = NULL, relation = NULL WHERE id = ? AND family_id = ?', [member.person_id, fid]);
  });
  return ok(res, null, '成员已移除');
});

const headSchema = z.object({ personId: z.coerce.number() });

/** 户主变更 */
router.post('/:id/head', requirePermission('family:manage'), async (req: Request, res: Response) => {
  const fid = Number(req.params.id);
  const { personId } = headSchema.parse(req.body);
  await withTransaction(async (conn) => {
    await conn.query('UPDATE family_member SET is_householder = 0 WHERE family_id = ?', [fid]);
    await conn.query(
      `INSERT INTO family_member (family_id, person_id, relation, is_householder) VALUES (?,?,?,1)
       ON DUPLICATE KEY UPDATE is_householder = 1, status = 1`,
      [fid, personId, 'HEAD']
    );
    await conn.query('UPDATE person SET family_id = ?, relation = ? WHERE id = ?', [fid, 'HEAD', personId]);
    await conn.query('UPDATE family SET head_person_id = ? WHERE id = ?', [personId, fid]);
  });
  await writeAudit({ userId: req.user!.id, username: req.user!.username, action: 'family:change_head', request: { fid, personId }, result: 'SUCCESS', ip: req.ip });
  return ok(res, null, '户主已变更');
});

const familyTagSchema = z.object({
  tagId: z.coerce.number(),
  effectDate: z.string().optional().or(z.literal('')),
  basis: z.string().max(500).optional().or(z.literal('')),
});

/** 家庭添加标签 */
router.post('/:id/tags', requirePermission('tag:manage'), async (req: Request, res: Response) => {
  const fid = Number(req.params.id);
  const body = familyTagSchema.parse(req.body);
  const tag = await queryOne<any>('SELECT * FROM tag_definition WHERE id = ? AND object_type = \'FAMILY\'', [body.tagId]);
  if (!tag) throw new AppError('标签不存在或非家庭标签', 404, 'NOT_FOUND');

  if (!tag.allow_duplicate) {
    const dup = await queryOne<any>(`SELECT id FROM family_tag WHERE family_id = ? AND tag_id = ? AND status = 'ACTIVE'`, [fid, body.tagId]);
    if (dup) throw new AppError('该家庭已关联此标签', 409, 'DUPLICATE_TAG');
  }
  await execute(
    'INSERT INTO family_tag (family_id, tag_id, effect_date, status, basis, created_by) VALUES (?,?,?,?,?,?)',
    [fid, body.tagId, body.effectDate || null, tag.need_audit ? 'PENDING' : 'ACTIVE', body.basis || null, req.user!.id]
  );
  await execute(
    'INSERT INTO tag_change_log (object_type, object_id, tag_id, action, operator_id) VALUES (\'FAMILY\', ?, ?, \'ADD\', ?)',
    [fid, body.tagId, req.user!.id]
  );
  return ok(res, null, '标签已添加');
});

/** 移除家庭标签 */
router.delete('/:id/tags/:linkId', requirePermission('tag:manage'), async (req: Request, res: Response) => {
  const fid = Number(req.params.id);
  const linkId = Number(req.params.linkId);
  const link = await queryOne<any>('SELECT * FROM family_tag WHERE id = ? AND family_id = ?', [linkId, fid]);
  if (!link) throw new AppError('标签关联不存在', 404, 'NOT_FOUND');
  await execute(`UPDATE family_tag SET status = 'INACTIVE', expire_date = CURDATE() WHERE id = ?`, [linkId]);
  await execute('INSERT INTO tag_change_log (object_type, object_id, tag_id, action, operator_id) VALUES (\'FAMILY\', ?, ?, \'REMOVE\', ?)', [fid, link.tag_id, req.user!.id]);
  return ok(res, null, '标签已移除');
});

export default router;
