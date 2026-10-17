import { Router, Request, Response } from 'express';
import { query, queryOne, execute, withTransaction, pool } from '../config/db';
import { authMiddleware } from '../middleware/auth';
import { requirePermission } from '../middleware/rbac';
import { ok, okPage, AppError, PageResult } from '../utils/response';
import { writeAudit } from '../middleware/audit';
import { validateIdCard, birthFromIdCard, genderFromIdCard } from '../utils/idcard';
import { calcAge } from '../utils/age';
import { formatDate, today } from '../utils/date';
import { genPersonNo } from '../utils/id';
import { buildPersonTagFilter, buildAgeFilter } from '../utils/tagQuery';
import { DISABILITY_LEVELS, disabilityLevelLabel } from '../utils/disability';
import {
  PERSON_STATUSES,
  activeSql,
  STATUS_LABELS,
  isInactiveStatus,
} from '../utils/personStatus';
import { z } from 'zod';
import { queryEnum } from '../utils/schema';

const router = Router();
router.use(authMiddleware);

/**
 * 处理身份证/手机号：校验 + 提取出生日期/性别（明文存储）。
 * 身份证是出生日期与性别的权威来源：提取不到（无证/日期不合法）时才由调用方回退到表单值。
 */
function prepareIdentity(body: any) {
  const result: Record<string, string | null> = {};
  if (body.idCard) {
    const check = validateIdCard(body.idCard.trim().toUpperCase());
    if (!check.valid) throw new AppError(`身份证号：${check.message}`);
    const normalized = check.normalized!;
    result.id_card = normalized;
    const birth = birthFromIdCard(normalized);
    if (birth) result.birth_date = birth;
    const gender = genderFromIdCard(normalized);
    if (gender) result.gender = gender;
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
    birthDate: formatDate(row.birth_date),
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
    statusDate: formatDate(row.status_date),
    remark: row.remark,
    // 重点人群服务台账
    bankAccount: row.bank_account,
    subsidyAmount: row.subsidy_amount != null ? Number(row.subsidy_amount) : null,
    familyCondition: row.family_condition,
    healthAssessment: row.health_assessment,
    // 残疾专项档案：只有 person_disability 有记录时才返回对象，
    // 列名与 person_disability 字段同名（无歧义，person 表无同名列）
    disability: row.disability_person_id
      ? {
          type: row.disability_type,
          level: row.disability_level,
          levelLabel: disabilityLevelLabel(row.disability_level),
          card: row.disability_card,
          guardianName: row.guardian_name,
          guardianPhone: row.guardian_phone,
          remark: row.disability_remark,
        }
      : null,
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
  /**
   * 只看在册（默认开启）：排除死亡/迁出人员，避免日常翻名单时混进历史档案。
   * 显式按 status 筛选时以 status 为准；前端传 activeOnly=false 可查看全部。
   */
  activeOnly: z.enum(['true', 'false']).optional().default('true'),
  minAge: z.coerce.number().optional(),
  maxAge: z.coerce.number().optional(),
  tagIds: z.string().optional(),
  tagMode: queryEnum(['ANY', 'ALL'], 'ANY'),
  sortBy: z.string().optional(),
  sortOrder: queryEnum(['asc', 'desc'], 'asc'),
});

/** 人员列表（分页 + 多条件筛选 + 标签筛选） */
router.get('/', requirePermission('person:view'), async (req: Request, res: Response) => {
  const q = listQuerySchema.parse(req.query);
  const { page, pageSize } = q;

  const where: string[] = ['1=1'];
  const params: any[] = [];

  if (q.keyword) {
    // 姓名 / 身份证号 / 手机号（含备用）模糊匹配
    where.push('(p.name LIKE ? OR p.id_card LIKE ? OR p.phone LIKE ? OR p.phone_backup LIKE ?)');
    params.push(`%${q.keyword}%`, `%${q.keyword}%`, `%${q.keyword}%`, `%${q.keyword}%`);
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
  } else if (q.activeOnly !== 'false') {
    where.push(activeSql('p'));
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

  // 计数与取页互不依赖，并行发出（原先串行，列表接口要等两次往返）
  const [totalRow, rows] = await Promise.all([
    queryOne<any>(`SELECT COUNT(*) AS cnt FROM person p WHERE ${whereSql}`, params),
    query<any>(
      `SELECT p.*, g.name AS grid_name, f.family_no AS family_name
       FROM person p
       LEFT JOIN grid g ON g.id = p.grid_id
       LEFT JOIN family f ON f.id = p.family_id
       WHERE ${whereSql}
       ORDER BY ${orderBy} ${direction}
       LIMIT ? OFFSET ?`,
      [...params, pageSize, (page - 1) * pageSize]
    ),
  ]);
  const total = Number(totalRow?.cnt || 0);

  // 批量取标签，避免 N+1
  const personIds = rows.map((r: any) => r.id);
  const tagMap: Map<number, any[]> = new Map();
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
    // disability_person_id 用于判断有无残疾档案；pd.remark 与 person.remark 同名，
    // 必须显式取别名，否则 p.* 的 remark 会覆盖它（连接查询中同名列后者优先）。
    // 残疾类别/等级/证号/监护人等列必须逐一显式 SELECT——此前只取了 pd.remark，
    // 其余列全为 undefined，导致「已建档」但详情页残疾类别/等级一片空白。
    `SELECT p.*, g.name AS grid_name, f.family_no AS family_name,
            pd.person_id AS disability_person_id,
            pd.disability_type, pd.disability_level, pd.disability_card,
            pd.guardian_name, pd.guardian_phone, pd.remark AS disability_remark
     FROM person p
     LEFT JOIN grid g ON g.id = p.grid_id
     LEFT JOIN family f ON f.id = p.family_id
     LEFT JOIN person_disability pd ON pd.person_id = p.id
     WHERE p.id = ?`,
    [id]
  );
  if (!row) throw new AppError('人员不存在', 404, 'NOT_FOUND');

  const vo = toPersonVO(row);

  // 标签与变更历史互不依赖，并行取回（原先串行执行，详情页要等三次往返）
  const [tags, changes] = await Promise.all([
    query<any>(
      `SELECT pt.id AS linkId, td.id, td.name, td.code, td.color, td.object_type,
              pt.effect_date, pt.expire_date, pt.status, pt.basis, pt.created_by, pt.audited_by, pt.created_at
       FROM person_tag pt JOIN tag_definition td ON td.id = pt.tag_id
       WHERE pt.person_id = ? ORDER BY pt.created_at DESC`,
      [id]
    ),
    query<any>(
      `SELECT field_name, old_value, new_value, change_type, reason, operator_id, created_at
       FROM person_change_log WHERE person_id = ? ORDER BY created_at DESC LIMIT 50`,
      [id]
    ),
  ]);

  vo.tags = tags.map((t: any) => ({
    linkId: t.linkId,
    id: t.id,
    name: t.name,
    code: t.code,
    color: t.color,
    effectDate: formatDate(t.effect_date),
    expireDate: formatDate(t.expire_date),
    status: t.status,
    basis: t.basis,
    createdAt: t.created_at,
  }));

  vo.changes = changes;

  return ok(res, vo);
});

/**
 * 残疾专项档案读写（person_disability 与 person 一对一）。
 * 全空视为「不是残疾人」→ 删除记录；否则 upsert（INSERT ... ON DUPLICATE KEY UPDATE）。
 */
async function saveDisability(
  conn: { query: (sql: string, params?: any[]) => Promise<any> },
  personId: number,
  d: NonNullable<z.infer<typeof personSchema>['disability']>,
) {
  const values = [
    d.disabilityType || null,
    d.disabilityLevel || null,
    d.disabilityCard || null,
    d.guardianName || null,
    d.guardianPhone || null,
    d.remark || null,
  ];
  const empty = values.every((v) => v === null);
  if (empty) {
    await conn.query('DELETE FROM person_disability WHERE person_id = ?', [personId]);
    return;
  }
  await conn.query(
    `INSERT INTO person_disability
       (person_id, disability_type, disability_level, disability_card, guardian_name, guardian_phone, remark)
     VALUES (?,?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE
       disability_type = VALUES(disability_type),
       disability_level = VALUES(disability_level),
       disability_card  = VALUES(disability_card),
       guardian_name   = VALUES(guardian_name),
       guardian_phone  = VALUES(guardian_phone),
       remark          = VALUES(remark)`,
    [personId, ...values]
  );
}

/**
 * 把人员的标签同步成给定的 tagIds —— **全量覆盖**语义。
 *
 * 传 `[]` 表示清空标签，未传该字段（undefined）才表示「不动标签」，
 * 因此调用方要先判断 `body.tagIds !== undefined` 再调这里。
 *
 * 放进人员主表写入的同一个事务：标签挂不上有可能失败（标签 id 不存在等），
 * 分开写会留下「人建好了但标签没挂上」的残缺档案。
 * update 路由本身不在事务里，此时传入 pool（与 saveDisability 的做法一致）。
 *
 * 每一处增删都写 tag_change_log，与批量打标签保持同样的留痕口径。
 */
async function syncPersonTags(
  conn: { query: (sql: string, params?: any[]) => Promise<any> },
  personId: number,
  tagIds: number[],
  userId: number,
) {
  const [curRows] = (await conn.query(
    `SELECT tag_id FROM person_tag WHERE person_id = ? AND status = 'ACTIVE'`,
    [personId]
  )) as any[];
  const current = new Set<number>((curRows || []).map((r: any) => Number(r.tag_id)));
  const next = new Set<number>(tagIds);

  // 移除：当前有、新列表里没有 → 置为 INACTIVE（保留历史，不物理删除）
  for (const tagId of current) {
    if (next.has(tagId)) continue;
    await conn.query(
      `UPDATE person_tag SET status = 'INACTIVE', expire_date = CURDATE()
       WHERE person_id = ? AND tag_id = ? AND status = 'ACTIVE'`,
      [personId, tagId]
    );
    await conn.query(
      `INSERT INTO tag_change_log (object_type, object_id, tag_id, action, operator_id) VALUES ('PERSON', ?, ?, 'REMOVE', ?)`,
      [personId, tagId, userId]
    );
  }

  // 新增：新列表里有、当前没有生效记录 → 插入 ACTIVE
  for (const tagId of next) {
    if (current.has(tagId)) continue;
    await conn.query(
      `INSERT INTO person_tag (person_id, tag_id, status, created_by)
       SELECT ?, ?, 'ACTIVE', ? FROM DUAL
       WHERE NOT EXISTS (SELECT 1 FROM person_tag WHERE person_id = ? AND tag_id = ? AND status = 'ACTIVE')`,
      [personId, tagId, userId, personId, tagId]
    );
    await conn.query(
      `INSERT INTO tag_change_log (object_type, object_id, tag_id, action, operator_id) VALUES ('PERSON', ?, ?, 'ADD', ?)`,
      [personId, tagId, userId]
    );
  }
}

const personSchema = z.object({
  name: z.string().min(1, '姓名必填').max(64),
  formerName: z.string().max(64).nullable().optional(),
  gender: z.enum(['MALE', 'FEMALE'], { message: '性别不正确' }).optional(),
  birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '出生日期格式应为 YYYY-MM-DD').nullable().optional(),
  idCard: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  phoneBackup: z.string().nullable().optional(),
  hukouAddress: z.string().max(255).nullable().optional(),
  liveAddress: z.string().max(255).nullable().optional(),
  village: z.string().max(128).nullable().optional(),
  gridId: z.coerce.number().nullable().optional(),
  familyId: z.coerce.number().nullable().optional(),
  relation: z.string().nullable().optional(),
  /**
   * 必须是合法状态枚举。此前用 z.string() 可写入任意脏值（含 V007 已废弃的
   * CANCELLED），这类值不在在册白名单里，该人会静默从所有人口统计中消失。
   * 日常变更状态请走 POST /persons/:id/status（带留痕），这里仅用于建档时初始状态。
   */
status: z.enum(PERSON_STATUSES).optional(),
  remark: z.string().max(500).nullable().optional(),
  changeReason: z.string().max(255).nullable().optional(),
  /** 重点人群服务台账：银行账号 / 当前应发金额 / 家庭情况 / 身体评估 */
  bankAccount: z.string().max(32).nullable().optional(),
  subsidyAmount: z.coerce.number().min(0, '发放金额不能为负').max(999999.99, '发放金额过大').nullable().optional(),
  familyCondition: z.string().max(1000).nullable().optional(),
  healthAssessment: z.string().max(1000).nullable().optional(),
    /** 残疾专项档案（person_disability，与人员一对一） */
  disability: z.object({
    disabilityType: z.string().max(64).nullable().optional(),
    // PC 表单未选择等级时提交的是空串而非 null，z.enum 会直接拒绝
    // （Invalid enum value ... received ''）。空串按「未填」语义转 null。
    disabilityLevel: z.preprocess(
      (v) => (v === '' ? null : v),
      z.enum(DISABILITY_LEVELS).nullable().optional(),
    ),
    disabilityCard: z.string().max(64).nullable().optional(),
    guardianName: z.string().max(64).nullable().optional(),
    guardianPhone: z.string().max(20).nullable().optional(),
    remark: z.string().max(500).nullable().optional(),
  }).optional(),
  /**
   * 建档/编辑时一并维护的标签 id 列表。
   *
   * 语义是「全量覆盖」：传什么就以什么为准（传 [] 表示清空标签），
   * 未传该字段才表示不动标签。这样前端直接把多选框的值原样提交即可，
   * 不需要自己算增量。写入放在人员主表同一事务里，不会出现
   * 「人建好了但标签没挂上」的中间态。
   */
  tagIds: z.array(z.coerce.number().int().positive()).max(50, '标签数量过多').optional(),
});

/** 新增人员 */
router.post('/', requirePermission('person:create'), async (req: Request, res: Response) => {
  const body = personSchema.parse(req.body);
  const identity = prepareIdentity({ idCard: body.idCard || undefined, phone: body.phone || undefined, phoneBackup: body.phoneBackup || undefined });

  if (identity.id_card) {
    const dup = await queryOne<any>('SELECT id FROM person WHERE id_card = ?', [identity.id_card]);
    if (dup) throw new AppError('该身份证号已存在于档案中', 409, 'DUPLICATE_ID_CARD');
  }

  // 未填身份证：不进正式档案，转入待核查（与 Excel 导入同一口径——身份证是
  // 确认身份的唯一凭证，缺失即「待核查」，补录后经「确认入库」正式建档）。
  // 这样正式档案里不会出现一份没有身份证、出生日期性别都只能靠猜的记录。
  if (!identity.id_card) {
    const batchNo = `MANUAL-${Date.now().toString(36).toUpperCase()}`;
    // 表单里拿的是网格/家庭 id，待核查表存的是编号原样（与导入对齐），先换算
    let gridNo: string | null = null;
    if (body.gridId) {
      const g = await queryOne<any>('SELECT grid_no FROM grid WHERE id = ?', [body.gridId]);
      gridNo = g?.grid_no || null;
    }
    let familyNo: string | null = null;
    if (body.familyId) {
      const f = await queryOne<any>('SELECT family_no FROM family WHERE id = ?', [body.familyId]);
      familyNo = f?.family_no || null;
    }
    const pendingId = await withTransaction(async (conn) => {
      const [r] = (await conn.query(
        `INSERT INTO import_pending (batch_no, row_no, reason, reason_text, name, gender, birth_date,
           id_card, phone, phone_backup, hukou_address, live_address, village, grid_no, family_no, relation,
           raw_data, created_by)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          batchNo, null, 'ID_CARD_MISSING', '人工新增人口未填写身份证号，需补录后确认入库',
          body.name, body.gender || null, body.birthDate || null, null,
          identity.phone || null, identity.phone_backup || null,
          body.hukouAddress || null, body.liveAddress || null, body.village || null,
          gridNo, familyNo, body.relation || null,
          JSON.stringify({ source: 'MANUAL', form: req.body }),
          req.user!.id,
        ]
      )) as any[];
      return Number((r as any).insertId);
    });
    await writeAudit({ userId: req.user!.id, username: req.user!.username, action: 'person:create_pending', request: { pendingId, name: body.name }, result: 'SUCCESS', ip: req.ip });
    return ok(res, { pending: true, pendingId }, '未填写身份证号，已转入待核查人员');
  }

  const personNo = genPersonNo();
  // 人员主表、家庭成员关联、残疾档案三处写入放进同一事务：
  // 中途失败会留下「人员已建档但没归户/没有残疾档案」的残缺档案
  const newId = await withTransaction(async (conn) => {
    const [r] = (await conn.query(
      `INSERT INTO person (person_no, name, former_name, gender, birth_date, id_card, phone, phone_backup,
        hukou_address, live_address, bank_account, subsidy_amount, village, grid_id, family_id, relation,
        status, remark, family_condition, health_assessment, data_source, change_reason, created_by, updated_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        personNo, body.name, body.formerName || null, body.gender || identity.gender || 'MALE',
        // 出生日期以身份证为准（年龄口径），无身份证时才用表单填写的值
        identity.birth_date || body.birthDate || null,
        identity.id_card || null, identity.phone || null, identity.phone_backup || null,
        body.hukouAddress || null, body.liveAddress || null,
        body.bankAccount || null, body.subsidyAmount ?? null, body.village || null,
        body.gridId || null, body.familyId || null, body.relation || null,
        body.status || 'NORMAL', body.remark || null,
        body.familyCondition || null, body.healthAssessment || null,
        'MANUAL', body.changeReason || null,
        req.user!.id, req.user!.id,
      ]
    )) as any[];
    const pid = Number((r as any).insertId);

    // 若关联家庭，写入家庭成员关联
    if (body.familyId) {
      await conn.query(
        `INSERT INTO family_member (family_id, person_id, relation, is_householder) VALUES (?,?,?,?)`,
        [body.familyId, pid, body.relation || 'OTHER', body.relation === 'HEAD' ? 1 : 0]
      );
    }

    // 残疾专项档案（有内容才建记录；全空即视为非残疾人）
    if (body.disability) await saveDisability(conn, pid, body.disability);

    // 标签：建档时一并挂上，与主表同事务（未传表示不打标签，传 [] 则是空集合，
    // 二者结果一致，这里只在显式传了时才写，保持「不动标签」的语义）
    if (body.tagIds !== undefined) await syncPersonTags(conn, pid, body.tagIds, req.user!.id);

    return pid;
  });

  await writeAudit({ userId: req.user!.id, username: req.user!.username, action: 'person:create', request: { personNo, name: body.name }, result: 'SUCCESS', ip: req.ip });
  return ok(res, { id: newId, personNo }, '新增成功');
});

/** 编辑人员 */
router.put('/:id', requirePermission('person:edit'), async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const existing = await queryOne<any>('SELECT * FROM person WHERE id = ?', [id]);
  if (!existing) throw new AppError('人员不存在', 404, 'NOT_FOUND');

  const body = personSchema.partial().parse(req.body);
  /**
   * 只把「非空」的身份证/手机号交给 prepareIdentity 做校验与派生。
   * 注意必须区分 undefined（未提交，保持原值）与 ''（用户清空）：
   * 早期写法 `body.idCard || undefined` 会把清空意图也吞成 undefined，
   * 导致界面上删掉手机号后保存又变回原值。
   */
  const identity = prepareIdentity({
    idCard: body.idCard ? body.idCard : undefined,
    phone: body.phone ? body.phone : undefined,
    phoneBackup: body.phoneBackup ? body.phoneBackup : undefined,
  });

  if (identity.id_card) {
    const dup = await queryOne<any>('SELECT id FROM person WHERE id_card = ? AND id <> ?', [identity.id_card, id]);
    if (dup) throw new AppError('该身份证号已被其他档案使用', 409, 'DUPLICATE_ID_CARD');
  }

  // 构建动态更新
  const sets: string[] = [];
  const params: any[] = [];
  const fieldMap: Record<string, string> = {
    name: 'name', formerName: 'former_name', gender: 'gender',
    phone: 'phone', phoneBackup: 'phone_backup', idCard: 'id_card',
    hukouAddress: 'hukou_address', liveAddress: 'live_address', village: 'village',
    gridId: 'grid_id', familyId: 'family_id', relation: 'relation', remark: 'remark', changeReason: 'change_reason',
    bankAccount: 'bank_account', familyCondition: 'family_condition', healthAssessment: 'health_assessment',
  };
  for (const [key, col] of Object.entries(fieldMap)) {
    if ((body as any)[key] !== undefined) {
      sets.push(`${col} = ?`);
      params.push((body as any)[key] === '' ? null : (body as any)[key]);
    }
  }
  /**
   * 出生日期（决定年龄）以身份证为权威来源，单独处理、不放进 fieldMap：
   * 只要提交的身份证能解析出出生日期，就重算覆盖表单里的旧值——
   * 此前「表单值优先」会让改了身份证号的人年龄仍旧不变。
   * 没有身份证（或日期不合法）时才采用表单填写的值。
   */
  if (identity.birth_date !== undefined) {
    sets.push('birth_date = ?');
    params.push(identity.birth_date);
  } else if (body.birthDate !== undefined) {
    sets.push('birth_date = ?');
    params.push(body.birthDate === '' ? null : body.birthDate);
  }
  // id_card / phone / phone_backup 已在 fieldMap 中统一处理（含清空场景）
  if (identity.gender !== undefined && body.gender === undefined) { sets.push('gender = ?'); params.push(identity.gender); }
  // 发放金额：0 是合法值（享受但金额为 0），故用 ?? 而非 || 判断
  if (body.subsidyAmount !== undefined) { sets.push('subsidy_amount = ?'); params.push(body.subsidyAmount ?? null); }

  // 残疾档案与人员主表一并写入：独立 upsert，不影响 sets 动态更新的判定
  if (body.disability !== undefined) {
    await saveDisability(pool, id, body.disability);
  }

  // 标签全量覆盖：未传该字段表示不动标签（避免「只想改地址却把标签清了」）
  if (body.tagIds !== undefined) {
    await syncPersonTags(pool, id, body.tagIds, req.user!.id);
  }

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

/**
 * 删除人员（物理删除，不可逆）。
 * 会连带清除身份证号、手机号、标签、家庭成员关联、残疾档案与全部变更留痕，
 * 因此权限独立为 person:delete（V009，仅系统管理员），
 * 不再与可逆的「编辑」「死亡登记」共用权限。
 * 调用方必须在前端做二次确认。
 */
router.delete('/:id', requirePermission('person:delete'), async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const person = await queryOne<any>('SELECT id, name FROM person WHERE id = ?', [id]);
  if (!person) throw new AppError('人员不存在', 404, 'NOT_FOUND');

  await withTransaction(async (conn) => {
    // 清理关联数据，避免留下孤儿记录（库内无外键约束，需手动处理）
    await conn.query('DELETE FROM person_tag WHERE person_id = ?', [id]);
    await conn.query('DELETE FROM family_member WHERE person_id = ?', [id]);
    await conn.query('DELETE FROM person_change_log WHERE person_id = ?', [id]);
    await conn.query('DELETE FROM person_disability WHERE person_id = ?', [id]);
    // 标签变更日志按 object_id 记录人员，不清会在「标签历史」里残留悬空对象 ID
    await conn.query("DELETE FROM tag_change_log WHERE object_type = 'PERSON' AND object_id = ?", [id]);
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
  status: z.enum(PERSON_STATUSES),
  /** 状态生效日期：死亡记死亡日期、迁出记迁出日期；改回在册时前端传 null 清空 */
  statusDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '生效日期格式应为 YYYY-MM-DD').nullable().optional(),
  reason: z.string().max(255).nullable().optional(),
});

/**
 * 人员状态变更（迁入/迁出/死亡登记，不删除档案）。
 * 死亡与迁出一律走这里：档案、标签与变更记录全部保留，
 * 仅在人口统计中被排除（在册口径 NORMAL/MOVED_IN）。
 */
router.post('/:id/status', requirePermission('person:status'), async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const { status, statusDate, reason } = statusSchema.parse(req.body);
  const existing = await queryOne<any>('SELECT id, name, status FROM person WHERE id = ?', [id]);
  if (!existing) throw new AppError('人员不存在', 404, 'NOT_FOUND');
  if (existing.status === status) {
    throw new AppError(`该人员当前已是「${STATUS_LABELS[status]}」状态`, 400, 'NO_CHANGE');
  }

  // 生效日期：不传时非在册默认取当天（死亡/迁出当天），改回在册则清空
  const effectiveDate = statusDate === null
    ? null
    : statusDate || (isInactiveStatus(status) ? today() : null);

  await withTransaction(async (conn) => {
    await conn.query(
      'UPDATE person SET status = ?, status_date = ?, change_reason = ?, updated_by = ? WHERE id = ?',
      [status, effectiveDate, reason || null, req.user!.id, id]
    );
    await conn.query(
      `INSERT INTO person_change_log (person_id, field_name, old_value, new_value, change_type, reason, operator_id)
       VALUES (?, 'status', ?, ?, 'STATUS_CHANGE', ?, ?)`,
      [id, existing.status, status, reason || null, req.user!.id]
    );
    // 转为非在册（迁出/死亡）时，家庭成员关联标记离开，家庭本身保留。
    // 改回在册时必须反向恢复——原先只做单向标记，导致「迁出后又迁回」的人
    // 虽然回到人口统计里，却不在任何家庭的成员列表中（家庭成员数对不上）。
    if (isInactiveStatus(status)) {
      await conn.query('UPDATE family_member SET status = 0, leave_date = CURDATE() WHERE person_id = ?', [id]);
    } else {
      await conn.query(
        'UPDATE family_member SET status = 1, leave_date = NULL WHERE person_id = ? AND status = 0',
        [id]
      );
    }
  });

  await writeAudit({ userId: req.user!.id, username: req.user!.username, action: 'person:status', request: { id, status, statusDate: effectiveDate, reason }, result: 'SUCCESS', ip: req.ip });
  return ok(res, { id, status, statusDate: effectiveDate }, `已变更为「${STATUS_LABELS[status]}」`);
});

const batchStatusSchema = z.object({
  personIds: z.array(z.number().int().positive()).min(1).max(500),
  status: z.enum(PERSON_STATUSES),
  statusDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '生效日期格式应为 YYYY-MM-DD').nullable().optional(),
  reason: z.string().max(255).nullable().optional(),
});

/**
 * 批量状态变更（如一次性登记多名迁出/死亡人员）。
 * 单事务内完成，已是目标状态的人员自动跳过（不计入成功数），逐人留变更记录。
 */
router.post('/batch-status', requirePermission('person:status'), async (req: Request, res: Response) => {
  const { personIds, status, statusDate, reason } = batchStatusSchema.parse(req.body);
  const effectiveDate = statusDate === null
    ? null
    : statusDate || (isInactiveStatus(status) ? today() : null);

  let changed = 0;
  let skipped = 0;
  const inactive = isInactiveStatus(status);

  await withTransaction(async (conn) => {
    for (const pid of personIds) {
      const [rows] = (await conn.query('SELECT status FROM person WHERE id = ?', [pid])) as any[];
      const current = rows[0]?.status;
      if (!current || current === status) { skipped++; continue; }
      await conn.query(
        'UPDATE person SET status = ?, status_date = ?, change_reason = ?, updated_by = ? WHERE id = ?',
        [status, effectiveDate, reason || null, req.user!.id, pid]
      );
      await conn.query(
        `INSERT INTO person_change_log (person_id, field_name, old_value, new_value, change_type, reason, operator_id)
         VALUES (?, 'status', ?, ?, 'STATUS_CHANGE', ?, ?)`,
        [pid, current, status, reason || null, req.user!.id]
      );
      if (inactive) {
        await conn.query('UPDATE family_member SET status = 0, leave_date = CURDATE() WHERE person_id = ?', [pid]);
      } else {
        await conn.query('UPDATE family_member SET status = 1, leave_date = NULL WHERE person_id = ? AND status = 0', [pid]);
      }
      changed++;
    }
  });

  await writeAudit({ userId: req.user!.id, username: req.user!.username, action: 'person:batch-status', request: { count: personIds.length, status, statusDate: effectiveDate, reason }, result: 'SUCCESS', ip: req.ip });
  return ok(
    res,
    { changed, skipped, status },
    skipped ? `已变更 ${changed} 人，${skipped} 人已是「${STATUS_LABELS[status]}」或不存在` : `已变更 ${changed} 人为「${STATUS_LABELS[status]}」`
  );
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
    effectDate: z.string().nullable().optional(),
    expireDate: z.string().nullable().optional(),
    basis: z.string().max(500).nullable().optional(),
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
  basis: z.string().max(500).nullable().optional(),
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
