import { Router, Request, Response } from 'express';
import { query, queryOne, execute, withTransaction } from '../../config/db';
import { requirePermission } from '../../middleware/rbac';
import { ok, fail, AppError } from '../../utils/response';
import { writeAudit } from '../../middleware/audit';
import {
  SPECIAL_IMPORT_SPECS,
  mapRowFields,
  type SpecialImportType,
} from '../../utils/specialImport';
import { upload, readRowsByColumns, safeUnlink, insertImportErrors } from './shared';
import { markImportFailed } from '../../services/importTask';

import { validateIdCard } from '../../utils/idcard';
import { WRITE_CHUNK } from './shared';

// ===== 以下内容自 modules/excel.ts 机械搬迁，未改动逻辑 =====

const router = Router();

/** 专项台账导入 */
router.post('/import-special', requirePermission('excel:import'), upload.single('file'), async (req: Request, res: Response) => {
  if (!req.file) return fail(res, '请上传 Excel 文件');
  const spec = SPECIAL_IMPORT_SPECS[(req.body.type as SpecialImportType)];
  if (!spec) { safeUnlink(req.file.path); throw new AppError('未知的导入类型', 400, 'UNKNOWN_IMPORT_TYPE'); }
  const batchNo = (req.body.batchNo as string) || `${spec.type.slice(0, 2).toUpperCase()}${Date.now()}`;

  const existed = await queryOne<any>('SELECT id FROM excel_import_task WHERE batch_no = ?', [batchNo]);
  if (existed) { safeUnlink(req.file.path); throw new AppError('该批次已提交过，请勿重复导入', 409, 'DUPLICATE_BATCH'); }

  let rows: Record<string, any>[];
  let taskId: number;
  try {
    // 必填列：模板列序与预期不符（用了旧模板等）时直接报错，
    // 而不是静默错位把银行账号当成残疾类别写进档案。
    // 只取「身份类」列作必填——残疾证号/监护人/备注等本身允许为空，
    // 若一并设为必填，正常留空这些列的表格也会被误拒。
    const identityCols = spec.disabilityFields
      ? Object.keys(spec.disabilityFields).filter((c) => c === '残疾类别' || c === '残疾等级')
      : [];
    const required = ['姓名', '身份证号', ...identityCols];
    rows = await readRowsByColumns(req.file.path, spec.columns, required);
    const taskResult = await execute(
      `INSERT INTO excel_import_task (file_id, batch_no, task_type, status, total_rows, success_count, fail_count, created_by)
       VALUES (NULL, ?, ?, 'RUNNING', ?, 0, 0, ?)`,
      [batchNo, spec.taskType, rows.length, req.user!.id]
    );
    taskId = taskResult.insertId;
  } catch (err) {
    safeUnlink(req.file.path);
    throw err;
  }

  try {
    // 人员索引：身份证 → 人员；姓名单一 → 人员（老名单常只有姓名）
    const personRows = await query<any>('SELECT id, name, id_card FROM person');
    const byIdCard = new Map<string, any>();
    const nameCount = new Map<string, number>();
    for (const p of personRows) {
      if (p.id_card) byIdCard.set(String(p.id_card), p);
      nameCount.set(String(p.name), (nameCount.get(String(p.name)) || 0) + 1);
    }
    const byUniqueName = new Map<string, any>();
    for (const p of personRows) {
      if ((nameCount.get(String(p.name)) || 0) === 1) byUniqueName.set(String(p.name), p);
    }

    // 标签字典：自动打的标签若已被停用则报错，避免静默写入无效标签
    const tagRows = await query<any>(
      'SELECT id, code, name, enabled FROM tag_definition WHERE code IN (?)',
      [spec.tagCodes]
    );
    const tagMap = new Map(tagRows.map((t: any) => [t.code, t]));
    for (const code of spec.tagCodes) {
      const t = tagMap.get(code);
      if (!t) throw new AppError(`标签「${code}」不存在，请先在人口标签中创建`, 500, 'TAG_MISSING');
      if (!t.enabled) throw new AppError(`标签「${t.name}」已停用，请先在人口标签中启用`, 400, 'TAG_DISABLED');
    }

    // 已有标签关联与残疾档案：用于「已存在则跳过」与覆盖判断
    const linkRows = await query<any>('SELECT person_id, tag_id FROM person_tag WHERE status = \'ACTIVE\'');
    const linked = new Set<string>(linkRows.map((l: any) => `${l.person_id}:${l.tag_id}`));
    const ddRows = await query<any>('SELECT person_id FROM person_disability');
    const hasDisability = new Set<number>(ddRows.map((d: any) => Number(d.person_id)));

    const errors: { rowNo: number; message: string; raw: string }[] = [];
    /** 按 person_id 聚合：同一人在表里出现多行时合并写入，避免互相覆盖 */
    const personUpdates = new Map<number, { person: Record<string, any>; disability: Record<string, any> }>();
    /** 特困供养方式标签：集中/分散，需先拿到标签 id */
    const modeTagRows = spec.type === 'extreme_poverty'
      ? await query<any>("SELECT id, code FROM tag_definition WHERE code IN ('EXTREME_POVERTY_CENTRALIZED','EXTREME_POVERTY_DISPERSED')")
      : [];
    const modeTagMap = new Map<string, number>(modeTagRows.map((t: any) => [t.code, Number(t.id)]));

    const tagInserts: { personId: number; tagId: number }[] = [];
    let matched = 0;
    let updatedPersons = 0;
    let disabilityUpserts = 0;
    let modeTagged = 0;
    let skipped = 0;

    for (let i = 0; i < rows.length; i++) {
      const rowNo = i + 2;
      const row = rows[i];
      const name = String(row['姓名'] || '').trim();
      const raw = name || String(row['身份证号'] || '');
      if (!name) { errors.push({ rowNo, message: '姓名为空', raw }); continue; }

      // 1) 匹配已有人员（不新建）
      const idText = String(row['身份证号'] || '').trim();
      let person: any = null;
      if (idText) {
        const check = validateIdCard(idText);
        if (!check.valid) {
          // 特别提示 14 位：户籍表常见脱敏导出（末 4 位被抹掉），
          // 用户看到「格式错误」往往不知道真实原因是脱敏
          const isMasked = idText.length === 14;
          errors.push({
            rowNo,
            message: isMasked
              ? `身份证号「${idText}」是 14 位脱敏号，缺少末 4 位（校验码与部分数字），无法匹配人员。请补全 18 位完整号码`
              : `身份证号：${check.message}`,
            raw,
          });
          continue;
        }
        person = byIdCard.get(check.normalized!) || null;
        if (!person) {
          errors.push({ rowNo, message: `系统内未找到身份证号 ${check.normalized} 的人员，请先导入人口档案`, raw });
          continue;
        }
      } else {
        const cnt = nameCount.get(name) || 0;
        if (!byUniqueName.has(name)) {
          errors.push({
            rowNo,
            message: cnt ? `姓名「${name}」在系统中存在 ${cnt} 条同名记录，请补填身份证号` : `系统内未找到姓名「${name}」的人员`,
            raw,
          });
          continue;
        }
        person = byUniqueName.get(name);
      }
      matched++;

      // 2) 字段映射与校验
      const rowErrs: string[] = [];
      const mapped = mapRowFields(spec, row, rowErrs);
      if (rowErrs.length) {
        errors.push({ rowNo, message: rowErrs.join('；'), raw });
        continue;
      }

      // 3) 合并到该人员的待写入集合（同人多行时后写的列补空缺的，不清已有）
      const acc = personUpdates.get(person.id) || { person: {}, disability: {} };
      Object.assign(acc.person, mapped.person);
      Object.assign(acc.disability, mapped.disability);
      personUpdates.set(person.id, acc);

      // 4) 自动打标签（已存在则跳过，避免重复导入产生多条记录）
      for (const code of spec.tagCodes) {
        const t = tagMap.get(code)!;
        const key = `${person.id}:${t.id}`;
        if (linked.has(key)) { skipped++; continue; }
        linked.add(key);
        tagInserts.push({ personId: person.id, tagId: Number(t.id) });
      }

      // 特困：按供养方式打集中/分散子标签
      if (mapped.povertyMode) {
        const code = mapped.povertyMode === 'CENTRALIZED' ? 'EXTREME_POVERTY_CENTRALIZED' : 'EXTREME_POVERTY_DISPERSED';
        const tagId = modeTagMap.get(code);
        if (!tagId) {
          errors.push({ rowNo, message: '供养方式对应的标签不存在，请检查 V008 迁移是否已执行', raw });
          continue;
        }
        const key = `${person.id}:${tagId}`;
        if (!linked.has(key)) {
          linked.add(key);
          tagInserts.push({ personId: person.id, tagId });
          modeTagged++;
        }
      }
    }

    // 5) 写入：仅更新非空字段（空值不覆盖已在 mapRowFields 中保证）
    const updateEntries = [...personUpdates.entries()].filter(([, v]) => Object.keys(v.person).length || Object.keys(v.disability).length);
    await withTransaction(async (conn) => {
      for (const [personId, v] of updateEntries) {
        if (Object.keys(v.person).length) {
          const sets = Object.keys(v.person).map((c) => `${c} = ?`);
          await conn.query(
            `UPDATE person SET ${sets.join(', ')}, updated_by = ? WHERE id = ?`,
            [...Object.values(v.person), req.user!.id, personId]
          );
          updatedPersons++;
        }
        if (Object.keys(v.disability).length) {
          // 一对一表：有记录则更新，无记录则插入（同一批次已出现过则计入 upsert 数）
          await conn.query(
            `INSERT INTO person_disability (person_id, disability_type, disability_level, disability_card, guardian_name, guardian_phone, remark)
             VALUES (?,?,?,?,?,?,?)
             ON DUPLICATE KEY UPDATE
               disability_type = COALESCE(VALUES(disability_type), disability_type),
               disability_level = COALESCE(VALUES(disability_level), disability_level),
               disability_card  = COALESCE(VALUES(disability_card), disability_card),
               guardian_name   = COALESCE(VALUES(guardian_name), guardian_name),
               guardian_phone  = COALESCE(VALUES(guardian_phone), guardian_phone),
               remark          = COALESCE(VALUES(remark), remark)`,
            [
              personId,
              v.disability.disability_type ?? null, v.disability.disability_level ?? null,
              v.disability.disability_card ?? null, v.disability.guardian_name ?? null,
              v.disability.guardian_phone ?? null, v.disability.remark ?? null,
            ]
          );
          if (!hasDisability.has(personId)) hasDisability.add(personId);
          disabilityUpserts++;
        }
        // 台账变更留痕，便于后续追溯是谁通过哪批次导入的
        await conn.query(
          `INSERT INTO person_change_log (person_id, change_type, reason, operator_id)
           VALUES (?, 'UPDATE', ?, ?)`,
          [personId, `${spec.label}导入（批次 ${batchNo}）`, req.user!.id]
        );
      }

      // 标签批量写入（含变更日志）
      for (let i = 0; i < tagInserts.length; i += WRITE_CHUNK) {
        const chunk = tagInserts.slice(i, i + WRITE_CHUNK);
        await conn.query(
          `INSERT INTO person_tag (person_id, tag_id, status, basis, created_by)
           VALUES ${chunk.map(() => '(?,?,?,?,?)').join(', ')}`,
          chunk.flatMap((it) => [it.personId, it.tagId, 'ACTIVE', `${spec.label}导入（批次 ${batchNo}）`, req.user!.id])
        );
        await conn.query(
          `INSERT INTO tag_change_log (object_type, object_id, tag_id, action, operator_id, remark)
           VALUES ${chunk.map(() => `('PERSON', ?, ?, 'ADD', ?, ?)`).join(', ')}`,
          chunk.flatMap((it) => [it.personId, it.tagId, req.user!.id, `${spec.label}导入（批次 ${batchNo}）`])
        );
      }
    });

    await insertImportErrors(taskId, errors);

    // 成功数 = 匹配到人员且字段校验通过的去重人数（personUpdates 只收录通过校验的行）
    const uniqueUpdated = personUpdates.size;
    const finalStatus = errors.length === 0 ? 'SUCCESS' : (uniqueUpdated > 0 ? 'PARTIAL' : 'FAILED');
    await execute(
      'UPDATE excel_import_task SET status = ?, success_count = ?, fail_count = ?, finished_at = NOW() WHERE id = ?',
      [finalStatus, uniqueUpdated, errors.length, taskId]
    );

    await writeAudit({
      userId: req.user!.id, username: req.user!.username, action: 'excel:import_special',
      request: { type: spec.type, batchNo, total: rows.length, matched, updated: uniqueUpdated, disability: disabilityUpserts, tags: tagInserts.length, fail: errors.length },
      result: 'SUCCESS', ip: req.ip,
    });

    return ok(
      res,
      {
        taskId, type: spec.type, total: rows.length, matched,
        updated: uniqueUpdated, disabilityUpserts, tagged: tagInserts.length,
        modeTagged, skipped, fail: errors.length, status: finalStatus,
      },
      errors.length
        ? `${spec.label}导入完成：更新 ${uniqueUpdated} 人，新建残疾档案 ${disabilityUpserts} 份，新增标签 ${tagInserts.length} 条，失败 ${errors.length} 条`
        : `${spec.label}导入完成：更新 ${uniqueUpdated} 人，新建残疾档案 ${disabilityUpserts} 份，新增标签 ${tagInserts.length} 条`
    );
  } catch (err) {
    await markImportFailed(taskId, rows.length, err);
    throw err;
  } finally {
    safeUnlink(req.file?.path);
  }
});

export default router;
