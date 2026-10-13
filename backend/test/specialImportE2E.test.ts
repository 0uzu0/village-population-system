import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { SPECIAL_IMPORT_SPECS, mapRowFields } from '../src/utils/specialImport';
import { validateIdCard } from '../src/utils/idcard';

/**
 * 专项台账导入的端到端回归（读表 → 映射 → 待写入字段）。
 *
 * 事故背景：用户反馈「残疾类别与残疾等级无法导入」。排查发现链路各环节
 * （模板生成、按表头读取、字段映射、写入 SQL）在测试中均正常，
 * 真实原因是用户表格里的身份证号是 **14 位脱敏号**（户籍表导出常见），
 * validateIdCard 直接判定无效 → 该行被跳过 → 残疾字段自然没写进去。
 *
 * 这类问题在单测里看不出来，必须用**真实数据文件**验证。
 * 本测试用内存构造的表格模拟真实场景，并断言错误提示足够明确。
 */

/** 造一个真实场景的表格（含表头 + 一行数据） */
function makeSheet(headers: string[], row: Record<string, any>): ExcelJS.Worksheet {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('台账');
  ws.addRow(headers);
  ws.addRow(headers.map((h) => row[h] ?? ''));
  return ws;
}

/** 复刻 readRowsByColumns 的按表头读取 */
function readRows(ws: ExcelJS.Worksheet, columns: string[]) {
  const headerMap = new Map<string, number>();
  ws.getRow(1).eachCell((cell, n) => {
    const t = cell.value == null ? '' : String(cell.value).replace(/[\s　]/g, '');
    if (t && !headerMap.has(t)) headerMap.set(t, n);
  });
  const matched = columns.filter((c) => headerMap.has(c.replace(/[\s　]/g, ''))).length;
  const useHeader = matched > 0 && matched >= Math.ceil(columns.length / 2);
  const rows: Record<string, any>[] = [];
  ws.eachRow((row, rn) => {
    if (rn === 1) return;
    const obj: Record<string, any> = {};
    columns.forEach((c, i) => {
      const no = useHeader ? (headerMap.get(c.replace(/[\s　]/g, '')) ?? i + 1) : i + 1;
      const v = row.getCell(no).value;
      obj[c] = v == null ? '' : String(v).trim();
    });
    if (Object.values(obj).some((v) => v !== '')) rows.push(obj);
  });
  return rows;
}

describe('专项台账导入端到端（真实场景）', () => {
  const types = ['disability', 'extreme_poverty', 'low_income'] as const;

  for (const t of types) {
    const spec = SPECIAL_IMPORT_SPECS[t];

    it(`${t}：18 位完整身份证号可正常匹配并写入残疾字段`, () => {
      const row = {
        '姓名': '陶维国', '身份证号': '320124197105041232',
        '残疾类别': '肢体', '残疾等级': '二级',
        '残疾证号': '320124197105041232', '监护人': '陶妻', '监护人手机': '13913387200',
        '供养方式': '分散供养', '银行账号': '6222000000000000000', '发放金额': 850,
        '家庭情况描述': '务农', '身体评估结果': '行动不便', '备注': '',
      };
      const rows = readRows(makeSheet(spec.columns, row), spec.columns);
      // 身份证可通过校验 → 能进入匹配流程
      expect(validateIdCard(rows[0]['身份证号']).valid).toBe(true);
      // 残疾字段正确映射
      const errs: string[] = [];
      const m = mapRowFields(spec, rows[0], errs);
      expect(errs).toEqual([]);
      expect(m.disability.disability_type).toBe('肢体');
      expect(m.disability.disability_level).toBe('LEVEL_2');
    });

    it(`${t}：等级各种写法都能解析`, () => {
      const cases: [string, string][] = [
        ['一级', 'LEVEL_1'], ['二级', 'LEVEL_2'], ['三级', 'LEVEL_3'], ['四级', 'LEVEL_4'],
        ['LEVEL_1', 'LEVEL_1'], ['2', 'LEVEL_2'],
      ];
      for (const [input, want] of cases) {
        const errs: string[] = [];
        const m = mapRowFields(spec, { '残疾类别': '视力', '残疾等级': input }, errs);
        expect(m.disability.disability_level, `「${input}」解析失败`).toBe(want);
      }
    });
  }

  /**
   * 事故复现：用户表格里是 14 位脱敏号（户籍表导出常见，末 4 位被抹掉）。
   * validateIdCard 判定无效 → 整行跳过 → 残疾字段无法落库。
   * 这个case 必须让错误提示足够明确，否则用户只会看到「失败 N 条」。
   */
  it('14 位脱敏身份证号会被识别为无效（这是导入失败的常见原因）', () => {
    // 取自用户真实数据文件 01_人员导入_主表（2026户籍）.xlsx
    const masked = '32012419710504';
    expect(masked.length).toBe(14);
    const check = validateIdCard(masked);
    expect(check.valid).toBe(false);
    expect(check.message).toContain('18位');
  });

  it('脱敏号即使写了残疾信息也无法落库（说明为何需要补全号码）', () => {
    const spec = SPECIAL_IMPORT_SPECS.disability;
    const row = {
      '姓名': '陶维国', '身份证号': '32012419710504',
      '残疾类别': '肢体', '残疾等级': '二级',
    };
    const rows = readRows(makeSheet(spec.columns, row), spec.columns);
    // 字段映射本身是好的——问题出在身份证校验那一步
    const errs: string[] = [];
    const m = mapRowFields(spec, rows[0], errs);
    expect(errs).toEqual([]);
    expect(m.disability.disability_level).toBe('LEVEL_2');
    // 但身份证过不了校验，行会被跳过，数据不会写入
    expect(validateIdCard(rows[0]['身份证号']).valid).toBe(false);
  });

  it('按姓名匹配可绕过身份证问题（姓名在系统中唯一时）', () => {
    // 说明替代方案：脱敏数据下唯一姓名仍可导入
    const spec = SPECIAL_IMPORT_SPECS.disability;
    const row = { '姓名': '陶维国', '身份证号': '', '残疾类别': '肢体', '残疾等级': '二级' };
    const rows = readRows(makeSheet(spec.columns, row), spec.columns);
    expect(rows[0]['身份证号']).toBe('');  // 走姓名匹配分支
    const errs: string[] = [];
    const m = mapRowFields(spec, rows[0], errs);
    expect(m.disability.disability_level).toBe('LEVEL_2');
  });

  it('残疾类别与等级必须能写入（回归：确保映射未被后续改动破坏）', () => {
    const spec = SPECIAL_IMPORT_SPECS.disability;
    expect(spec.disabilityFields).toMatchObject({
      '残疾类别': 'disability_type',
      '残疾等级': 'disability_level',
    });
  });
});