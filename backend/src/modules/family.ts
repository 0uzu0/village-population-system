import { Router, Request, Response } from 'express';
import { query, queryOne, execute, withTransaction } from '../config/db';
import { authMiddleware } from '../middleware/auth';
import { requirePermission } from '../middleware/rbac';
import { ok, okPage, AppError, PageResult } from '../utils/response';
import { writeAudit } from '../middleware/audit';
import { activeFamilySql, activeMemberCountSql } from '../utils/familySql';
import { memberLeaveReason } from '../utils/familyMembership';
import { isActiveStatus, STATUS_LABELS } from '../utils/personStatus';
import { normalizeRelation } from '../utils/relation';
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
});

/** 家庭列表 */
router.get('/', requirePermission('family:view'), async (req: Request, res: Response) => {
  const q = listSchema.parse(req.query);
  // 在册家庭 = 未停用 + 至少一名在册成员（utils/familySql.ts 是唯一口径）。
  // 全户死亡/迁出后，这一户不再出现在列表里，也不再计入家庭总数——
  // 但档案与关联都还在，人员改回在册时它会自动回来。
  const where: string[] = [activeFamilySql('f')];
  const params: any[] = [];

  if (q.keyword) {
    where.push('(f.family_no LIKE ? OR p.name LIKE ?)');
    params.push(`%${q.keyword}%`, `%${q.keyword}%`);
  }
  if (q.gridId) {
    where.push('f.grid_id = ?');
    params.push(q.gridId);
  }

  const whereSql = where.join(' AND ');
  const totalRow = await queryOne<any>(`SELECT COUNT(DISTINCT f.id) AS cnt FROM family f LEFT JOIN person p ON p.id = f.head_person_id WHERE ${whereSql}`, params);
  const total = Number(totalRow?.cnt || 0);

  const rows = await query<any>(
    `SELECT f.id, f.family_no, f.address, f.grid_id, f.head_person_id,
            g.name AS grid_name, hp.name AS head_name, hp.status AS head_status,
            ${activeMemberCountSql('f')} AS member_count
     FROM family f
     LEFT JOIN grid g ON g.id = f.grid_id
     LEFT JOIN person hp ON hp.id = f.head_person_id
     LEFT JOIN person p ON p.id = f.head_person_id
     WHERE ${whereSql}
     ORDER BY f.id
     LIMIT ? OFFSET ?`,
    [...params, q.pageSize, (q.page - 1) * q.pageSize]
  );

  const list = rows.map((r: any) => ({ ...r }));
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
        const relation = isHead ? 'HEAD' : (normalizeRelation(m.relation) ?? 'OTHER');
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

  // 离户成员：迁出、死亡、以及被手工移出家庭的人。
  // 早先这里只查 fm.status = 1，人一死就整行消失——家庭页看不到「已故」，
  // 家属来核对时会以为数据丢了。去向由人员状态现算（memberLeaveReason），
  // 不再单独存一列 leave_reason：两个真值迟早对不上。
  const former = await query<any>(
    `SELECT fm.id AS memberId, fm.relation, fm.is_householder, fm.join_date, fm.leave_date,
            p.id, p.name, p.gender, p.birth_date, p.person_no, p.status
     FROM family_member fm JOIN person p ON p.id = fm.person_id
     WHERE fm.family_id = ? AND fm.status = 0
     ORDER BY fm.leave_date IS NULL, fm.leave_date DESC, fm.id DESC`,
    [id]
  );
  fam.formerMembers = former.map((m: any) => ({
    memberId: m.memberId,
    relation: m.relation,
    isHouseholder: !!m.is_householder,
    joinDate: m.join_date,
    leaveDate: m.leave_date,
    leaveReason: memberLeaveReason(m.status),
    person: {
      id: m.id, name: m.name, gender: m.gender, birthDate: m.birth_date, personNo: m.person_no,
      status: m.status,
    },
  }));

  // 已灭户：档案还在（可追溯），但不再计入家庭总数与家庭列表
  fam.activeMemberCount = fam.members.length;
  fam.dissolved = fam.members.length === 0;

  return ok(res, fam);
});

const familySchema = z.object({
  address: z.string().max(255).nullable().optional(),
  gridId: z.coerce.number().nullable().optional(),
  headPersonId: z.coerce.number().nullable().optional(),
});

/** 新增家庭 */
router.post('/', requirePermission('family:manage'), async (req: Request, res: Response) => {
  const body = familySchema.parse(req.body);
  if (body.headPersonId) await assertActivePerson(body.headPersonId, 'HEAD');
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
       ON DUPLICATE KEY UPDATE relation = 'HEAD', is_householder = 1, status = 1, leave_date = NULL`,
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
  if (body.headPersonId) await assertActivePerson(body.headPersonId, 'HEAD');
  await execute('UPDATE family SET address = ?, grid_id = ?, head_person_id = ? WHERE id = ?', [
    body.address || null, body.gridId || null, body.headPersonId || existing.head_person_id, id,
  ]);
  return ok(res, { id }, '家庭已更新');
});

const memberSchema = z.object({
  personId: z.coerce.number(),
  // 入口收口在 schema：网页下拉传 HEAD/SPOUSE…，MCP 工具可能传「配偶」「女儿」，
  // 导入补偿也可能传中文。这里统一归一，下游不必再各自判断
  relation: z
    .string()
    .min(1, '与户主关系必填')
    .transform((v) => normalizeRelation(v) ?? 'OTHER'),
  isHouseholder: z.coerce.number().min(0).max(1).default(0),
});

/**
 * 户主与在户成员必须是在册人员。
 *
 * 已故/迁出的人可以留在家庭的「离户成员」里（档案追溯），但不能被当成
 * 在户成员或户主——否则家庭人数按在册口径算不出来，列表里还会出现
 * 「户主：张三（已故）」。明确报错并给出补救方式，比静默接受更好排查。
 */
async function assertActivePerson(personId: number, role: 'HEAD' | 'MEMBER'): Promise<void> {
  const p = await queryOne<any>('SELECT id, name, status FROM person WHERE id = ?', [personId]);
  if (!p) throw new AppError('人员不存在', 404, 'NOT_FOUND');
  if (!isActiveStatus(p.status)) {
    throw new AppError(
      `「${p.name}」当前为「${STATUS_LABELS[p.status] || p.status}」状态，不能${role === 'HEAD' ? '设为户主' : '加入家庭'}；如确需操作，请先把人员状态改回正常`,
      400,
      'PERSON_INACTIVE'
    );
  }
}

/** 添加家庭成员 */
router.post('/:id/members', requirePermission('family:manage'), async (req: Request, res: Response) => {
  const fid = Number(req.params.id);
  const { personId, relation, isHouseholder } = memberSchema.parse(req.body);
  await assertActivePerson(personId, 'MEMBER');

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

/** 删除家庭（物理删除，事务内清理成员关系；成员人员档案保留，仅解除归属） */
router.delete('/:id', requirePermission('family:manage'), async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const family = await queryOne<any>('SELECT id, family_no FROM family WHERE id = ?', [id]);
  if (!family) throw new AppError('家庭不存在', 404, 'NOT_FOUND');

  await withTransaction(async (conn) => {
    // 清理关联数据（库内无外键约束，需手动处理）
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
  await assertActivePerson(personId, 'HEAD');
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

export default router;
