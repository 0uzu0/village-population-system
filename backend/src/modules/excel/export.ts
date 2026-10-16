import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { query, execute } from '../../config/db';
import { requirePermission, buildGridFilter } from '../../middleware/rbac';
import { ok } from '../../utils/response';
import { buildAgeFilter } from '../../utils/tagQuery';
import { buildDisabilityLevelFilter, disabilityLevelLabel } from '../../utils/disability';
import { formatDateOrEmpty } from '../../utils/date';
import { activeSql } from '../../utils/personStatus';
import { FOCUS_GROUPS } from '../../utils/focusGroups';
import { queryEnum } from '../../utils/schema';
import { UPLOAD_DIR } from './shared';

import path from 'path';
import fs from 'fs';
import ExcelJS from 'exceljs';
import { writeAudit } from '../../middleware/audit';
import { buildPersonTagFilter } from '../../utils/tagQuery';

// ===== 以下内容自 modules/excel.ts 机械搬迁，未改动逻辑 =====

const router = Router();

const exportSchema = z.object({
  fields: z.array(z.string()).optional(),
  keyword: z.string().optional(),
  gridId: z.coerce.number().optional(),
  familyId: z.coerce.number().optional(),
  gender: z.string().optional(),
  status: z.string().optional(),
  tagIds: z.string().optional(),
  tagMode: queryEnum(['ANY', 'ALL'], 'ANY'),
  minAge: z.coerce.number().optional(),
  maxAge: z.coerce.number().optional(),
  /** 只看在册（默认开启），与人员列表口径一致；传 false 可导出含已迁出/死亡的历史档案 */
  activeOnly: z.boolean().optional().default(true),
  /** 重点人群个性化筛选（V008），与 /api/keygroup/query 保持同口径 */
  extremePovertyMode: z.enum(['CENTRALIZED', 'DISPERSED']).optional(),
  minDisabilityLevel: z.enum(['LEVEL_1', 'LEVEL_2', 'LEVEL_3', 'LEVEL_4']).optional(),
  maxDisabilityLevel: z.enum(['LEVEL_1', 'LEVEL_2', 'LEVEL_3', 'LEVEL_4']).optional(),
  disabilityType: z.string().max(64).optional(),
  minSubsidy: z.coerce.number().min(0).optional(),
  maxSubsidy: z.coerce.number().min(0).optional(),
  guardian: z.enum(['YES', 'NO']).optional(),
});

/**
 * 重点人群标志列：每个标志由若干 tag_definition.code 命中（任一即视为「是」）。
 *
 * 编码与名称统一取自 utils/focusGroups.ts（唯一来源，与网格/村庄统计、工作台卡片
 * 完全同口径），此处只保留「列顺序」——导出 Excel 的列序是既有约定，不随
 * focusGroups 的定义顺序变动。
 */
const EXPORT_FLAG_ORDER = [
  'is_party',
  'is_disabled',
  'is_extreme_poverty',
  'is_low_income',
  'is_veteran',
  'is_preferential',
];
const EXPORT_TAG_FLAGS: { key: string; label: string; codes: string[]; alsoDisabilityTable?: boolean }[] =
  EXPORT_FLAG_ORDER.map((key) => {
    const g = FOCUS_GROUPS.find((x) => x.exportFlagKey === key);
    if (!g) throw new Error(`focusGroups 缺少导出标志列 ${key} 的定义`);
    return {
      key,
      label: g.exportFlagLabel || g.label,
      codes: g.tagCodes,
      // 残疾人额外兼顾 person_disability 表（有人建了档案但未打标签也算残疾人）
      alsoDisabilityTable: g.code === 'DISABLED_PERSON',
    };
  });

/** 导出字段定义（标志列与 EXPORT_TAG_FLAGS 同源，避免键名与表头两处维护） */
const EXPORT_FIELDS: { key: string; label: string }[] = [
  { key: 'person_no', label: '人员编号' },
  { key: 'name', label: '姓名' },
  { key: 'gender', label: '性别' },
  { key: 'birth_date', label: '出生日期' },
  { key: 'id_card', label: '身份证号' },
  { key: 'phone', label: '手机号' },
  { key: 'phone_backup', label: '备用手机号' },
  { key: 'hukou_address', label: '户籍地址' },
  { key: 'live_address', label: '实际居住地址' },
  { key: 'village', label: '所属村庄' },
  { key: 'grid_name', label: '所属网格' },
  { key: 'family_name', label: '所属家庭' },
  { key: 'status', label: '人员状态' },
  // 重点人群台账字段（V008）
  { key: 'bank_account', label: '银行账号' },
  { key: 'subsidy_amount', label: '发放金额' },
  { key: 'disability_type', label: '残疾类别' },
  { key: 'disability_level_label', label: '残疾等级' },
  { key: 'disability_card', label: '残疾证号' },
  { key: 'guardian_name', label: '监护人' },
  { key: 'guardian_phone', label: '监护人手机' },
  { key: 'family_condition', label: '家庭情况描述' },
  { key: 'health_assessment', label: '身体评估结果' },
  // 重点人群标志列（由 person_tag 关联得出，见 EXPORT_TAG_FLAGS）
  ...EXPORT_TAG_FLAGS.map((f) => ({ key: f.key, label: f.label })),
  { key: 'tags', label: '全部标签' },
];

/** 创建导出任务（同步生成文件，记录任务状态与审计） */
router.post('/export', requirePermission('excel:export'), async (req: Request, res: Response) => {
  const body = exportSchema.parse(req.body);

  const where: string[] = ['1=1'];
  const params: any[] = [];
  // 与人员列表保持同一搜索口径：姓名 / 身份证号 / 手机号（含备用）
  if (body.keyword) {
    where.push('(p.name LIKE ? OR p.id_card LIKE ? OR p.phone LIKE ? OR p.phone_backup LIKE ?)');
    params.push(`%${body.keyword}%`, `%${body.keyword}%`, `%${body.keyword}%`, `%${body.keyword}%`);
  }
  if (body.gridId) {
    where.push('p.grid_id = ?');
    params.push(body.gridId);
  }
  if (body.familyId) {
    where.push('p.family_id = ?');
    params.push(body.familyId);
  }
  if (body.gender) {
    where.push('p.gender = ?');
    params.push(body.gender);
  }
  if (body.status) {
    where.push('p.status = ?');
    params.push(body.status);
  } else if (body.activeOnly !== false) {
    where.push(activeSql('p'));
  }

  const gridFilter = buildGridFilter(req, 'p.grid_id');
  if (gridFilter.where) {
    where.push(gridFilter.where.replace(/^ AND /, ''));
    params.push(...gridFilter.params);
  }

  // 年龄与标签筛选复用 tagQuery 的构建器，与人口档案列表保持同一口径
  // （此前这里内联了一份，maxAge 用了 >=，会把刚满 maxAge+1 周岁的人多算进来）
  const ageFilter = buildAgeFilter(body.minAge, body.maxAge, 'p');
  if (ageFilter.where) {
    where.push(ageFilter.where.replace(/^ AND /, ''));
    params.push(...ageFilter.params);
  }

  if (body.tagIds) {
    const tagIds = body.tagIds
      .split(',')
      .map((s) => parseInt(s, 10))
      .filter((n) => !isNaN(n));
    const tagFilter = buildPersonTagFilter({ tags: tagIds, mode: body.tagMode === 'ALL' ? 'ALL' : 'ANY' }, 'p');
    if (tagFilter.where) {
      where.push(tagFilter.where.replace(/^ AND /, ''));
      params.push(...tagFilter.params);
    }
  }

  // 个性化筛选（V008）：必须与 keygroup /query 同口径，否则筛完导出会是另一批人
  if (body.extremePovertyMode) {
    const code =
      body.extremePovertyMode === 'CENTRALIZED' ? 'EXTREME_POVERTY_CENTRALIZED' : 'EXTREME_POVERTY_DISPERSED';
    where.push(`EXISTS (SELECT 1 FROM person_tag pt2 JOIN tag_definition td2 ON td2.id = pt2.tag_id
      WHERE pt2.person_id = p.id AND pt2.status = 'ACTIVE' AND td2.code = ?)`);
    params.push(code);
  }
  if (body.minDisabilityLevel || body.maxDisabilityLevel || body.disabilityType || body.guardian) {
    where.push('pd.person_id IS NOT NULL');
    const lvl = buildDisabilityLevelFilter(body.minDisabilityLevel, body.maxDisabilityLevel);
    if (lvl.where) {
      where.push(lvl.where);
      params.push(...lvl.params);
    }
    if (body.disabilityType) {
      where.push('pd.disability_type = ?');
      params.push(body.disabilityType);
    }
    if (body.guardian) {
      where.push(
        body.guardian === 'YES'
          ? "pd.guardian_name IS NOT NULL AND pd.guardian_name <> ''"
          : "(pd.guardian_name IS NULL OR pd.guardian_name = '')"
      );
    }
  }
  if (body.minSubsidy != null) {
    where.push('p.subsidy_amount >= ?');
    params.push(body.minSubsidy);
  }
  if (body.maxSubsidy != null) {
    where.push('p.subsidy_amount <= ?');
    params.push(body.maxSubsidy);
  }

  const whereSql = where.join(' AND ');
  // 导出的可选字段包含残疾信息（残疾类别/等级/证号/监护人），
  // 无论用户是否勾选都必须能取到，因此这里始终 JOIN，而非按筛选条件决定——
  // 否则勾选残疾字段导出时会报 Unknown column。
  // 导出本身已是全表顺序扫描，多一次 LEFT JOIN 的成本可忽略。
  const fromSql = 'FROM person p LEFT JOIN person_disability pd ON pd.person_id = p.id';

  // 分批读取（避免一次加载上万条到内存）
  const BATCH = 2000;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('人口档案');
  const fields = (body.fields && body.fields.length ? body.fields : EXPORT_FIELDS.map((f) => f.key)).filter((k) => {
    return EXPORT_FIELDS.some((f) => f.key === k);
  });
  const headers = fields.map((k) => EXPORT_FIELDS.find((f) => f.key === k)!.label);
  ws.addRow(headers);
  ws.getRow(1).font = { bold: true };

  const taskResult = await execute('INSERT INTO export_task (name, status, params, created_by) VALUES (?, ?, ?, ?)', [
    '人口档案导出',
    'RUNNING',
    JSON.stringify(body),
    req.user!.id,
  ]);
  const taskId = taskResult.insertId;

  // 标签编码 → 名称 映射，用于「全部标签」列把编码还原成中文
  const tagRows = await query<any>("SELECT code, name FROM tag_definition WHERE object_type = 'PERSON'");
  const tagNameMap = new Map<string, string>(tagRows.map((r: any) => [r.code, r.name]));

  try {
    // keyset（游标）分页：以 id 为游标逐批前进。
    // 相比 LIMIT/OFFSET，越往后翻页越不会退化——OFFSET 需要扫描并丢弃前面全部行，
    // 万级数据导出时最后几批会明显变慢。
    let lastId = 0;
    let total = 0;
    while (true) {
      const rows = await query<any>(
        `SELECT p.*, g.name AS grid_name, f.family_no AS family_name,
                pd.disability_type, pd.disability_level, pd.disability_card,
                pd.guardian_name, pd.guardian_phone,
                (SELECT GROUP_CONCAT(td.code)
                   FROM person_tag pt JOIN tag_definition td ON td.id = pt.tag_id
                  WHERE pt.person_id = p.id AND pt.status = 'ACTIVE') AS tag_codes
         ${fromSql} LEFT JOIN grid g ON g.id=p.grid_id LEFT JOIN family f ON f.id=p.family_id
         WHERE ${whereSql} AND p.id > ? ORDER BY p.id LIMIT ?`,
        [...params, lastId, BATCH]
      );
      if (!rows.length) break;
      for (const r of rows) {
        const tagCodes = r.tag_codes ? String(r.tag_codes).split(',') : [];
        const rowData: any[] = [];
        for (const k of fields) {
          if (k === 'gender') rowData.push(r.gender === 'MALE' ? '男' : '女');
          else if (k === 'birth_date') rowData.push(formatDateOrEmpty(r.birth_date));
          else if (k === 'grid_name') rowData.push(r.grid_name || '');
          else if (k === 'family_name') rowData.push(r.family_name || '');
          else if (k === 'status') rowData.push(r.status || '');
          // 残疾等级导出中文全称（一级（极重度）），台账直接可读
          else if (k === 'disability_level_label') rowData.push(disabilityLevelLabel(r.disability_level));
          else if (k.startsWith('is_')) {
            // 重点人群标志列：命中任一关联标签编码即为「是」
            const def = EXPORT_TAG_FLAGS.find((d) => d.key === k);
            let yes = def ? def.codes.some((c) => tagCodes.includes(c)) : false;
            if (def?.alsoDisabilityTable && r.disability_type) yes = true;
            rowData.push(yes ? '是' : '否');
          } else if (k === 'tags') {
            rowData.push(tagCodes.map((c: string) => tagNameMap.get(c) || c).join('、'));
          } else rowData.push(r[k] ?? '');
        }
        ws.addRow(rowData);
        total++;
      }
      if (rows.length < BATCH) break;
      lastId = Number(rows[rows.length - 1].id);
    }

    const fileName = `population_export_${taskId}.xlsx`;
    const filePath = path.join(UPLOAD_DIR, fileName);
    await wb.xlsx.writeFile(filePath);

    const fileResult = await execute(
      'INSERT INTO file_info (file_name, storage_name, file_type, file_size, storage_path, content_type, created_by) VALUES (?,?,?,?,?,?,?)',
      [
        fileName,
        fileName,
        'xlsx',
        fs.statSync(filePath).size,
        filePath,
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        req.user!.id,
      ]
    );
    await execute("UPDATE export_task SET status = 'SUCCESS', file_id = ?, finished_at = NOW() WHERE id = ?", [
      fileResult.insertId,
      taskId,
    ]);

    await writeAudit({
      userId: req.user!.id,
      username: req.user!.username,
      action: 'excel:export',
      request: { total, fields },
      result: 'SUCCESS',
      ip: req.ip,
    });
    return ok(res, { taskId, total, fileName }, '导出完成');
  } catch (err) {
    await execute("UPDATE export_task SET status = 'FAILED', finished_at = NOW() WHERE id = ?", [taskId]);
    throw err;
  }
});

export default router;
