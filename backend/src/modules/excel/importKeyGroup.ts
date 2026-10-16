import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { query, queryOne, execute, withTransaction } from '../../config/db';
import { requirePermission } from '../../middleware/rbac';
import { ok, fail, AppError } from '../../utils/response';
import { writeAudit } from '../../middleware/audit';
import {
  upload,
  KEYGROUP_COLUMNS,
  readRowsByColumns,
  safeUnlink,
  insertImportErrors,
  loadKeyGroupTagDict,
  resolveTagEntries,
  kgTagLabels,
} from './shared';
import { markImportFailed } from '../../services/importTask';

import { validateIdCard } from '../../utils/idcard';
import { WRITE_CHUNK } from './shared';

// ===== 以下内容自 modules/excel.ts 机械搬迁，未改动逻辑 =====

const router = Router();

const keyGroupSchema = z.object({
  defaultCode: z.string().nullable().optional(),
  applyMode: z.enum(['ACTIVE', 'AUDIT']).default('ACTIVE'),
});

/**
 * 导入重点人群名单（党员 / 退役军人 / 优抚 / 低保 / 五保 / 残疾 …）。
 * 不新建人员档案：按身份证号（或系统内唯一的姓名）匹配已有人员，再打上对应标签。
 * 已存在的标签自动跳过，不会重复关联。
 */
router.post(
  '/import-key-group',
  requirePermission('excel:import'),
  upload.single('file'),
  async (req: Request, res: Response) => {
    if (!req.file) return fail(res, '请上传 Excel 文件');
    const batchNo = (req.body.batchNo as string) || `KG${Date.now()}`;
    const body = keyGroupSchema.parse({ defaultCode: req.body.defaultCode, applyMode: req.body.applyMode || 'ACTIVE' });

    const existed = await queryOne<any>('SELECT id FROM excel_import_task WHERE batch_no = ?', [batchNo]);
    if (existed) throw new AppError('该批次已提交过，请勿重复导入', 409, 'DUPLICATE_BATCH');

    let rows: Record<string, any>[];
    let taskId: number;
    try {
      rows = await readRowsByColumns(req.file.path, KEYGROUP_COLUMNS, ['姓名', '人员类别']);
      const taskResult = await execute(
        `INSERT INTO excel_import_task (file_id, batch_no, task_type, status, total_rows, success_count, fail_count, created_by)
       VALUES (NULL, ?, 'KEY_GROUP', 'RUNNING', ?, 0, 0, ?)`,
        [batchNo, rows.length, req.user!.id]
      );
      taskId = taskResult.insertId;
    } catch (err) {
      safeUnlink(req.file.path);
      throw err;
    }

    try {
      // 类别词典来自标签定义表：编码 / 名称 / 别名 / 内置别名 均可命中，新增标签即时生效
      const tagDict = await loadKeyGroupTagDict();
      const tagHint = kgTagLabels(tagDict).join('/');

      // 已生效的标签关联一次性载入内存，避免逐行查重
      const linkRows = await query<any>("SELECT person_id, tag_id FROM person_tag WHERE status = 'ACTIVE'");
      const linked = new Set<string>(linkRows.map((l: any) => `${l.person_id}:${l.tag_id}`));

      // 人员索引：身份证 -> 人员；姓名唯一 -> 人员（用于无身份证的老名单）
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

      const errors: { rowNo: number; message: string; raw: string }[] = [];
      const toInsert: { personId: number; tagId: number; status: string; basis: string; effectDate: string | null }[] =
        [];
      const fileSeen = new Set<string>();
      let matched = 0;
      let skipped = 0;

      for (let i = 0; i < rows.length; i++) {
        const rowNo = i + 2;
        const row = rows[i];
        const name = String(row['姓名'] || '').trim();
        const raw = name || String(row['身份证号'] || '');
        if (!name) {
          errors.push({ rowNo, message: '姓名为空', raw });
          continue;
        }

        const idText = String(row['身份证号'] || '').trim();
        let person: any = null;
        if (idText) {
          const check = validateIdCard(idText);
          if (!check.valid) {
            errors.push({ rowNo, message: `身份证号：${check.message}`, raw });
            continue;
          }
          person = byIdCard.get(check.normalized!) || null;
          if (!person) {
            errors.push({ rowNo, message: `系统内未找到身份证号 ${check.normalized} 的人员，请先导入人口档案`, raw });
            continue;
          }
        } else {
          // 老名单常只有姓名：仅当姓名在系统中唯一时才匹配，避免张冠李戴
          const cnt = nameCount.get(name) || 0;
          if (!byUniqueName.has(name)) {
            errors.push({
              rowNo,
              message: cnt
                ? `姓名「${name}」在系统中存在 ${cnt} 条同名记录，请补填身份证号`
                : `系统内未找到姓名「${name}」的人员`,
              raw,
            });
            continue;
          }
          person = byUniqueName.get(name);
        }
        matched++;

        // 类别：行内为空时取上传页面选择的「默认类别」
        const { defs, unknown } = resolveTagEntries(row['人员类别'] || '', tagDict);
        if (unknown.length) {
          errors.push({
            rowNo,
            message: `无法识别的人员类别：${unknown.join('、')}（可填标签名称或编码，如：${tagHint}）`,
            raw,
          });
          continue;
        }
        // 默认类别也走同一套词典，支持填名称或编码
        let finalDefs = defs;
        if (!finalDefs.length && body.defaultCode) {
          const d = tagDict.get(String(body.defaultCode).trim().toLowerCase());
          if (d) finalDefs = [d];
          else {
            errors.push({ rowNo, message: `默认类别「${body.defaultCode}」不是有效的标签名称或编码`, raw });
            continue;
          }
        }
        if (!finalDefs.length) {
          errors.push({ rowNo, message: '未填写人员类别，且未选择默认类别', raw });
          continue;
        }

        const basis = String(row['依据/备注'] || '').trim() || `重点人群名单导入（批次 ${batchNo}）`;
        const effect = String(row['生效日期'] || '').trim();
        const effectDate = /^\d{4}-\d{2}-\d{2}$/.test(effect) ? effect : null;

        for (const def of finalDefs) {
          if (!def.enabled) {
            errors.push({ rowNo, message: `标签「${def.name}」已停用，请先在人口标签中启用`, raw });
            continue;
          }
          const key = `${person.id}:${def.id}`;
          if (fileSeen.has(key) || linked.has(key)) {
            skipped++;
            continue;
          }
          fileSeen.add(key);
          toInsert.push({
            personId: person.id,
            tagId: def.id,
            status: body.applyMode === 'AUDIT' && def.needAudit ? 'PENDING' : 'ACTIVE',
            basis,
            effectDate,
          });
        }
      }

      if (toInsert.length) {
        const remark = `重点人群名单导入（批次 ${batchNo}）`;
        await withTransaction(async (conn) => {
          for (let i = 0; i < toInsert.length; i += WRITE_CHUNK) {
            const chunk = toInsert.slice(i, i + WRITE_CHUNK);
            await conn.query(
              `INSERT INTO person_tag (person_id, tag_id, effect_date, status, basis, created_by)
             VALUES ${chunk.map(() => '(?,?,?,?,?,?)').join(', ')}`,
              chunk.flatMap((it) => [it.personId, it.tagId, it.effectDate, it.status, it.basis, req.user!.id])
            );
            await conn.query(
              `INSERT INTO tag_change_log (object_type, object_id, tag_id, action, operator_id, remark)
             VALUES ${chunk.map(() => `('PERSON', ?, ?, 'ADD', ?, ?)`).join(', ')}`,
              chunk.flatMap((it) => [it.personId, it.tagId, req.user!.id, remark])
            );
          }
        });
      }
      const tagged = toInsert.length;

      await insertImportErrors(taskId, errors);

      const finalStatus = errors.length === 0 ? 'SUCCESS' : tagged > 0 || skipped > 0 ? 'PARTIAL' : 'FAILED';
      await execute(
        'UPDATE excel_import_task SET status = ?, success_count = ?, fail_count = ?, finished_at = NOW() WHERE id = ?',
        [finalStatus, tagged, errors.length, taskId]
      );

      await writeAudit({
        userId: req.user!.id,
        username: req.user!.username,
        action: 'excel:import_key_group',
        request: { batchNo, total: rows.length, matched, tagged, skipped, fail: errors.length },
        result: 'SUCCESS',
        ip: req.ip,
      });

      return ok(
        res,
        { taskId, total: rows.length, matched, tagged, skipped, fail: errors.length, status: finalStatus },
        errors.length
          ? `导入完成：匹配 ${matched} 人，新增标签 ${tagged} 条，已存在跳过 ${skipped} 条，失败 ${errors.length} 条`
          : `导入完成：匹配 ${matched} 人，新增标签 ${tagged} 条${skipped ? `，已存在跳过 ${skipped} 条` : ''}`
      );
    } catch (err) {
      await markImportFailed(taskId, rows.length, err);
      throw err;
    } finally {
      safeUnlink(req.file?.path);
    }
  }
);

// ===============================================================
// 重点人群专项台账导入（残疾人 / 特困供养 / 低保）
// 与 /import-key-group 同定位：只匹配已有人员并更新其台账字段，不新建人员。
// ===============================================================

export default router;
