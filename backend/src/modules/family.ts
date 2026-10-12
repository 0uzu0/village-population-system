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

// ==================== 按门牌号（地址）自动归户 ====================

/** 地址归一化：全角转半角、统一连字符、去空白与括号，保证「100－1号」与「100-1号」归为同一户 */
export function normalizeAddress(raw: string): string {
  if (!raw) return '';
  return String(raw)
    .replace(/[\uFF01-\uFF5E]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[－—–−~～]/g, '-')
    .replace(/[（）()]/g, '')
    .replace(/\s+/g, '')
    .trim();
}

const autoGroupSchema = z.object({
  /** UNFAMILIED=仅未归属家庭的人员（默认，安全）；ALL=全部人员重新归户 */
  scope: z.enum(['UNFAMILIED', 'ALL']).default('UNFAMILIED'),
  gridId: z.coerce.number().optional(),
  /** hukou=按户籍地址门牌号（默认）；live=按实际居住地址 */
  addressField: z.enum(['hukou', 'live']).default('hukou'),
  /** 少于该人数的门牌号不单独成户 */
  minSize: z.coerce.number().int().min(1).max(50).default(1),
  /** 1=只预览不落库（默认）；0=执行 */
  dryRun: z.coerce.number().int().min(0).max(1).default(1),
});

/** 户主判定：优先 relation=HEAD，其次年龄最大者，最后取组内第一条 */
/** 推定户主：显式 HEAD 优先，否则取出生日期最早者（年龄最长） */
function pickHead(list: any[]): any {
  const head = list.find((p) => p.relation === 'HEAD');
  if (head) return head;
  const withBirth = list.filter((p) => p.birth_date);
  if (withBirth.length) {
    // 用字符串比较而非 new Date().getTime()：DATE 列已配 dateStrings 返回
    // 'YYYY-MM-DD'，字典序即时间序；转 Date 会在非 +08:00 环境（CI/容器）
    // 把字符串按 UTC、Date 按本地解析，混排时结果不可靠
    return [...withBirth].sort((a, b) => String(a.birth_date).localeCompare(String(b.birth_date)))[0];
  }
  return list[0];
}

/**
 * 按门牌号自动归户：把同一门牌号的人员归入同一个家庭。
 * 默认只处理尚未归属家庭的人员，且默认只预览不落库，避免误操作覆盖已有家庭结构。
 */
router.post('/auto-group', requirePermission('family:manage'), async (req: Request, res: Response) => {
  const body = autoGroupSchema.parse(req.body);
  const dryRun = body.dryRun === 1;
  const field = body.addressField === 'live' ? 'live_address' : 'hukou_address';

  const where: string[] = [`p.${field} IS NOT NULL`, `p.${field} <> ''`];
  const params: any[] = [];
  if (body.scope === 'UNFAMILIED') where.push('p.family_id IS NULL');
  if (body.gridId) { where.push('p.grid_id = ?'); params.push(body.gridId); }

  const persons = await query<any>(
    `SELECT p.id, p.name, p.relation, p.grid_id, p.birth_date, p.hukou_address, p.live_address
     FROM person p WHERE ${where.join(' AND ')}`,
    params
  );

  // 按归一化门牌号分组
  const groups = new Map<string, { key: string; address: string; members: any[] }>();
  let skippedNoAddress = 0;
  for (const p of persons) {
    const key = normalizeAddress(p[field]);
    if (!key) { skippedNoAddress++; continue; }
    if (!groups.has(key)) groups.set(key, { key, address: String(p[field]).trim(), members: [] });
    groups.get(key)!.members.push(p);
  }

  // 已有家庭（按归一化地址匹配，避免重复建户）
  const existingFamilies = await query<any>('SELECT id, address, grid_id FROM family WHERE status = 1');
  const familyByAddr = new Map<string, any>();
  for (const f of existingFamilies) {
    const k = normalizeAddress(f.address);
    if (k && !familyByAddr.has(k)) familyByAddr.set(k, f);
  }

  const plans: { key: string; address: string; count: number; headName: string; familyId: number | null; reuse: boolean }[] = [];
  let personsToAssign = 0;
  let familiesToCreate = 0;
  let familiesToReuse = 0;
  let skippedSmall = 0;

  for (const g of [...groups.values()].sort((a, b) => b.members.length - a.members.length)) {
    if (g.members.length < body.minSize) { skippedSmall += g.members.length; continue; }
    const head = pickHead(g.members);
    const existing = familyByAddr.get(g.key) || null;
    if (existing) familiesToReuse++; else familiesToCreate++;
    personsToAssign += g.members.length;
    plans.push({
      key: g.key,
      address: g.address,
      count: g.members.length,
      headName: head.name,
      familyId: existing ? existing.id : null,
      reuse: !!existing,
    });
  }

  const summary = {
    dryRun,
    scope: body.scope,
    addressField: body.addressField,
    totalPersons: persons.length,
    skippedNoAddress,
    skippedSmall,
    groupCount: plans.length,
    familiesToCreate,
    familiesToReuse,
    personsToAssign,
  };

  if (dryRun) {
    return ok(res, { ...summary, preview: plans.slice(0, 20) }, '预览完成，未写入数据');
  }

  // 正式执行
  let created = 0;
  let assigned = 0;
  await withTransaction(async (conn) => {
    for (const g of [...groups.values()]) {
      if (g.members.length < body.minSize) continue;
      const head = pickHead(g.members);
      let familyId: number = familyByAddr.get(g.key)?.id;

      if (!familyId) {
        const familyNo = genFamilyNo();
        const r: any = await conn.query(
          'INSERT INTO family (family_no, address, grid_id, head_person_id) VALUES (?,?,?,?)',
          [familyNo, g.address, head.grid_id || null, null]
        );
        familyId = (r[0] as any).insertId;
        familyByAddr.set(g.key, { id: familyId, address: g.address });
        created++;
      }

      for (const m of g.members) {
        const isHead = m.id === head.id;
        const relation = isHead ? 'HEAD' : m.relation || 'OTHER';
        await conn.query(
          `INSERT INTO family_member (family_id, person_id, relation, is_householder) VALUES (?,?,?,?)
           ON DUPLICATE KEY UPDATE relation = VALUES(relation), is_householder = VALUES(is_householder), status = 1, leave_date = NULL`,
          [familyId, m.id, relation, isHead ? 1 : 0]
        );
        await conn.query('UPDATE person SET family_id = ?, relation = ? WHERE id = ?', [familyId, relation, m.id]);
        assigned++;
      }

      await conn.query('UPDATE family SET head_person_id = ? WHERE id = ?', [head.id, familyId]);
    }
  });

  await writeAudit({
    userId: req.user!.id,
    username: req.user!.username,
    action: 'family:auto_group',
    request: { scope: body.scope, addressField: body.addressField, gridId: body.gridId || null, minSize: body.minSize, created, assigned },
    result: 'SUCCESS',
    ip: req.ip,
  });

  return ok(res, { ...summary, createdFamilies: created, assignedPersons: assigned, preview: plans.slice(0, 20) }, `已归户 ${assigned} 人，新建家庭 ${created} 户`);
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
            p.id, p.name, p.gender, p.birth_date, p.person_no, p.id_card, p.phone, p.phone_backup, p.status
     FROM family_member fm JOIN person p ON p.id = fm.person_id
     WHERE fm.family_id = ? AND fm.status = 1
     ORDER BY fm.is_householder DESC, fm.id`,
    [id]
  );
  fam.members = members.map((m: any) => ({
    memberId: m.memberId,
    relation: m.relation,
    isHouseholder: !!m.is_householder,
    joinDate: m.join_date,
    person: {
      id: m.id, name: m.name, gender: m.gender, birthDate: m.birth_date, personNo: m.person_no,
      idCard: m.id_card, phone: m.phone, phoneBackup: m.phone_backup, status: m.status,
    },
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
    // 标签变更日志按 object_id 记录家庭，不清会在「标签历史」里残留悬空对象 ID
    await conn.query("DELETE FROM tag_change_log WHERE object_type = 'FAMILY' AND object_id = ?", [id]);
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
