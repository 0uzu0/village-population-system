import { Router, Request, Response } from 'express';
import type { PoolConnection } from 'mysql2/promise';
import { query, queryOne, execute, withTransaction } from '../../config/db';
import { genPersonNo } from '../../utils/id';
import { validateIdCard, birthFromIdCard, genderFromIdCard } from '../../utils/idcard';
import { requirePermission } from '../../middleware/rbac';
import { ok, fail, AppError } from '../../utils/response';
import { writeAudit } from '../../middleware/audit';
import { upload, readRows, safeUnlink, WRITE_CHUNK, insertImportErrors } from './shared';
import { markImportFailed } from '../../services/importTask';
import { isActiveStatus, parsePersonStatus, PERSON_STATUS_HINT } from '../../utils/personStatus';
import { loadPopulationTagDefs, parsePopulationTagCode, type PopulationTagDef } from '../../utils/populationTags';

// ===== 以下内容自 modules/excel.ts 机械搬迁，未改动逻辑 =====

const router = Router();

/** 校验并准备导入行，返回 { valid, error }；身份证缺失/非法时返回 { pending } 转待核查表 */
async function validateImportRow(
  row: Record<string, any>,
  rowNo: number,
  gridMap: Map<string, number>,
  familyMap: Map<string, number>,
  seenIdCards: Set<string>,
  existingIdCards: Set<string>
): Promise<{ ok: boolean; message?: string; person?: any; pending?: any }> {
  if (!row['姓名']) return { ok: false, message: '姓名为空' };

  const genderText = row['性别'];
  let gender: string | null = null;
  if (genderText === '男') gender = 'MALE';
  else if (genderText === '女') gender = 'FEMALE';
  else if (genderText) return { ok: false, message: `性别必须为「男」或「女」，实际为「${genderText}」` };

  /**
   * 人员状态：空按「正常」（与升级前行为一致），写了但识别不了就整行报错。
   * 不能默认成「正常」——把迁出人员当在册导入，会让他在所有人口统计里复活。
   */
  const statusText = String(row['人员状态'] || '').trim();
  const status = statusText ? parsePersonStatus(statusText) : 'NORMAL';
  if (!status) {
    return { ok: false, message: `人员状态「${statusText}」无法识别，应填：${PERSON_STATUS_HINT}` };
  }

  /**
   * 户籍归属：空表示暂不归类（导入结果会单独报「未填」人数）；写了但识别不了就报错。
   * 同样不猜——把流动人口当成户籍人口，户籍人口数会虚高且没人看得出来。
   */
  const populationText = String(row['户籍归属'] || '').trim();
  const populationCode = populationText ? parsePopulationTagCode(populationText) : null;
  if (populationText && !populationCode) {
    return { ok: false, message: `户籍归属「${populationText}」无法识别，只能填「户籍人口」或「流动人口」` };
  }

  /** 待核查记录的基础字段：身份证不可用时原样留存，供人工补录后确认入库 */
  const basePending = {
    name: row['姓名'],
    gender,
    birth_date: row['出生日期'] || null,
    id_card: row['身份证号'] || null,
    phone: row['手机号'] || null,
    phone_backup: row['备用手机号'] || null,
    hukou_address: row['户籍地址'] || null,
    live_address: row['实际居住地址'] || null,
    village: row['所属村庄'] || null,
    grid_no: row['网格编号'] || null,
    family_no: row['家庭编号'] || null,
    relation: row['与户主关系'] || null,
    status,
    population_code: populationCode,
    raw_data: JSON.stringify(row),
  };

  let idCardNormalized: string | null = null;
  if (!row['身份证号']) {
    // 核心规则：身份证号为空不进入正式档案，转入待核查表
    return {
      ok: true,
      pending: { ...basePending, reason: 'ID_CARD_MISSING', reason_text: '身份证号为空，需人工核实补录' },
    };
  }
  const check = validateIdCard(row['身份证号']);
  if (!check.valid) {
    // 身份证号非法同样无法建立可信档案，一并转待核查
    return {
      ok: true,
      pending: { ...basePending, reason: 'ID_CARD_INVALID', reason_text: `身份证号：${check.message}` },
    };
  }
  idCardNormalized = check.normalized!;
  if (seenIdCards.has(idCardNormalized)) return { ok: false, message: '文件中存在重复身份证号' };
  seenIdCards.add(idCardNormalized);
  // 已有档案身份证在导入前一次性载入内存，避免每行一次数据库往返（万行级导入会拖垮耗时）
  if (existingIdCards.has(idCardNormalized)) return { ok: false, message: '该身份证号已存在于系统档案中（禁止覆盖）' };

  const gridNo = row['网格编号'];
  let gridId: number | null = null;
  if (gridNo) {
    if (!gridMap.has(gridNo)) return { ok: false, message: `网格编号「${gridNo}」不存在` };
    gridId = gridMap.get(gridNo)!;
  }

  const familyNo = row['家庭编号'];
  let familyId: number | null = null;
  if (familyNo) {
    if (!familyMap.has(familyNo)) return { ok: false, message: `家庭编号「${familyNo}」不存在` };
    familyId = familyMap.get(familyNo)!;
  }

  // 出生日期以身份证为准（决定年龄口径）；证上日期不存在时回退到表格里的出生日期列
  const birthDate = (idCardNormalized ? birthFromIdCard(idCardNormalized) : null) || row['出生日期'] || null;
  const genderFinal = gender || (idCardNormalized ? genderFromIdCard(idCardNormalized) : 'MALE');

  return {
    ok: true,
    person: {
      name: row['姓名'],
      gender: genderFinal,
      birth_date: birthDate,
      id_card: idCardNormalized,
      phone: row['手机号'] || null,
      phone_backup: row['备用手机号'] || null,
      hukou_address: row['户籍地址'] || null,
      live_address: row['实际居住地址'] || null,
      village: row['所属村庄'] || null,
      grid_id: gridId,
      family_id: familyId,
      relation: row['与户主关系'] ? (row['与户主关系'] === '户主' ? 'HEAD' : row['与户主关系']) : null,
      status,
      population_code: populationCode,
    },
  };
}

/**
 * person 单行值模板（17 列）：16 个占位符 + data_source 这个字面量。
 * status 从 v2.3 起改为占位符——导入模板新增「人员状态」列后，
 * 迁出/死亡人员不能再一律写成 NORMAL（否则他们会回到所有人口统计里）。
 * 列顺序必须与 insertPersons 里的列名清单严格一致。
 */
const PERSON_ROW_VALUES = `(?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'EXCEL_IMPORT', ?, ?)`;

/**
 * 批量写入人员并回查主键。
 * 用多行 VALUES 一次写入整批，再凭唯一的 person_no 精确回查自增 ID——
 * 相比逐行 INSERT，万行级导入的数据库往返从上万次降到几十次。
 */
async function insertPersons(conn: PoolConnection, persons: any[], userId: number): Promise<Map<string, number>> {
  const idByNo = new Map<string, number>();
  for (let i = 0; i < persons.length; i += WRITE_CHUNK) {
    const chunk = persons.slice(i, i + WRITE_CHUNK);
    const values: any[] = [];
    const rowPlaceholders: string[] = [];
    for (let j = 0; j < chunk.length; j++) {
      const p = chunk[j];
      // 序号保证同批次内 person_no 唯一，避免撞 uk_person_no 使整批回滚
      p.person_no = genPersonNo(i + j);
      values.push(
        p.person_no,
        p.name,
        p.gender,
        p.birth_date,
        p.id_card,
        p.phone,
        p.phone_backup,
        p.hukou_address,
        p.live_address,
        p.village,
        p.grid_id,
        p.family_id,
        p.relation,
        // 「人员状态」列：空值在校验阶段已归一为 NORMAL，这里一定有值
        p.status || 'NORMAL',
        userId,
        userId
      );
      rowPlaceholders.push(PERSON_ROW_VALUES);
    }
    await conn.query(
      `INSERT INTO person (person_no, name, gender, birth_date, id_card, phone, phone_backup,
         hukou_address, live_address, village, grid_id, family_id, relation, status, data_source, created_by, updated_by)
       VALUES ${rowPlaceholders.join(', ')}`,
      values
    );
    const [rows] = (await conn.query(
      `SELECT id, person_no FROM person WHERE person_no IN (${chunk.map(() => '?').join(',')})`,
      chunk.map((p: any) => p.person_no)
    )) as any[];
    for (const r of rows) idByNo.set(String(r.person_no), Number(r.id));
  }
  return idByNo;
}

/** 批量建立家庭成员关联，并在导入到户主时回填家庭户主字段 */
async function linkFamilyMembers(conn: PoolConnection, persons: any[], idByNo: Map<string, number>): Promise<void> {
  const members: any[][] = [];
  const headUpdates: { personId: number; familyId: number }[] = [];

  for (const p of persons) {
    if (!p.family_id) continue;
    const personId = idByNo.get(String(p.person_no));
    if (!personId) continue;
    // 保留 Excel 中填写的与户主关系（户主 / 妻 / 子 / 女 …）
    const relation = p.relation || 'OTHER';
    // 迁出/死亡行不能挂成在户成员：家庭成员数与家庭是否在册都按 on-the-fly 口径算，
    // 这里写错会让「家庭详情里有他、人口统计里没有他」同时成立。
    const memberStatus = isActiveStatus(p.status || 'NORMAL') ? 1 : 0;
    members.push([p.family_id, personId, relation, relation === 'HEAD' ? 1 : 0, memberStatus]);
    // 户主只能是此人自己；已故户主不抢占 head_person_id
    if (relation === 'HEAD' && memberStatus === 1) headUpdates.push({ personId, familyId: p.family_id });
  }

  for (let i = 0; i < members.length; i += WRITE_CHUNK) {
    const chunk = members.slice(i, i + WRITE_CHUNK);
    await conn.query(
      // 导入建档的人都是本批次新建的，family_member 不可能已存在（uk_fm 撞不上），
      // 所以不需要 ON DUPLICATE 分支——那还会用到 VALUES() 函数写法，
      // 被 test/sql-shape 的「列数=值数」扫描误判成值清单。
      `INSERT IGNORE INTO family_member (family_id, person_id, relation, is_householder, status)
       VALUES ${chunk.map(() => '(?,?,?,?,?)').join(', ')}`,
      chunk.flat()
    );
  }
  for (const h of headUpdates) {
    await conn.query('UPDATE family SET head_person_id = ? WHERE id = ? AND head_person_id IS NULL', [
      h.personId,
      h.familyId,
    ]);
  }
}

interface ImportOutcome {
  success: number;
  errors: { rowNo: number; message: string; raw: string }[];
  pendingCount: number;
  /** 按「户籍归属」列打上人口标签的人数 */
  populationTagged: number;
  /** 迁出/死亡人员按口径未打人口标签的人数 */
  populationSkipped: number;
  /** 在册但没填户籍归属的人数（工作台户籍/流动人口统计不会计入） */
  populationUntagged: number;
}

/**
 * 按「户籍归属」列给新导入的人员打人口标签。
 *
 * 两条约束来自 utils/populationTags.ts 的不变式：
 * - 迁出/死亡人员**不打**（打了就出现「迁出 + 户籍人口」的矛盾）；
 * - 在册人员最多一枚（户籍/流动互斥由唯一取值保证）。
 *
 * 三种计数全部返回给导入结果：打了多少、按口径没打多少、没填多少。
 * 导入最容易出的问题是「静默少算」——数字不报出来，没人会发现。
 */
async function linkPopulationTags(
  conn: PoolConnection,
  persons: any[],
  idByNo: Map<string, number>,
  defs: PopulationTagDef[],
  userId: number,
  batchNo: string
): Promise<{ tagged: number; skippedInactive: number; untagged: number }> {
  const byCode = new Map(defs.map((d) => [d.code, d]));
  const links: { personId: number; tagId: number }[] = [];
  let skippedInactive = 0;
  let untagged = 0;

  for (const p of persons) {
    const active = isActiveStatus(p.status);
    if (!active) {
      if (p.population_code) skippedInactive++;
      continue;
    }
    if (!p.population_code) {
      untagged++;
      continue;
    }
    const def = byCode.get(p.population_code);
    const personId = idByNo.get(String(p.person_no));
    if (!def || !personId) continue;
    links.push({ personId, tagId: def.id });
  }
  if (!links.length) return { tagged: 0, skippedInactive, untagged };

  const basis = `人口档案导入（批次 ${batchNo}）`;
  for (let i = 0; i < links.length; i += WRITE_CHUNK) {
    const chunk = links.slice(i, i + WRITE_CHUNK);
    await conn.query(
      `INSERT INTO person_tag (person_id, tag_id, status, basis, created_by)
       VALUES ${chunk.map(() => '(?,?,?,?,?)').join(', ')}`,
      chunk.flatMap((it) => [it.personId, it.tagId, 'ACTIVE', basis, userId])
    );
    await conn.query(
      `INSERT INTO tag_change_log (object_type, object_id, tag_id, action, operator_id, remark)
       VALUES ${chunk.map(() => `('PERSON', ?, ?, 'ADD', ?, ?)`).join(', ')}`,
      chunk.flatMap((it) => [it.personId, it.tagId, userId, basis])
    );
  }
  return { tagged: links.length, skippedInactive, untagged };
}

/**
 * 执行导入：逐行校验 → 写人员 → 记错误 → 身份证异常行落待核查。
 * 抽成独立函数，路由层才能用 try/catch 兜住异常并把任务置为失败。
 */
async function processImportRows(p: {
  rows: any[];
  taskId: number;
  batchNo: string;
  gridMap: Map<string, number>;
  familyMap: Map<string, number>;
  existingIdCards: Set<string>;
  userId: number;
}): Promise<ImportOutcome> {
  const { rows, taskId, batchNo, gridMap, familyMap, existingIdCards, userId } = p;

  const seenIdCards = new Set<string>();
  let success = 0;
  let populationTagged = 0;
  let populationSkipped = 0;
  let populationUntagged = 0;
  const errors: { rowNo: number; message: string; raw: string }[] = [];
  const pendings: { rowNo: number; pending: any }[] = [];
  const validPersons: { person: any }[] = [];

  // 人口标签定义只查一次：导入是批量路径，逐行查库会把万行导入拖成分钟级
  const populationDefs = await loadPopulationTagDefs({ query });
  const populationDefByCode = new Map(populationDefs.map((d) => [d.code, d]));

  for (let i = 0; i < rows.length; i++) {
    const rowNo = i + 2; // Excel 实际行号（含表头）
    const v = await validateImportRow(rows[i], rowNo, gridMap, familyMap, seenIdCards, existingIdCards);
    if (!v.ok) {
      errors.push({ rowNo, message: v.message!, raw: rows[i]['姓名'] || '' });
    } else if (v.pending) {
      pendings.push({ rowNo, pending: v.pending });
    } else {
      validPersons.push({ person: v.person! });
    }
  }

  // 写入有效行（事务）：批量 INSERT + 批量建家庭成员关联 + 按户籍归属打人口标签
  if (validPersons.length) {
    const persons = validPersons.map((v) => v.person);
    await withTransaction(async (conn) => {
      const idByNo = await insertPersons(conn, persons, userId);
      await linkFamilyMembers(conn, persons, idByNo);
      const linked = await linkPopulationTags(conn, persons, idByNo, populationDefs, userId, batchNo);
      populationTagged = linked.tagged;
      populationSkipped = linked.skippedInactive;
      populationUntagged = linked.untagged;
      success = idByNo.size;
    });
  }

  // 记录错误
  await insertImportErrors(taskId, errors);

  // 身份证缺失/非法的行落到待核查表，等待人工补录
  if (pendings.length) {
    await withTransaction(async (conn) => {
      for (let i = 0; i < pendings.length; i += WRITE_CHUNK) {
        const chunk = pendings.slice(i, i + WRITE_CHUNK);
        const values: any[] = [];
        for (const { rowNo, pending } of chunk) {
          /**
           * 待核查行也要把状态与户籍归属带过去（v2.3）：
           * 补录身份证后确认入库若一律建成 NORMAL，迁出/死亡的人会重新回到统计里，
           * 户籍人口这类信息也会彻底丢失。户籍归属以 tag_ids 形式带过去，
           * 确认入库时由 syncPersonTags 回挂（非在册人员不带，避免又造出矛盾）。
           */
          const populationDef =
            pending.population_code && isActiveStatus(pending.status)
              ? populationDefByCode.get(pending.population_code)
              : undefined;
          values.push(
            batchNo,
            rowNo,
            pending.reason,
            pending.reason_text,
            pending.name,
            pending.gender,
            pending.birth_date || null,
            pending.id_card || null,
            pending.phone,
            pending.phone_backup,
            pending.hukou_address,
            pending.live_address,
            pending.village,
            pending.grid_no,
            pending.family_no,
            pending.relation,
            pending.status || 'NORMAL',
            populationDef ? String(populationDef.id) : null,
            pending.raw_data,
            userId
          );
        }
        await conn.query(
          `INSERT INTO import_pending (batch_no, row_no, reason, reason_text, name, gender, birth_date, id_card,
             phone, phone_backup, hukou_address, live_address, village, grid_no, family_no, relation,
             person_status, tag_ids, raw_data, created_by)
           VALUES ${chunk.map(() => '(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').join(', ')}`,
          values
        );
      }
    });
  }

  return {
    success,
    errors,
    pendingCount: pendings.length,
    populationTagged,
    populationSkipped,
    populationUntagged,
  };
}

/** 导入人口（同步处理，记录批次与错误） */
router.post(
  '/import',
  requirePermission('excel:import'),
  upload.single('file'),
  async (req: Request, res: Response) => {
    if (!req.file) return fail(res, '请上传 Excel 文件');
    const batchNo = (req.body.batchNo as string) || `IMP${Date.now()}`;

    // 幂等：同一批次号禁止重复提交
    const existed = await queryOne<any>('SELECT id FROM excel_import_task WHERE batch_no = ?', [batchNo]);
    if (existed) throw new AppError('该批次已提交过，请勿重复导入', 409, 'DUPLICATE_BATCH');

    const gridRows = await query<any>('SELECT grid_no, id FROM grid');
    const gridMap = new Map(gridRows.map((g: any) => [g.grid_no, g.id]));
    const familyRows = await query<any>('SELECT family_no, id FROM family');
    const familyMap = new Map(familyRows.map((f: any) => [f.family_no, f.id]));

    // 一次性载入已有身份证号（村里人口量级通常 < 10 万，内存可控）
    const existingCardRows = await query<any>("SELECT id_card FROM person WHERE id_card IS NOT NULL AND id_card <> ''");
    const existingIdCards = new Set<string>(existingCardRows.map((r: any) => String(r.id_card)));

    // 解析与建任务都在 try 内：任何一步抛错都能保证临时文件被清理（此前解析失败会残留文件）
    let rows: Record<string, any>[];
    let taskId: number;
    try {
      rows = await readRows(req.file.path);
      const taskResult = await execute(
        `INSERT INTO excel_import_task (file_id, batch_no, status, total_rows, success_count, fail_count, created_by)
       VALUES (NULL, ?, 'RUNNING', ?, 0, 0, ?)`,
        [batchNo, rows.length, req.user!.id]
      );
      taskId = taskResult.insertId;
    } catch (err) {
      safeUnlink(req.file.path);
      throw err;
    }

    try {
      const {
        success,
        errors,
        pendingCount,
        populationTagged,
        populationSkipped,
        populationUntagged,
      } = await processImportRows({
        rows,
        taskId,
        batchNo,
        gridMap,
        familyMap,
        existingIdCards,
        userId: req.user!.id,
      });

      // 待核查行不计为失败，但会标记任务为「部分成功」，提醒人工跟进
      const finalStatus =
        success === 0 && pendingCount === 0 ? 'FAILED' : errors.length > 0 || pendingCount > 0 ? 'PARTIAL' : 'SUCCESS';
      await execute(
        'UPDATE excel_import_task SET status = ?, success_count = ?, fail_count = ?, pending_count = ?, finished_at = NOW() WHERE id = ?',
        [finalStatus, success, errors.length, pendingCount, taskId]
      );

      await writeAudit({
        userId: req.user!.id,
        username: req.user!.username,
        action: 'excel:import',
        request: {
          batchNo,
          total: rows.length,
          success,
          fail: errors.length,
          pending: pendingCount,
          populationTagged,
          populationSkipped,
          populationUntagged,
        },
        result: 'SUCCESS',
        ip: req.ip,
      });

      // 人口标签的三种结果必须都报出来：
      // 「没填户籍归属」和「按口径没打」都不影响导入成功，但都影响工作台的人口数。
      const tagNote = [
        populationTagged ? `已按户籍归属打标签 ${populationTagged} 人` : '',
        populationSkipped ? `${populationSkipped} 人为迁出/死亡，按口径未打人口标签` : '',
        populationUntagged ? `${populationUntagged} 人未填户籍归属（不计入户籍/流动人口）` : '',
      ]
        .filter(Boolean)
        .join('；');

      const base = pendingCount
        ? `导入完成：成功 ${success} 条，失败 ${errors.length} 条，${pendingCount} 条转入待核查`
        : `导入完成：成功 ${success} 条，失败 ${errors.length} 条`;
      return ok(
        res,
        {
          taskId,
          total: rows.length,
          success,
          fail: errors.length,
          pending: pendingCount,
          status: finalStatus,
          populationTagged,
          populationSkipped,
          populationUntagged,
        },
        tagNote ? `${base}；${tagNote}` : base
      );
    } catch (err) {
      // 导入中途失败（SQL 报错、连接中断等）：整批未生效，任务必须落为失败，不能停在「处理中」
      await markImportFailed(taskId, rows.length, err);
      throw err;
    } finally {
      safeUnlink(req.file?.path);
    }
  }
);

export default router;
