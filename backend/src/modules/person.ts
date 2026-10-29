import { Router, Request, Response } from 'express';
import { query, queryOne, execute, withTransaction, pool } from '../config/db';
import { authMiddleware } from '../middleware/auth';
import { requirePermission } from '../middleware/rbac';
import { ok, okPage, AppError, PageResult } from '../utils/response';
import { writeAudit } from '../middleware/audit';
import { formatDate, today } from '../utils/date';
import { genPersonNo } from '../utils/id';
import { DISABILITY_LEVELS } from '../utils/disability';
import { PERSON_STATUSES, STATUS_LABELS, isActiveStatus, isInactiveStatus } from '../utils/personStatus';
import { normalizeRelation } from '../utils/relation';
import { z } from 'zod';
import { prepareIdentity, toPersonVO, listQuerySchema, buildPersonListQuery } from '../services/personQuery';
import { syncPersonTags, resolveTagExclusivity } from '../services/personTags';
import { saveDisability } from '../services/personDisability';
import { deactivateGroupPeers } from '../utils/tagExclusive';
import {
  assertPopulationTagsAllowed,
  loadPopulationTagDefs,
  syncPopulationTagsOnStatusChange,
} from '../utils/populationTags';
import {
  countEmptiedFamilies,
  findFamiliesOfPersons,
  findVacatedHeads,
  markFamilyMemberOnStatusChange,
  syncFamilyMemberOnStatusChange,
  syncPersonFamilyOnEdit,
  updateMemberRelation,
  type VacatedHeadFamily,
} from '../utils/familyMembership';

const router = Router();
router.use(authMiddleware);

/** 人员列表（分页 + 多条件筛选 + 标签筛选） */
router.get('/', requirePermission('person:view'), async (req: Request, res: Response) => {
  const q = listQuerySchema.parse(req.query);
  const { page, pageSize } = q;

  // 条件拼装与排序白名单都在 services/personQuery.ts（读侧服务），
  // 路由这里只需要拿到 where / 排序，专注在「取数 + 组装响应」上。
  const { whereSql, params, orderBy, direction } = buildPersonListQuery(q);

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
 * 建档 / 编辑人员请求体。**导出给契约测试**（test/androidContract.test.ts）：
 * 移动端的请求体样本要拿它跑一遍，才能保证「APP 提交的字段」与「后端接受的字段」
 * 是同一份口径，而不是两边各写一遍注释。
 */
export const personSchema = z.object({
  name: z.string().min(1, '姓名必填').max(64),
  formerName: z.string().max(64).nullable().optional(),
  gender: z.preprocess((v) => (v === '' ? undefined : v), z.enum(['MALE', 'FEMALE'], { message: '性别不正确' }).optional()),
  // 空串按「未填」处理（v2.1.0）：表单只填姓名保存时其余字段都是 ''，
  // 不做这一步会先被格式校验拦下，走不到「无身份证转待核查」的分支
  birthDate: z.preprocess(
    (v) => (v === '' ? null : v),
    z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '出生日期格式应为 YYYY-MM-DD').nullable().optional()
  ),
  idCard: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  phoneBackup: z.string().nullable().optional(),
  hukouAddress: z.string().max(255).nullable().optional(),
  liveAddress: z.string().max(255).nullable().optional(),
  village: z.string().max(128).nullable().optional(),
  gridId: z.coerce.number().nullable().optional(),
  familyId: z.coerce.number().nullable().optional(),
  // 与户主关系：网页下拉传枚举码，导入补偿 / MCP 可能传「配偶」「长女」。
  // 在 schema 这一层收口，三个落库点（person 主表、family_member、import_pending）
  // 就都不会再各写各的写法
  relation: z
    .string()
    .nullable()
    .optional()
    .transform((v) => (v === undefined ? undefined : normalizeRelation(v))),
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
  /**
   * 乐观锁版本号（V022）：编辑时带回打开表单时读到的值。
   * 可选是为了向后兼容——老客户端不带就不校验；新客户端一律带。
   */
  rowVersion: z.coerce.number().int().min(0).optional(),
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
           id_card, phone, phone_backup, hukou_address, live_address, village, grid_no, family_no, relation, tag_ids,
           person_status, raw_data, created_by)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          batchNo, null, 'ID_CARD_MISSING', '人工新增人口未填写身份证号，需补录后确认入库',
          body.name, body.gender || null, body.birthDate || null, null,
          identity.phone || null, identity.phone_backup || null,
          body.hukouAddress || null, body.liveAddress || null, body.village || null,
          gridNo, familyNo, body.relation || null,
          // 建档时选择的标签存下来，确认入库时回挂（此前直接丢弃，
          // 入库后「流动人口」等标签在前端消失）
          (body.tagIds && body.tagIds.length ? body.tagIds.join(',') : null),
          // 建档时填的人员状态一并带过去（V024）：此前这张表只认默认值 NORMAL，
          // 于是「新增一位已迁出/已死亡的人」在补录身份证后会被复活成正常人口。
          // 确认入库时按这一列写 person.status，与 Excel 导入同一口径。
          body.status || 'NORMAL',
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

    // 若关联家庭，写入家庭成员关联。
    // 建档时若直接选了「迁出/死亡」，关联必须同时记为离开——否则这个人
    // 在家庭详情里是「在户成员」，在人口统计里却不存在，家庭人数也对不上。
    if (body.familyId) {
      const memberStatus = isInactiveStatus(body.status || 'NORMAL') ? 0 : 1;
      await conn.query(
        `INSERT INTO family_member (family_id, person_id, relation, is_householder, status) VALUES (?,?,?,?,?)`,
        [body.familyId, pid, body.relation || 'OTHER', body.relation === 'HEAD' ? 1 : 0, memberStatus]
      );
    }

    // 残疾专项档案（有内容才建记录；全空即视为非残疾人）
    if (body.disability) await saveDisability(conn, pid, body.disability);

    // 标签：建档时一并挂上，与主表同事务（未传表示不打标签，传 [] 则是空集合，
    // 二者结果一致，这里只在显式传了时才写，保持「不动标签」的语义）
    if (body.tagIds !== undefined) await syncPersonTags(conn, pid, body.tagIds, req.user!.id);

    // 新增动作写进变更流水（v2.1.0：工作台「近期人口档案变更」要求
    // 新增/删除都有记录；原先只有编辑与状态变更留痕）
    await conn.query(
      `INSERT INTO person_change_log (person_id, change_type, reason, operator_id)
       VALUES (?, 'CREATE', ?, ?)`,
      [pid, '新增人口档案', req.user!.id]
    );

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

  // 乐观锁前置检查（V022）：版本对不上说明打开表单之后有人改过这行，
  // 这时连一个字段都不该写——真正的兜底在同一事务的 UPDATE 条件里。
  // 不传 rowVersion 的老客户端跳过校验（向后兼容）。
  if (body.rowVersion !== undefined && Number(existing.row_version ?? 0) !== body.rowVersion) {
    throw new AppError('该人员档案已被他人修改，请刷新后重试', 409, 'VERSION_CONFLICT');
  }
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

  // 整段写入放进一个事务：主表、残疾档案、标签、变更流水要么全成、要么全不动。
  // 之前是四条独立语句，中途失败会留下「主表改了、标签没改」这种半截状态。
  await withTransaction(async (conn) => {
    const hasFieldChanges = sets.length > 0;

    sets.push('row_version = row_version + 1');
    sets.push('updated_by = ?');
    params.push(req.user!.id);
    params.push(id);

    // 版本守卫：即使前置检查通过，到真正 UPDATE 之间仍有极短的并发窗口，
    // 所以条件里再比一次。affectedRows 为 0 说明这行已被别人改过。
    let versionSql = '';
    if (body.rowVersion !== undefined) {
      versionSql = ' AND row_version = ?';
      params.push(body.rowVersion);
    }
    const [updateResult] = await conn.query(
      `UPDATE person SET ${sets.join(', ')} WHERE id = ?${versionSql}`,
      params
    );
    if (body.rowVersion !== undefined && Number((updateResult as any)?.affectedRows ?? 0) === 0) {
      // 抛出去由 withTransaction 回滚，残疾/标签的写入一起撤销
      throw new AppError('该人员档案已被他人修改，请刷新后重试', 409, 'VERSION_CONFLICT');
    }

    // 家庭归属变了就同步家庭成员关联：只改 person.family_id 会让旧家庭里
    // 他仍在户、新家庭里没有他，家庭人数与「是否在册」全跟着错。
    if (body.familyId !== undefined) {
      await syncPersonFamilyOnEdit(
        conn,
        id,
        body.familyId ?? null,
        body.relation === undefined ? existing.relation : body.relation,
        existing.status
      );
    } else if (body.relation !== undefined) {
      // 只改了与户主关系：更新在户那一行，不新建也不解除归属
      await updateMemberRelation(conn, id, body.relation);
    }

    // 残疾档案与人员主表一并写入：独立 upsert，不影响 sets 动态更新的判定
    if (body.disability !== undefined) {
      await saveDisability(conn, id, body.disability);
    }

    // 标签全量覆盖：未传该字段表示不动标签（避免「只想改地址却把标签清了」）
    if (body.tagIds !== undefined) {
      await syncPersonTags(conn, id, body.tagIds, req.user!.id);
    }

    if (hasFieldChanges) {
      await conn.query(
        `INSERT INTO person_change_log (person_id, change_type, reason, operator_id)
         VALUES (?, 'UPDATE', ?, ?)`,
        [id, body.changeReason || null, req.user!.id]
      );
    }
  });

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
  const person = await queryOne<any>('SELECT id, name, person_no FROM person WHERE id = ?', [id]);
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
    // 档案虽被物理删除，但删除动作本身要留在变更流水里（v2.1.0：
    // 工作台「近期人口档案变更」要求新增/删除都有记录）。person_id 保留
    // 原值（join 不上档案，统计侧显示「已删除人员」），姓名/编号写进 reason。
    await conn.query(
      `INSERT INTO person_change_log (person_id, change_type, reason, operator_id)
       VALUES (?, 'DELETE', ?, ?)`,
      [id, `删除人员档案：${person.name}（${person.person_no}）`, req.user!.id]
    );
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
  statusDate: z.preprocess(
    (v) => (v === '' ? null : v),
    z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '生效日期格式应为 YYYY-MM-DD').nullable().optional()
  ),
  reason: z.string().max(255).nullable().optional(),
});

/**
 * 人员状态变更（迁入/迁出/死亡登记，不删除档案）。
 * 死亡与迁出一律走这里：档案、标签与变更记录全部保留，
 * 仅在人口统计中被排除（在册口径 NORMAL/MOVED_IN）。
 *
 * v2.3 起多一步联动：户籍人口 / 流动人口这两枚**归属类**标签会随状态停用
 * （它们描述的是当前归属，不是历史身份；党员、低保、残疾这类标签照旧保留），
 * 改回在册时自动恢复原来那一枚。规则见 utils/populationTags.ts。
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

  const sync = await withTransaction(async (conn) => {
    await conn.query(
      'UPDATE person SET status = ?, status_date = ?, change_reason = ?, updated_by = ? WHERE id = ?',
      [status, effectiveDate, reason || null, req.user!.id, id]
    );
    await conn.query(
      `INSERT INTO person_change_log (person_id, field_name, old_value, new_value, change_type, reason, operator_id)
       VALUES (?, 'status', ?, ?, 'STATUS_CHANGE', ?, ?)`,
      [id, existing.status, status, reason || null, req.user!.id]
    );
    // 家庭成员关联随状态联动（utils/familyMembership.ts 是唯一实现）：
    // - 转为非在册（迁出/死亡）→ 关联标记离开，leave_date 记状态生效日期；
    // - 改回在册 → 反向恢复。原先只做单向标记，导致「迁出后又迁回」的人
    //   虽然回到人口统计里，却不在任何家庭的成员列表中（家庭成员数对不上）。
    // 家庭本身不删除：档案要留痕，是否计入家庭总数由 familySql 现算。
    const familySync = await syncFamilyMemberOnStatusChange(conn, id, status, effectiveDate);
    // 户主离户检测：只做提示，不阻断。死亡/迁出登记必须能一次办完（现场就那一趟），
    // 改选户主是随后的动作，需要人确认继任者，见 POST /families/:id/head。
    // 放在同一事务里查，读到的是「关联已标记离开」之后的状态：remaining 不含他本人。
    const headVacated = isInactiveStatus(status) ? await findVacatedHeads(conn, [id]) : [];
    // 人口归属标签随状态联动（v2.3）：迁出/死亡停用户籍/流动人口标签，
    // 改回在册时恢复最近一次被联动停用的那一枚。
    // 与 family_member 的标记放在同一事务：状态改成功而标签没改会造成口径矛盾。
    const tagSync = await syncPopulationTagsOnStatusChange(conn, id, status, req.user!.id);
    return { familySync, tagSync, headVacated };
  });
  const { familySync, tagSync, headVacated } = sync;

  await writeAudit({ userId: req.user!.id, username: req.user!.username, action: 'person:status', request: { id, status, statusDate: effectiveDate, reason }, result: 'SUCCESS', ip: req.ip });
  // 户主离户必须说出来：不说的话，这一户从此「人在户籍、户主已故」，
  // 要等下次对账或导出名单时才发现，解释起来还以为是数据错了。
  // remaining=0 的不用提示改选——那是灭户，户里已经没人可当户主。
  const needHead = headVacated.filter((h) => h.remaining > 0);
  const headMsg = needHead.length
    ? `；该户（${needHead[0].familyNo || '家庭'}）户主已离户，${
        needHead[0].candidate ? `建议由${needHead[0].candidate.name}接任，` : ''
      }请到家庭页改选户主`
    : '';
  return ok(
    res,
    {
      id,
      status,
      statusDate: effectiveDate,
      tagCleared: tagSync.cleared,
      tagRestored: tagSync.restored,
      familyNo: familySync.familyNo,
      familyEmptied: familySync.familyEmptied,
      headVacated,
    },
    // 灭户必须说出来：操作者看到「家庭总数少了 1」时，要能对上是谁造成的
    (familySync.familyEmptied
      ? `已变更为「${STATUS_LABELS[status]}」；该户（${familySync.familyNo || '家庭'}）已无在册成员，不再计入家庭总数`
      : `已变更为「${STATUS_LABELS[status]}」`) + headMsg
  );
});

const batchStatusSchema = z.object({
  personIds: z.array(z.number().int().positive()).min(1).max(500),
  status: z.enum(PERSON_STATUSES),
  statusDate: z.preprocess(
    (v) => (v === '' ? null : v),
    z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '生效日期格式应为 YYYY-MM-DD').nullable().optional()
  ),
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
  // 人口标签联动条数：返回给前端，便于提示「同时停用了 N 条户籍/流动人口标签」
  let tagCleared = 0;
  let tagRestored = 0;
  const inactive = isInactiveStatus(status);

  // 变更前记下这批人所属的家庭：变更后一次性统计其中有多少户已无在册成员
  // （逐人算什么会多出 N 次 COUNT，500 人的批次上很明显）
  let familiesEmptied = 0;
  // 这批人里有哪些是户主：同样是一次 IN 查询，不逐人问
  let headVacated: VacatedHeadFamily[] = [];

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
      // 与单条状态变更共用同一个联动函数：批量接口曾因「只改单条」漏过口径，
      // 这里不允许再各写一份。
      await markFamilyMemberOnStatusChange(conn, pid, status, effectiveDate);
      const tagSync = await syncPopulationTagsOnStatusChange(conn, pid, status, req.user!.id);
      tagCleared += tagSync.cleared;
      tagRestored += tagSync.restored;
      changed++;
    }
    // 灭户统计放在事务内、且在循环之后：关联只是标记离开（行还在），
    // 所以此时仍能按 person_id 找回原家庭；同快照下算，避免并发看到中间态。
    if (inactive) {
      const familyIds = await findFamiliesOfPersons(conn, personIds);
      familiesEmptied = await countEmptiedFamilies(conn, familyIds);
      headVacated = await findVacatedHeads(conn, personIds);
    }
  });

  await writeAudit({ userId: req.user!.id, username: req.user!.username, action: 'person:batch-status', request: { count: personIds.length, status, statusDate: effectiveDate, reason }, result: 'SUCCESS', ip: req.ip });
  // 灭户数单独报出来：批量登记死亡后「家庭总数为什么少了 N 户」要能对上账
  const baseMsg = skipped
    ? `已变更 ${changed} 人，${skipped} 人已是「${STATUS_LABELS[status]}」或不存在`
    : `已变更 ${changed} 人为「${STATUS_LABELS[status]}」`;
  // 灭户的不提示改选（户里已经没人了）；剩下的才是「还有人、没户主」
  const needHead = headVacated.filter((h) => h.remaining > 0);
  return ok(
    res,
    {
      changed,
      skipped,
      status,
      tagCleared,
      tagRestored,
      familiesEmptied,
      // 明细截 20 条够前端提示用；计数单独给，避免「提示里只有 20 户」被当成全部
      headVacated: needHead.slice(0, 20),
      headVacatedCount: needHead.length,
    },
    [
      baseMsg,
      familiesEmptied ? `${familiesEmptied} 户已无在册成员，不再计入家庭总数` : '',
      needHead.length ? `${needHead.length} 户户主已离户，请到家庭页改选户主` : '',
    ]
      .filter(Boolean)
      .join('；')
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

  // 人口归属标签只对在册人员有效：迁出/死亡的人再打「户籍人口」，
  // 会立刻造出「详情页写着迁出、标签写着户籍人口」的矛盾（v2.3）。
  await assertPopulationTagsAllowed(pool, id, [body.tagId]);

  // 默认不允许重复有效关联
  if (!tag.allow_duplicate) {
    const dup = await queryOne<any>(
      `SELECT id FROM person_tag WHERE person_id = ? AND tag_id = ? AND status = 'ACTIVE'`,
      [id, body.tagId]
    );
    if (dup) throw new AppError('该人员已关联此标签', 409, 'DUPLICATE_TAG');
  }

  // 标签互斥（数据驱动）：同组已有优先级更高的标签时不允许再挂一枚。
  // 读数侧本来就不认被压制的那枚，写进去只会让用户以为打上了、统计里却不生效。
  const exclusivity = await resolveTagExclusivity(pool, id, [body.tagId]);
  if (exclusivity.blocked.length) {
    const b = exclusivity.blocked[0];
    throw new AppError(`该人员已是「${b.name}」，两者互斥，请先移除后再添加`, 409, 'EXCLUSIVE_TAG_CONFLICT');
  }

  const nextStatus = tag.need_audit ? 'PENDING' : 'ACTIVE';
  await execute(
    `INSERT INTO person_tag (person_id, tag_id, effect_date, expire_date, status, basis, created_by)
     VALUES (?,?,?,?,?,?,?)`,
    [id, body.tagId, body.effectDate || null, body.expireDate || null, nextStatus, body.basis || null, req.user!.id]
  );
  // 写入后再停用同组旧标签：中途失败时用户手里至少还留着原来那枚。
  // 待审核的标签还没生效，不能因此把旧标签停掉。
  if (nextStatus === 'ACTIVE' && exclusivity.groups.length) {
    await deactivateGroupPeers(
      pool,
      id,
      exclusivity.groups,
      exclusivity.writable,
      req.user!.id,
      '标签互斥组：添加了优先级更高的标签，自动移除同组旧标签'
    );
  }
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

  // 被跳过（互斥压制 / 非在册人员的人口标签）的「人员×标签」条数，返回给前端提示
  let skipped = 0;

  // 人口标签与非在册人员：批量操作不能因为其中几个人已迁出就整批失败，
  // 也不能静默给人打上永远不生效的标签。先一次性载入标签定义与人员状态，
  // 在内存里摘掉，最后把条数汇总进 skipped。
  const populationTagIds = new Set((await loadPopulationTagDefs(pool)).map((d) => d.id));
  const statusById = new Map<number, string>();
  if (action === 'ADD' && populationTagIds.size) {
    const rows = await query<any>(
      `SELECT id, status FROM person WHERE id IN (${personIds.map(() => '?').join(',')})`,
      personIds
    );
    for (const r of rows) statusById.set(Number(r.id), String(r.status));
  }

  await withTransaction(async (conn) => {
    // 标签互斥（数据驱动）：同一批里同组只留优先级最高的一枚，再按每个人的
    // 现有标签裁决「谁该被压制」——同一批标签对不同人的结果可能不同
    //（有人已是户籍人口，给他加流动人口就该跳过）。
    // 整批在事务里，任何一条失败全部回滚，不会出现「一半人互斥一半人没处理」。
    for (const pid of personIds) {
      let personTagIds = tagIds;
      if (action === 'ADD') {
        const status = statusById.get(Number(pid));
        if (status && !isActiveStatus(status)) {
          const before = personTagIds.length;
          personTagIds = personTagIds.filter((tid) => !populationTagIds.has(Number(tid)));
          skipped += before - personTagIds.length;
        }
        if (!personTagIds.length) continue;
        const exclusivity = await resolveTagExclusivity(conn, pid, personTagIds);
        personTagIds = exclusivity.writable;
        skipped += exclusivity.blocked.length;
        // 写入前先停用同组旧标签：keep 里是本批将写入的标签，不会被自己停掉
        if (exclusivity.groups.length) {
          await deactivateGroupPeers(
            conn,
            pid,
            exclusivity.groups,
            personTagIds,
            req.user!.id,
            '标签互斥组：批量添加了优先级更高的标签，自动移除同组旧标签'
          );
        }
      }
      for (const tagId of personTagIds) {
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
  return ok(
    res,
    { total: personIds.length, processed: personIds.length, skipped },
    // 跳过条数必须报出来：可能来自互斥压制，也可能来自「人员已迁出/死亡，
    // 人口归属标签按口径不打」——不说清楚，操作者会以为全都成功了
    skipped ? `批量操作完成，${skipped} 条按口径跳过（互斥，或人员已迁出/死亡）` : '批量操作完成'
  );
});

/** 人员下拉选项（网格、家庭） */
router.get('/meta/options', requirePermission('person:view'), async (req: Request, res: Response) => {
  const grids = await query<any>('SELECT id, name, grid_no FROM grid WHERE status = 1 ORDER BY id');
  const families = await query<any>('SELECT id, family_no, head_person_id FROM family WHERE status = 1 ORDER BY id');
  return ok(res, { grids, families });
});

export default router;
