import { Router, Request, Response } from 'express';
import { query, queryOne, execute, withTransaction } from '../config/db';
import { authMiddleware } from '../middleware/auth';
import { requirePermission, buildGridFilter } from '../middleware/rbac';
import { ok, okPage, fail, AppError, PageResult } from '../utils/response';
import { writeAudit } from '../middleware/audit';
import { validateIdCard, birthFromIdCard, genderFromIdCard } from '../utils/idcard';
import { calcAge } from '../utils/age';
import { buildPersonTagFilter, combineFilters, buildAgeFilter } from '../utils/tagQuery';
import { z } from 'zod';

const router = Router();
router.use(authMiddleware);

/** 生成内部人员编号：P + 时间戳 + 随机 */
function genPersonNo(): string {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `P${ts}${rand}`;
}

/** 处理身份证/手机号：校验 + 提取出生日期/性别（明文存储） */
function prepareIdentity(body: any) {
  const result: Record<string, string | null> = {};
  if (body.idCard) {
    const check = validateIdCard(body.idCard.trim().toUpperCase());
    if (!check.valid) throw new AppError(`身份证号：${check.message}`);
    const normalized = check.normalized!;
    result.id_card = normalized;
    if (!body.birthDate) result.birth_date = birthFromIdCard(normalized)!;
    if (!body.gender) result.gender = genderFromIdCard(normalized)!;
  }
  if (body.phone) {
    result.phone = body.phone;
  }
  if (body.phoneBackup) {
    result.phone_backup = body.phoneBackup;
  }
  return result;
}

/** 将 DB 行转为前端展示结构 */
function toPersonVO(row: any): any {
  return {
    id: row.id,
    personNo: row.person_no,
    name: row.name,
    formerName: row.former_name,
    gender: row.gender,
    birthDate: row.birth_date ? new Date(row.birth_date).toISOString().slice(0, 10) : null,
    age: calcAge(row.birth_date),
    idCard: row.id_card,
    phone: row.phone,
    phoneBackup: row.phone_backup,
    hukouAddress: row.hukou_address,
    liveAddress: row.live_address,
    village: row.village,
    gridId: row.grid_id,
    gridName: row.grid_name,
    familyId: row.family_id,
    familyName: row.family_name,
    relation: row.relation,
    status: row.status,
    remark: row.remark,
    dataSource: row.data_source,
    updatedAt: row.updated_at,
    tags: row.tags || [],
  };
}

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
  keyword: z.string().optional(),
  gender: z.string().optional(),
  gridId: z.coerce.number().optional(),
  familyId: z.coerce.number().optional(),
  village: z.string().optional(),
  status: z.string().optional(),
  minAge: z.coerce.number().optional(),
  maxAge: z.coerce.number().optional(),
  tagIds: z.string().optional(),
  tagMode: z.enum(['ANY', 'ALL']).or(z.literal('')).default('ANY'),
  sortBy: z.string().optional(),
  sortOrder: z.enum(['asc', 'desc']).or(z.literal('')).default('asc'),
});

/** 人员列表（分页 + 多条件筛选 + 标签筛选） */
router.get('/', requirePermission('person:view'), async (req: Request, res: Response) => {
  const q = listQuerySchema.parse(req.query);
  const { page, pageSize } = q;

  const where: string[] = ['1=1'];
  const params: any[] = [];

  if (q.keyword) {
    where.push('(p.name LIKE ? OR p.person_no LIKE ?)');
    params.push(`%${q.keyword}%`, `%${q.keyword}%`);
  }
  if (q.gender) {
    where.push('p.gender = ?');
    params.push(q.gender);
  }
  if (q.gridId) {
    where.push('p.grid_id = ?');
    params.push(q.gridId);
  }
  if (q.familyId) {
    where.push('p.family_id = ?');
    params.push(q.familyId);
  }
  if (q.village) {
    where.push('p.village = ?');
    params.push(q.village);
  }
  if (q.status) {
    where.push('p.status = ?');
    params.push(q.status);
  }

  // 网格数据范围（已简化为全部数据，恒不过滤）
  const gridFilter = buildGridFilter(req, 'p.grid_id');
  if (gridFilter.where) {
    where.push(gridFilter.where.replace(/^ AND /, ''));
    params.push(...gridFilter.params);
  }

  // 年龄区间
  const ageFilter = buildAgeFilter(q.minAge, q.maxAge, 'p');
  if (ageFilter.where) {
    where.push(ageFilter.where.replace(/^ AND /, ''));
    params.push(...ageFilter.params);
  }

  // 标签筛选
  if (q.tagIds) {
    const tagIds = q.tagIds.split(',').map((s) => parseInt(s, 10)).filter((n) => !isNaN(n));
    const tagFilter = buildPersonTagFilter({ tags: tagIds, mode: q.tagMode === 'ALL' ? 'ALL' : 'ANY' }, 'p');
    if (tagFilter.where) {
      where.push(tagFilter.where.replace(/^ AND /, ''));
      params.push(...tagFilter.params);
    }
  }

  const whereSql = where.join(' AND ');

  const totalRow = await queryOne<any>(
    `SELECT COUNT(*) AS cnt FROM person p WHERE ${whereSql}`,
    params
  );
  const total = Number(totalRow?.cnt || 0);

  // 排序字段白名单：sortBy 来自前端查询参数，禁止直接拼接进 SQL，否则可被注入。
  // key 同时接受前端表格的 snake_case 与 camelCase 写法
  const SORTABLE: Record<string, string> = {
    id: 'p.id',
    name: 'p.name',
    person_no: 'p.person_no',
    personNo: 'p.person_no',
    age: 'p.birth_date',
    birth_date: 'p.birth_date',
    birthDate: 'p.birth_date',
    gender: 'p.gender',
    grid_id: 'p.grid_id',
    gridId: 'p.grid_id',
    status: 'p.status',
    updated_at: 'p.updated_at',
    updatedAt: 'p.updated_at',
  };
  const orderBy = q.sortBy && SORTABLE[q.sortBy] ? SORTABLE[q.sortBy] : 'p.id';
  const direction = q.sortOrder === 'desc' ? 'DESC' : 'ASC';

  const rows = await query<any>(
    `SELECT p.*, g.name AS grid_name, f.family_no AS family_name
     FROM person p
     LEFT JOIN grid g ON g.id = p.grid_id
     LEFT JOIN family f ON f.id = p.family_id
     WHERE ${whereSql}
     ORDER BY ${orderBy} ${direction}
     LIMIT ? OFFSET ?`,
    [...params, pageSize, (page - 1) * pageSize]
  );

  // 批量取标签，避免 N+1
  const personIds = rows.map((r: any) => r.id);
  let tagMap: Map<number, any[]> = new Map();
  if (personIds.length) {
    const tags = await query<any>(
      `SELECT pt.person_id, td.id, td.name, td.code, td.color
       FROM person_tag pt
       JOIN tag_definition td ON td.id = pt.tag_id
       WHERE pt.person_id IN (${personIds.map(() => '?').join(',')}) AND pt.status = 'ACTIVE'
       ORDER BY td.category_id, td.id`,
      personIds
    );
    for (const t of tags) {
      if (!tagMap.has(t.person_id)) tagMap.set(t.person_id, []);
      tagMap.get(t.person_id)!.push({ id: t.id, name: t.name, code: t.code, color: t.color });
    }
  }

  const list = rows.map((r: any) => toPersonVO({ ...r, tags: tagMap.get(r.id) || [] }));
  const result: PageResult<any> = { list, total, page, pageSize };
  return okPage(res, result);
});

/** 详情（含标签、标签历史、变更历史） */
router.get('/:id', requirePermission('person:view'), async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const row = await queryOne<any>(
    `SELECT p.*, g.name AS grid_name, f.family_no AS family_name
     FROM person p
     LEFT JOIN grid g ON g.id = p.grid_id
     LEFT JOIN family f ON f.id = p.family_id
     WHERE p.id = ?`,
    [id]
  );
  if (!row) throw new AppError('人员不存在', 404, 'NOT_FOUND');

  const vo = toPersonVO(row);

  // 标签（当前有效）
  const tags = await query<any>(
    `SELECT pt.id AS linkId, td.id, td.name, td.code, td.color, td.object_type,
            pt.effect_date, pt.expire_date, pt.status, pt.basis, pt.created_by, pt.audited_by, pt.created_at
     FROM person_tag pt JOIN tag_definition td ON td.id = pt.tag_id
     WHERE pt.person_id = ? ORDER BY pt.created_at DESC`,
    [id]
  );
  vo.tags = tags.map((t: any) => ({
    linkId: t.linkId,
    id: t.id,
    name: t.name,
    code: t.code,
    color: t.color,
    effectDate: t.effect_date ? new Date(t.effect_date).toISOString().slice(0, 10) : null,
    expireDate: t.expire_date ? new Date(t.expire_date).toISOString().slice(0, 10) : null,
    status: t.status,
    basis: t.basis,
    createdAt: t.created_at,
  }));

  // 变更历史
  const changes = await query<any>(
    `SELECT field_name, old_value, new_value, change_type, reason, operator_id, created_at
     FROM person_change_log WHERE person_id = ? ORDER BY created_at DESC LIMIT 50`,
    [id]
  );
  vo.changes = changes;

  return ok(res, vo);
});

const personSchema = z.object({
  name: z.string().min(1, '姓名必填').max(64),
  formerName: z.string().max(64).optional().or(z.literal('')),
  gender: z.enum(['MALE', 'FEMALE'], { message: '性别不正确' }).optional(),
  birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '出生日期格式应为 YYYY-MM-DD').optional().or(z.literal('')),
  idCard: z.string().optional().or(z.literal('')),
  phone: z.string().optional().or(z.literal('')),
  phoneBackup: z.string().optional().or(z.literal('')),
  hukouAddress: z.string().max(255).optional().or(z.literal('')),
  liveAddress: z.string().max(255).optional().or(z.literal('')),
  village: z.string().max(128).optional().or(z.literal('')),
  gridId: z.coerce.number().nullable().optional(),
  familyId: z.coerce.number().nullable().optional(),
  relation: z.string().optional().or(z.literal('')),
  status: z.string().optional(),
  remark: z.string().max(500).optional().or(z.literal('')),
  changeReason: z.string().max(255).optional().or(z.literal('')),
});

/** 新增人员 */
router.post('/', requirePermission('person:create'), async (req: Request, res: Response) => {
  const body = personSchema.parse(req.body);
  const identity = prepareIdentity({ idCard: body.idCard || undefined, phone: body.phone || undefined, phoneBackup: body.phoneBackup || undefined });

  if (identity.id_card) {
    const dup = await queryOne<any>('SELECT id FROM person WHERE id_card = ?', [identity.id_card]);
    if (dup) throw new AppError('该身份证号已存在于档案中', 409, 'DUPLICATE_ID_CARD');
  }

  const personNo = genPersonNo();
  const insertResult = await execute(
    `INSERT INTO person (person_no, name, former_name, gender, birth_date, id_card, phone, phone_backup,
      hukou_address, live_address, village, grid_id, family_id, relation, status, remark, data_source, change_reason, created_by, updated_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      personNo, body.name, body.formerName || null, body.gender || identity.gender || 'MALE',
      body.birthDate || identity.birth_date || null,
      identity.id_card || null, identity.phone || null, identity.phone_backup || null,
      body.hukouAddress || null, body.liveAddress || null, body.village || null,
      body.gridId || null, body.familyId || null, body.relation || null,
      body.status || 'NORMAL', body.remark || null, 'MANUAL', body.changeReason || null,
      req.user!.id, req.user!.id,
    ]
  );

  const newId = insertResult.insertId;

  // 若关联家庭，写入家庭成员关联
  if (body.familyId) {
    await execute(
      `INSERT INTO family_member (family_id, person_id, relation, is_householder) VALUES (?,?,?,?)`,
      [body.familyId, newId, body.relation || 'OTHER', body.relation === 'HEAD' ? 1 : 0]
    );
  }

  await writeAudit({ userId: req.user!.id, username: req.user!.username, action: 'person:create', request: { personNo, name: body.name }, result: 'SUCCESS', ip: req.ip });
  return ok(res, { id: newId, personNo }, '新增成功');
});

/** 编辑人员 */
router.put('/:id', requirePermission('person:edit'), async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const existing = await queryOne<any>('SELECT * FROM person WHERE id = ?', [id]);
  if (!existing) throw new AppError('人员不存在', 404, 'NOT_FOUND');

  const body = personSchema.partial().parse(req.body);
  const identity = prepareIdentity({ idCard: body.idCard || undefined, phone: body.phone || undefined, phoneBackup: body.phoneBackup || undefined });

  if (identity.id_card) {
    const dup = await queryOne<any>('SELECT id FROM person WHERE id_card = ? AND id <> ?', [identity.id_card, id]);
    if (dup) throw new AppError('该身份证号已被其他档案使用', 409, 'DUPLICATE_ID_CARD');
  }

  // 构建动态更新
  const sets: string[] = [];
  const params: any[] = [];
  const fieldMap: Record<string, string> = {
    name: 'name', formerName: 'former_name', gender: 'gender', birthDate: 'birth_date',
    phoneBackup: 'phone_backup',
    hukouAddress: 'hukou_address', liveAddress: 'live_address', village: 'village',
    gridId: 'grid_id', familyId: 'family_id', relation: 'relation', remark: 'remark', changeReason: 'change_reason',
  };
  for (const [key, col] of Object.entries(fieldMap)) {
    if ((body as any)[key] !== undefined) {
      sets.push(`${col} = ?`);
      params.push((body as any)[key] === '' ? null : (body as any)[key]);
    }
  }
  if (identity.id_card) { sets.push('id_card = ?'); params.push(identity.id_card); }
  if (identity.phone !== undefined) { sets.push('phone = ?'); params.push(identity.phone); }
  if (identity.gender !== undefined && body.gender === undefined) { sets.push('gender = ?'); params.push(identity.gender); }
  if (identity.birth_date !== undefined && body.birthDate === undefined) { sets.push('birth_date = ?'); params.push(identity.birth_date); }

  if (sets.length) {
    sets.push('updated_by = ?');
    params.push(req.user!.id);
    params.push(id);
    await execute(`UPDATE person SET ${sets.join(', ')} WHERE id = ?`, params);

    // 记录变更
    await execute(
      `INSERT INTO person_change_log (person_id, change_type, reason, operator_id)
       VALUES (?, 'UPDATE', ?, ?)`,
      [id, body.changeReason || null, req.user!.id]
    );
  }

  await writeAudit({ userId: req.user!.id, username: req.user!.username, action: 'person:edit', request: { id }, result: 'SUCCESS', ip: req.ip });
  return ok(res, { id }, '更新成功');
});

/** 删除人员（物理删除，事务内清理标签/家庭成员/变更日志等关联数据，不可逆） */
router.delete('/:id', requirePermission('person:edit'), async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const person = await queryOne<any>('SELECT id, name FROM person WHERE id = ?', [id]);
  if (!person) throw new AppError('人员不存在', 404, 'NOT_FOUND');

  await withTransaction(async (conn) => {
    // 清理关联数据，避免留下孤儿记录（库内无外键约束，需手动处理）
    await conn.query('DELETE FROM person_tag WHERE person_id = ?', [id]);
    await conn.query('DELETE FROM family_member WHERE person_id = ?', [id]);
    await conn.query('DELETE FROM person_change_log WHERE person_id = ?', [id]);
    // 若该人员是某户户主，解除户主引用（家庭本身保留）
    await conn.query('UPDATE family SET head_person_id = NULL WHERE head_person_id = ?', [id]);
    await conn.query('DELETE FROM person WHERE id = ?', [id]);
  });

  await writeAudit({
    userId: req.user!.id,
    username: req.user!.username,
    action: 'person:delete',
    request: { id, name: person.name },
    result: 'SUCCESS',
    ip: req.ip,
  });
  return ok(res, { id }, '人员已删除');
});

const statusSchema = z.object({
  status: z.enum(['NORMAL', 'MOVED_IN', 'MOVED_OUT', 'CANCELLED']),
  reason: z.string().max(255).optional().or(z.literal('')),
});

/** 人员状态变更（迁入/迁出/注销，不删除档案） */
router.post('/:id/status', requirePermission('person:status'), async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const { status, reason } = statusSchema.parse(req.body);
  const existing = await queryOne<any>('SELECT status FROM person WHERE id = ?', [id]);
  if (!existing) throw new AppError('人员不存在', 404, 'NOT_FOUND');

  await withTransaction(async (conn) => {
    await conn.query('UPDATE person SET status = ?, change_reason = ?, updated_by = ? WHERE id = ?', [status, reason || null, req.user!.id, id]);
    await conn.query(
      `INSERT INTO person_change_log (person_id, field_name, old_value, new_value, change_type, reason, operator_id)
       VALUES (?, 'status', ?, ?, 'STATUS_CHANGE', ?, ?)`,
      [id, existing.status, status, reason || null, req.user!.id]
    );
    // 迁出/注销时，家庭成员关联标记离开
    if (status === 'MOVED_OUT' || status === 'CANCELLED') {
      await conn.query('UPDATE family_member SET status = 0, leave_date = CURDATE() WHERE person_id = ?', [id]);
    }
  });

  await writeAudit({ userId: req.user!.id, username: req.user!.username, action: 'person:status', request: { id, status }, result: 'SUCCESS', ip: req.ip });
  return ok(res, { id, status }, '状态已更新');
});

/** 变更历史 */
router.get('/:id/changes', requirePermission('person:view'), async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const rows = await query<any>(
    'SELECT * FROM person_change_log WHERE person_id = ? ORDER BY created_at DESC LIMIT 200',
    [id]
  );
  return ok(res, rows);
});

/** 给单个人员添加标签 */
router.post('/:id/tags', requirePermission('tag:manage'), async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const schema = z.object({
    tagId: z.coerce.number(),
    effectDate: z.string().optional().or(z.literal('')),
    expireDate: z.string().optional().or(z.literal('')),
    basis: z.string().max(500).optional().or(z.literal('')),
  });
  const body = schema.parse(req.body);
  const tag = await queryOne<any>('SELECT * FROM tag_definition WHERE id = ? AND object_type = \'PERSON\'', [body.tagId]);
  if (!tag) throw new AppError('标签不存在或非个人标签', 404, 'NOT_FOUND');

  // 默认不允许重复有效关联
  if (!tag.allow_duplicate) {
    const dup = await queryOne<any>(
      `SELECT id FROM person_tag WHERE person_id = ? AND tag_id = ? AND status = 'ACTIVE'`,
      [id, body.tagId]
    );
    if (dup) throw new AppError('该人员已关联此标签', 409, 'DUPLICATE_TAG');
  }

  await execute(
    `INSERT INTO person_tag (person_id, tag_id, effect_date, expire_date, status, basis, created_by)
     VALUES (?,?,?,?,?,?,?)`,
    [id, body.tagId, body.effectDate || null, body.expireDate || null, tag.need_audit ? 'PENDING' : 'ACTIVE', body.basis || null, req.user!.id]
  );
  await execute(
    `INSERT INTO tag_change_log (object_type, object_id, tag_id, action, operator_id, remark) VALUES ('PERSON', ?, ?, 'ADD', ?, ?)`,
    [id, body.tagId, req.user!.id, body.basis || null]
  );
  return ok(res, null, '标签已添加');
});

/** 移除人员标签 */
router.delete('/:id/tags/:linkId', requirePermission('tag:manage'), async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const linkId = Number(req.params.linkId);
  const link = await queryOne<any>('SELECT * FROM person_tag WHERE id = ? AND person_id = ?', [linkId, id]);
  if (!link) throw new AppError('标签关联不存在', 404, 'NOT_FOUND');
  await execute(`UPDATE person_tag SET status = 'INACTIVE', expire_date = CURDATE() WHERE id = ?`, [linkId]);
  await execute(
    `INSERT INTO tag_change_log (object_type, object_id, tag_id, action, operator_id, remark) VALUES ('PERSON', ?, ?, 'REMOVE', ?, ?)`,
    [id, link.tag_id, req.user!.id, '移除标签']
  );
  return ok(res, null, '标签已移除');
});

const batchTagSchema = z.object({
  personIds: z.array(z.number()).min(1, '请选择人员'),
  tagIds: z.array(z.number()).min(1, '请选择标签'),
  action: z.enum(['ADD', 'REMOVE']),
  basis: z.string().max(500).optional().or(z.literal('')),
});

/** 批量打标签/移除标签（二次确认在前端） */
router.post('/batch-tags', requirePermission('tag:manage'), async (req: Request, res: Response) => {
  const { personIds, tagIds, action, basis } = batchTagSchema.parse(req.body);

  await withTransaction(async (conn) => {
    for (const pid of personIds) {
      for (const tagId of tagIds) {
        if (action === 'ADD') {
          await conn.query(
            `INSERT INTO person_tag (person_id, tag_id, status, basis, created_by)
             SELECT ?, ?, 'ACTIVE', ?, ? FROM DUAL
             WHERE NOT EXISTS (SELECT 1 FROM person_tag WHERE person_id = ? AND tag_id = ? AND status = 'ACTIVE')`,
            [pid, tagId, basis || null, req.user!.id, pid, tagId]
          );
        } else {
          await conn.query(
            `UPDATE person_tag SET status = 'INACTIVE', expire_date = CURDATE()
             WHERE person_id = ? AND tag_id = ? AND status = 'ACTIVE'`,
            [pid, tagId]
          );
        }
        await conn.query(
          `INSERT INTO tag_change_log (object_type, object_id, tag_id, action, operator_id) VALUES ('PERSON', ?, ?, ?, ?)`,
          [pid, tagId, action, req.user!.id]
        );
      }
    }
  });

  await writeAudit({ userId: req.user!.id, username: req.user!.username, action: `person:batch_tags:${action}`, request: { personIds: personIds.length, tagIds }, result: 'SUCCESS', ip: req.ip });
  return ok(res, { total: personIds.length, processed: personIds.length, skipped: 0 }, '批量操作完成');
});

/** 人员下拉选项（网格、家庭） */
router.get('/meta/options', requirePermission('person:view'), async (req: Request, res: Response) => {
  const grids = await query<any>('SELECT id, name, grid_no FROM grid WHERE status = 1 ORDER BY id');
  const families = await query<any>('SELECT id, family_no, head_person_id FROM family WHERE status = 1 ORDER BY id');
  return ok(res, { grids, families });
});

export default router;
