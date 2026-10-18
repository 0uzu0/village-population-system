import { Router, Request, Response } from 'express';
import ExcelJS from 'exceljs';
import { query } from '../../config/db';
import { ok, AppError } from '../../utils/response';
import { requirePermission } from '../../middleware/rbac';
import { SPECIAL_IMPORT_SPECS, type SpecialImportSpec, type SpecialImportType } from '../../utils/specialImport';
import { IMPORT_COLUMNS, KEYGROUP_COLUMNS, KEYGROUP_ALIASES } from './shared';

// ===== 以下内容自 modules/excel.ts 机械搬迁，未改动逻辑 =====

const router = Router();

/** 类别字典：返回给前端做「默认类别」下拉与填写说明（新增标签自动出现在列表中） */
async function loadKeyGroupTypes(): Promise<{ label: string; code: string; aliases: string[] }[]> {
  const rows = await query<any>(
    "SELECT code, name, alias FROM tag_definition WHERE object_type = 'PERSON' ORDER BY category_id, id"
  );
  return rows.map((r: any) => ({
    label: String(r.name),
    code: String(r.code),
    aliases: [
      ...String(r.alias || '')
        .split(/[,，、;；/|]/)
        .map((s: string) => s.trim())
        .filter(Boolean),
      ...(KEYGROUP_ALIASES[String(r.code).toUpperCase()] || []),
    ],
  }));
}

/** 下载导入模板 */
router.get('/template', requirePermission('excel:import'), async (_req: Request, res: Response) => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('人口导入模板');
  ws.columns = IMPORT_COLUMNS.map((c) => ({ header: c, key: c, width: 18 }));
  ws.addRow([
    '张三',
    '男',
    '1990-01-01',
    '320102199001011234',
    '13800000000',
    '示例村一巷1号',
    '示例村一巷1号',
    '幸福村',
    'G001',
    'F001',
    '户主',
    '13900000000',
    '户籍人口',
    '正常',
  ]);
  ws.getRow(1).font = { bold: true };
  ws.getRow(2).getCell('身份证号').numFmt = '@';

  // 第二张表：填写说明（导入只解析第一个工作表，不影响解析）
  const help = wb.addWorksheet('填写说明');
  help.columns = [
    { header: '列名', key: 'col', width: 16 },
    { header: '填写要求', key: 'note', width: 76 },
  ];
  [
    ['姓名 / 身份证号 / 性别', '必填。身份证号缺失或不合法的行会转入「待核查」，不影响同一批其它行。'],
    ['户籍归属', '填「户籍人口」或「流动人口」。户籍人口与流动人口互斥，空缺表示暂不归类。'],
    ['人员状态', '填「正常」「迁入」「迁出」「死亡」，空缺按「正常」处理。'],
    ['迁出 / 死亡人员', '档案会保留但不再计入任何人口统计，且不会打「户籍人口 / 流动人口」标签。'],
    ['所属村庄 / 网格编号 / 家庭编号', '必须与系统内已有记录一致，否则该行导入失败。'],
  ].forEach(([col, note]) => help.addRow({ col, note }));
  help.getRow(1).font = { bold: true };

  const buf = await wb.xlsx.writeBuffer();
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="population_import_template.xlsx"');
  res.send(Buffer.from(buf));
});

/** 下载重点人群名单导入模板 */
router.get('/template/key-group', requirePermission('excel:import'), async (_req: Request, res: Response) => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('重点人群名单');
  ws.columns = KEYGROUP_COLUMNS.map((c) => ({ header: c, key: c, width: c === '依据/备注' ? 28 : 18 }));
  ws.addRow(['张三', '320102199001011234', '党员', '2026年党员名册', '2026-01-01']);
  ws.addRow(['李四', '320102197508084321', '退役军人,党员', '退役军人事务站名册', '2026-01-01']);
  ws.addRow(['王五', '320102196203120018', '五保户', '民政特困供养名单', '2026-01-01']);
  ws.getRow(1).font = { bold: true };
  for (let r = 2; r <= 4; r++) {
    ws.getRow(r).getCell('身份证号').numFmt = '@';
    ws.getRow(r).getCell('生效日期').numFmt = '@';
  }

  // 第二张表仅作填写说明（导入只解析第一个工作表，不影响解析）
  // 取自标签定义表：系统里新增的标签会自动出现在说明中
  const help = wb.addWorksheet('类别填写说明');
  help.columns = [
    { header: '可填写的类别', key: 'label', width: 18 },
    { header: '标签编码', key: 'code', width: 24 },
    { header: '同时可写成', key: 'alias', width: 40 },
  ];
  try {
    const types = await loadKeyGroupTypes();
    types.forEach((t) => help.addRow({ label: t.label, code: t.code, alias: t.aliases.join('、') }));
  } catch {
    help.addRow({ label: '（读取标签定义失败，请以系统中的标签名称为准）', code: '', alias: '' });
  }
  help.getRow(1).font = { bold: true };

  const buf = await wb.xlsx.writeBuffer();
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="keygroup_import_template.xlsx"');
  res.send(Buffer.from(buf));
});

/** 重点人群类别字典（前端下拉用；来自标签定义表，新增标签自动纳入） */
router.get('/key-group/types', requirePermission('excel:import'), async (_req: Request, res: Response) => {
  try {
    return ok(res, await loadKeyGroupTypes());
  } catch {
    return ok(res, []);
  }
});

/** 专项导入类型元信息（前端页签与列说明用） */
router.get('/special/types', requirePermission('excel:import'), (_req: Request, res: Response) => {
  const list = Object.values(SPECIAL_IMPORT_SPECS).map((s) => ({
    type: s.type,
    label: s.label,
    taskType: s.taskType,
    columns: s.columns,
    notes: s.notes,
  }));
  return ok(res, list);
});

/** 下载专项台账导入模板（残疾人 / 特困 / 低保 各一份） */
router.get('/template/special/:type', requirePermission('excel:import'), async (req: Request, res: Response) => {
  const spec = SPECIAL_IMPORT_SPECS[req.params.type as SpecialImportType];
  if (!spec) throw new AppError('未知的导入类型', 400, 'UNKNOWN_IMPORT_TYPE');

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(spec.label);
  ws.columns = spec.columns.map((c) => ({
    header: c,
    key: c,
    width: c.includes('描述') || c.includes('评估') ? 30 : 18,
  }));
  // 示例行仅示意格式，导入只读取第一个工作表
  ws.addRow(sampleRowFor(spec));
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEAF1FE' } };
  // 证件号、手机号、银行账号设为文本格式，否则 Excel 会把长数字显示成科学计数法、
  // 丢掉前导零（银行账号长达 19 位，必须如此）。
  // 必须按当前模板实际拥有的列设置——getCell 取不存在的列会抛错（曾导致特困/低保模板 500）。
  // 注意不要把「残疾等级」「供养方式」这类枚举列设成文本格式，否则会破坏导入解析。
  const textColumns = ['身份证号', '残疾证号', '监护人手机', '监护人电话', '银行账号'];
  for (const col of textColumns) {
    if (spec.columns.includes(col)) {
      ws.getRow(2).getCell(col).numFmt = '@';
    }
  }

  // 第二张表：填写说明（不参与解析）
  const help = wb.addWorksheet('填写说明');
  help.columns = [{ header: '说明', key: 'text', width: 78 }];
  spec.notes.forEach((n, i) => help.addRow({ text: `${i + 1}. ${n}` }));
  help.getRow(1).font = { bold: true };

  const buf = await wb.xlsx.writeBuffer();
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="special_${spec.type}_template.xlsx"`);
  res.send(Buffer.from(buf));
});

/** 每类模板的示例行 */
function sampleRowFor(spec: SpecialImportSpec): any[] {
  const base: Record<string, any> = {
    姓名: '张三',
    身份证号: '320102199001011234',
    残疾类别: '肢体',
    残疾等级: '二级',
    残疾证号: '132101199001011234',
    监护人: '张三妻',
    监护人手机: '13900000000',
    供养方式: '分散供养',
    银行账号: '6222000000000000000',
    发放金额: 850,
    家庭情况描述: '妻子务农，儿子在外务工，本人生活自理能力较弱。',
    身体评估结果: '行动不便，需定期上门随访。',
    备注: '',
  };
  return spec.columns.map((c) => base[c] ?? '');
}

export default router;
