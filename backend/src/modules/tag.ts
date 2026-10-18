import { Router, Request, Response } from 'express';
import { query, queryOne, execute } from '../config/db';
import { authMiddleware } from '../middleware/auth';
import { requirePermission } from '../middleware/rbac';
import { ok, okPage, AppError, PageResult } from '../utils/response';
import { writeAudit } from '../middleware/audit';
import { activeSql } from '../utils/personStatus';
import { tagPersonCountExclusiveGuard } from '../utils/tagExclusive';
import { SYSTEM_TAG_CODES, checkNewTagCode, checkTagCodeChange, isSystemTagCode } from '../utils/systemTags';
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
  /** 1=只看启用；0=只看停用；不传=全部 */
  enabled: z.coerce.number().int().min(0).max(1).optional(),
});

/** 标签定义列表（含使用人数统计） */
router.get('/definitions', requirePermission('tag:view'), async (req: Request, res: Response) => {
  const q = defListSchema.parse(req.query);
  const where: string[] = ['1=1'];
  const params: any[] = [];
  if (q.keyword) { where.push('(td.name LIKE ? OR td.code LIKE ? OR td.alias LIKE ?)'); params.push(`%${q.keyword}%`, `%${q.keyword}%`, `%${q.keyword}%`); }
  if (q.categoryId) { where.push('td.category_id = ?'); params.push(q.categoryId); }
  if (q.objectType) { where.push('td.object_type = ?'); params.push(q.objectType); }
  if (q.enabled !== undefined) { where.push('td.enabled = ?'); params.push(q.enabled); }

  const whereSql = where.join(' AND ');
  const totalRow = await queryOne<any>(`SELECT COUNT(*) AS cnt FROM tag_definition td WHERE ${whereSql}`, params);
  const total = Number(totalRow?.cnt || 0);

  const rows = await query<any>(
    // 关联人数与重点人群/工作台同口径：个人标签只数在册人员（死亡/迁出不计入）。
    // 删除前的引用计数见下方 DELETE，那里不过滤状态——
    // 只要有人引用过就不能删，避免删掉带历史数据的标签。
    // 互斥标签按「组内优先级」只数最优先的那一枚（utils/tagExclusive.ts）：
    // 否则历史上同时挂了户籍/流动两类标签的人会被两边各数一次，
    // 工作台与标签页的数字就对不上。判定来自 tag_definition 的互斥列，
    // 以后新增互斥组这里不用改。
    // is_system：该编码是否为系统内建口径（工作台/重点人群/导出按编码取数）。
    // 前端据此把「编码」输入框锁死——系统标签的编码一改，对应统计立刻归零，
    // 而且不会有任何报错。这是 2026-10-18 那次「流动人口恒为 0」的同类风险。
    `SELECT td.*, c.name AS category_name,
       CASE WHEN td.code IN (${SYSTEM_TAG_CODES.map(() => '?').join(',')}) THEN 1 ELSE 0 END AS is_system,
       (SELECT COUNT(*) FROM person_tag pt
          WHERE pt.tag_id = td.id AND pt.status = 'ACTIVE'
            AND EXISTS (SELECT 1 FROM person p
              WHERE p.id = pt.person_id AND ${activeSql('p')})
            ${tagPersonCountExclusiveGuard('td.code', 'pt.person_id')}) AS person_count
     FROM tag_definition td LEFT JOIN tag_category c ON c.id = td.category_id
     WHERE ${whereSql} ORDER BY td.category_id, td.id LIMIT ? OFFSET ?`,
    [...SYSTEM_TAG_CODES, ...params, q.pageSize, (q.page - 1) * q.pageSize]
  );
  const result: PageResult<any> = { list: rows, total, page: q.page, pageSize: q.pageSize };
  return okPage(res, result);
});

const defSchema = z.object({
  categoryId: z.coerce.number(),
  name: z.string().min(1).max(64),
  code: z.string().min(1).max(64).regex(/^[A-Z0-9_]+$/, '编码需为大写字母/数字/下划线'),
  alias: z.string().max(255).nullable().optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, '颜色需为 #RRGGBB').default('#3978F6'),
  description: z.string().max(500).nullable().optional(),
  // 写接口：家庭标签功能已整体下线（V026），标签只允许人员维度
  objectType: z.literal('PERSON'),
  allowDuplicate: z.coerce.number().min(0).max(1).default(0),
  isSensitive: z.coerce.number().min(0).max(1).default(0),
  needAudit: z.coerce.number().min(0).max(1).default(0),
});

router.post('/definitions', requirePermission('tag:manage'), async (req: Request, res: Response) => {
  const body = defSchema.parse(req.body);
  const dup = await queryOne<any>('SELECT id FROM tag_definition WHERE code = ?', [body.code]);
  if (dup) throw new AppError('标签编码已存在', 409, 'DUPLICATE_TAG_CODE');

  // 编码别名拦截：FLOATING_PERSON / RESIDENT_POP 不是「另一枚标签」，
  // 而是同一口径的错误编码。放它落库的后果是「标签页有人数、工作台恒为 0」，
  // 且全程不报错——所以在这里挡住，并直接告知正确编码。
  const codeCheck = checkNewTagCode(body.code);
  if (!codeCheck.ok) throw new AppError(codeCheck.message, 409, codeCheck.errorCode);

  // 同名拦截：名称相同、编码不同 = 同一枚标签的两个副本。
  // 系统标签额外提示「直接启用」，因为用户往往没意识到内建那枚只是被停用了。
  // COALESCE：历史上 tag_definition.object_type 存在 NULL，直接等值比较会漏掉这些行。
  const sameName = await queryOne<any>(
    "SELECT id, code, enabled FROM tag_definition WHERE name = ? AND COALESCE(object_type, 'PERSON') = ?",
    [body.name, body.objectType]
  );
  if (sameName) {
    if (isSystemTagCode(sameName.code)) {
      throw new AppError(
        `系统已内建同名标签「${body.name}」（编码 ${sameName.code}），无需重复创建${sameName.enabled ? '' : '；它在列表里是停用状态，启用即可'}`,
        409,
        'SYSTEM_TAG_EXISTS'
      );
    }
    throw new AppError(`已存在同名标签「${body.name}」（编码 ${sameName.code}）`, 409, 'DUPLICATE_TAG_NAME');
  }

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

  const old = await queryOne<any>('SELECT id, code, name FROM tag_definition WHERE id = ?', [id]);
  if (!old) throw new AppError('标签不存在', 404, 'NOT_FOUND');

  // 系统标签的编码是统计口径的契约：工作台、重点人群、导出模板全按编码取数。
  // 名称/颜色/说明都可以改，唯独编码不能——改完不会报错，只会让对应统计静默归零。
  const codeCheck = checkTagCodeChange(old.code, body.code, old.name);
  if (!codeCheck.ok) throw new AppError(codeCheck.message, 409, codeCheck.errorCode);

  // 原先这里没有编码唯一校验，改成一个已存在的编码会直接撞库报 500（唯一索引），
  // 前端只能看到「服务器错误」。改成显式的 409 + 中文提示。
  const dup = await queryOne<any>('SELECT id FROM tag_definition WHERE code = ? AND id <> ?', [body.code, id]);
  if (dup) throw new AppError('标签编码已存在', 409, 'DUPLICATE_TAG_CODE');

  const sameName = await queryOne<any>(
    "SELECT id, code FROM tag_definition WHERE name = ? AND COALESCE(object_type, 'PERSON') = ? AND id <> ?",
    [body.name, body.objectType, id]
  );
  if (sameName) throw new AppError(`已存在同名标签「${body.name}」（编码 ${sameName.code}）`, 409, 'DUPLICATE_TAG_NAME');

  await execute(
    `UPDATE tag_definition SET category_id = ?, name = ?, code = ?, alias = ?, color = ?, description = ?, object_type = ?, allow_duplicate = ?, is_sensitive = ?, need_audit = ? WHERE id = ?`,
    [body.categoryId, body.name, body.code, body.alias || null, body.color, body.description || null, body.objectType, body.allowDuplicate, body.isSensitive, body.needAudit, id]
  );
  await writeAudit({ userId: req.user!.id, username: req.user!.username, action: 'tag:edit', request: { id, code: body.code }, result: 'SUCCESS', ip: req.ip });
  return ok(res, { id }, '标签已更新');
});

/** 删除标签定义（物理删除；已被人员引用的标签拒绝删除，建议先停用） */
router.delete('/definitions/:id', requirePermission('tag:manage'), async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const tag = await queryOne<any>('SELECT id, name FROM tag_definition WHERE id = ?', [id]);
  if (!tag) throw new AppError('标签不存在', 404, 'NOT_FOUND');

  const used = Number(
    (await queryOne<any>(
      'SELECT COUNT(*) AS cnt FROM person_tag WHERE tag_id = ?',
      [id]
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
    objectType: z.string().nullable().optional(),
    objectId: z.coerce.number().optional(),
    tagId: z.coerce.number().optional(),
    action: z.string().nullable().optional(),
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
