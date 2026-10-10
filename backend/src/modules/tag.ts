import { Router, Request, Response } from 'express';
import { query, queryOne, execute } from '../config/db';
import { authMiddleware } from '../middleware/auth';
import { requirePermission } from '../middleware/rbac';
import { ok, okPage, fail, AppError, PageResult } from '../utils/response';
import { writeAudit } from '../middleware/audit';
import { z } from 'zod';

const router = Router();
router.use(authMiddleware);

/** 标签分类列表（含分类下标签） */
router.get('/categories', requirePermission('tag:view'), async (req: Request, res: Response) => {
  const categories = await query<any>(
    `SELECT c.id, c.code, c.name, c.sort,
       (SELECT COUNT(*) FROM tag_definition td WHERE td.category_id = c.id) AS tag_count
     FROM tag_category c ORDER BY c.sort, c.id`
  );
  return ok(res, categories);
});

const categorySchema = z.object({
  code: z.string().min(1).max(64),
  name: z.string().min(1).max(64),
  sort: z.coerce.number().int().default(0),
});

router.post('/categories', requirePermission('tag:manage'), async (req: Request, res: Response) => {
  const body = categorySchema.parse(req.body);
  const result = await execute('INSERT INTO tag_category (code, name, sort) VALUES (?,?,?)', [body.code, body.name, body.sort]);
  return ok(res, { id: result.insertId }, '分类已创建');
});

router.put('/categories/:id', requirePermission('tag:manage'), async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const body = categorySchema.parse(req.body);
  await execute('UPDATE tag_category SET code = ?, name = ?, sort = ? WHERE id = ?', [body.code, body.name, body.sort, id]);
  return ok(res, { id }, '分类已更新');
});

const defListSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(50),
  keyword: z.string().optional(),
  categoryId: z.coerce.number().optional(),
  objectType: z.string().optional(),
});

/** 标签定义列表（含使用人数统计） */
router.get('/definitions', requirePermission('tag:view'), async (req: Request, res: Response) => {
  const q = defListSchema.parse(req.query);
  const where: string[] = ['1=1'];
  const params: any[] = [];
  if (q.keyword) { where.push('(td.name LIKE ? OR td.code LIKE ? OR td.alias LIKE ?)'); params.push(`%${q.keyword}%`, `%${q.keyword}%`, `%${q.keyword}%`); }
  if (q.categoryId) { where.push('td.category_id = ?'); params.push(q.categoryId); }
  if (q.objectType) { where.push('td.object_type = ?'); params.push(q.objectType); }

  const whereSql = where.join(' AND ');
  const totalRow = await queryOne<any>(`SELECT COUNT(*) AS cnt FROM tag_definition td WHERE ${whereSql}`, params);
  const total = Number(totalRow?.cnt || 0);

  const rows = await query<any>(
    `SELECT td.*, c.name AS category_name,
       (SELECT COUNT(*) FROM person_tag pt WHERE pt.tag_id = td.id AND pt.status = 'ACTIVE') AS person_count,
       (SELECT COUNT(*) FROM family_tag ft WHERE ft.tag_id = td.id AND ft.status = 'ACTIVE') AS family_count
     FROM tag_definition td LEFT JOIN tag_category c ON c.id = td.category_id
     WHERE ${whereSql} ORDER BY td.category_id, td.id LIMIT ? OFFSET ?`,
    [...params, q.pageSize, (q.page - 1) * q.pageSize]
  );
  const result: PageResult<any> = { list: rows, total, page: q.page, pageSize: q.pageSize };
  return okPage(res, result);
});

const defSchema = z.object({
  categoryId: z.coerce.number(),
  name: z.string().min(1).max(64),
  code: z.string().min(1).max(64).regex(/^[A-Z0-9_]+$/, '编码需为大写字母/数字/下划线'),
  alias: z.string().max(255).optional().or(z.literal('')),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, '颜色需为 #RRGGBB').default('#3978F6'),
  description: z.string().max(500).optional().or(z.literal('')),
  // 写接口：objectType 必填（PERSON/FAMILY），不允许空值落库为 NULL
  objectType: z.enum(['PERSON', 'FAMILY'], { message: 'objectType 只能为 PERSON 或 FAMILY' }),
  allowDuplicate: z.coerce.number().min(0).max(1).default(0),
  isSensitive: z.coerce.number().min(0).max(1).default(0),
  needAudit: z.coerce.number().min(0).max(1).default(0),
});

router.post('/definitions', requirePermission('tag:manage'), async (req: Request, res: Response) => {
  const body = defSchema.parse(req.body);
  const dup = await queryOne<any>('SELECT id FROM tag_definition WHERE code = ?', [body.code]);
  if (dup) throw new AppError('标签编码已存在', 409, 'DUPLICATE_TAG_CODE');
  const result = await execute(
    `INSERT INTO tag_definition (category_id, name, code, alias, color, description, object_type, allow_duplicate, is_sensitive, need_audit, enabled, created_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,1,?)`,
    [body.categoryId, body.name, body.code, body.alias || null, body.color, body.description || null, body.objectType, body.allowDuplicate, body.isSensitive, body.needAudit, req.user!.id]
  );
  await writeAudit({ userId: req.user!.id, username: req.user!.username, action: 'tag:create', request: { code: body.code, name: body.name }, result: 'SUCCESS', ip: req.ip });
  return ok(res, { id: result.insertId }, '标签已创建');
});

router.put('/definitions/:id', requirePermission('tag:manage'), async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const body = defSchema.parse(req.body);
  await execute(
    `UPDATE tag_definition SET category_id = ?, name = ?, code = ?, alias = ?, color = ?, description = ?, object_type = ?, allow_duplicate = ?, is_sensitive = ?, need_audit = ? WHERE id = ?`,
    [body.categoryId, body.name, body.code, body.alias || null, body.color, body.description || null, body.objectType, body.allowDuplicate, body.isSensitive, body.needAudit, id]
  );
  await writeAudit({ userId: req.user!.id, username: req.user!.username, action: 'tag:edit', request: { id, code: body.code }, result: 'SUCCESS', ip: req.ip });
  return ok(res, { id }, '标签已更新');
});

/** 删除标签定义（物理删除；已被人员/家庭引用的标签拒绝删除，建议先停用） */
router.delete('/definitions/:id', requirePermission('tag:manage'), async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const tag = await queryOne<any>('SELECT id, name FROM tag_definition WHERE id = ?', [id]);
  if (!tag) throw new AppError('标签不存在', 404, 'NOT_FOUND');

  const used = Number(
    (await queryOne<any>(
      'SELECT (SELECT COUNT(*) FROM person_tag WHERE tag_id = ?) + (SELECT COUNT(*) FROM family_tag WHERE tag_id = ?) AS cnt',
      [id, id]
    ))?.cnt || 0
  );
  if (used > 0) {
    throw new AppError(`标签「${tag.name}」已被 ${used} 条记录引用，不能删除；可先停用该标签`, 409, 'TAG_IN_USE');
  }

  await execute('DELETE FROM tag_definition WHERE id = ?', [id]);
  await writeAudit({
    userId: req.user!.id,
    username: req.user!.username,
    action: 'tag:delete',
    request: { id, name: tag.name },
    result: 'SUCCESS',
    ip: req.ip,
  });
  return ok(res, { id }, '标签已删除');
});

/** 启用/停用标签（停用后历史保留） */
router.post('/definitions/:id/toggle', requirePermission('tag:manage'), async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const tag = await queryOne<any>('SELECT enabled FROM tag_definition WHERE id = ?', [id]);
  if (!tag) throw new AppError('标签不存在', 404, 'NOT_FOUND');
  const next = tag.enabled ? 0 : 1;
  await execute('UPDATE tag_definition SET enabled = ? WHERE id = ?', [next, id]);
  await writeAudit({ userId: req.user!.id, username: req.user!.username, action: next ? 'tag:enable' : 'tag:disable', request: { id }, result: 'SUCCESS', ip: req.ip });
  return ok(res, { id, enabled: !!next }, next ? '标签已启用' : '标签已停用');
});

/** 标签历史记录（标签变更日志，支持按对象查询） */
router.get('/history', requirePermission('tag:view'), async (req: Request, res: Response) => {
  const q = z.object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(500).default(20),
    objectType: z.string().optional().or(z.literal('')),
    objectId: z.coerce.number().optional(),
    tagId: z.coerce.number().optional(),
    action: z.string().optional().or(z.literal('')),
  }).parse(req.query);

  const where: string[] = ['1=1'];
  const params: any[] = [];
  if (q.objectType) { where.push('tcl.object_type = ?'); params.push(q.objectType); }
  if (q.objectId) { where.push('tcl.object_id = ?'); params.push(q.objectId); }
  if (q.tagId) { where.push('tcl.tag_id = ?'); params.push(q.tagId); }
  if (q.action) { where.push('tcl.action = ?'); params.push(q.action); }
  const whereSql = where.join(' AND ');

  const totalRow = await queryOne<any>(`SELECT COUNT(*) AS cnt FROM tag_change_log tcl WHERE ${whereSql}`, params);
  const total = Number(totalRow?.cnt || 0);
  const rows = await query<any>(
    `SELECT tcl.*, td.name AS tag_name, u.real_name AS operator_name,
       CASE tcl.object_type
         WHEN 'PERSON' THEN (SELECT name FROM person WHERE id = tcl.object_id)
         WHEN 'FAMILY' THEN (SELECT family_no FROM family WHERE id = tcl.object_id)
         ELSE NULL
       END AS object_name
     FROM tag_change_log tcl
     LEFT JOIN tag_definition td ON td.id = tcl.tag_id
     LEFT JOIN sys_user u ON u.id = tcl.operator_id
     WHERE ${whereSql} ORDER BY tcl.id DESC LIMIT ? OFFSET ?`,
    [...params, q.pageSize, (q.page - 1) * q.pageSize]
  );
  const result: PageResult<any> = { list: rows, total, page: q.page, pageSize: q.pageSize };
  return okPage(res, result);
});

export default router;
