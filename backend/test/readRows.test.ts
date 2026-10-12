import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { SPECIAL_IMPORT_SPECS, mapRowFields } from '../src/utils/specialImport';

/**
 * Excel 列读取的回归测试。
 *
 * 事故：导入模板改版（特困/低保新增「残疾类别」「残疾等级」两列）后，
 * 读取函数严格按**列位置**取值，导致用旧模板文件导入时整表错位——
 * 银行账号被当成残疾类别、发放金额被当成残疾等级写进 person_disability，
 * 全程不报错，表现为「导入成功但详情页没有数据」。
 *
 * 修复：改为**按表头文字匹配**定位列，并对缺失的必填列明确报错。
 * 本测试复刻该定位逻辑（纯内存，不落盘）。
 */

const SAMPLE: Record<string, any> = {
  '姓名': '张三',
  '身份证号': '320102199001011234',
  '残疾类别': '肢体',
  '残疾等级': '二级',
  '残疾证号': '1321',
  '监护人': '李四',
  '监护人手机': '13900000000',
  '供养方式': '分散供养',
  '银行账号': '6222000000000000000',
  '发放金额': 850,
  '家庭情况描述': '测试描述',
  '身体评估结果': '测试评估',
  '备注': '',
};

/** 复刻 excel.ts 的 readRowsByColumns 定位逻辑 */
function readRowsFromSheet(ws: ExcelJS.Worksheet, columns: string[], requiredColumns?: string[]) {
  const rows: Record<string, any>[] = [];

  const headerMap = new Map<string, number>();
  ws.getRow(1).eachCell((cell, colNumber) => {
    const text = cell.value == null ? '' : String(cell.value).replace(/[\s　]/g, '');
    if (text && !headerMap.has(text)) headerMap.set(text, colNumber);
  });

  const matched = columns.filter((c) => headerMap.has(c.replace(/[\s　]/g, ''))).length;
  const useHeader = matched > 0 && matched >= Math.ceil(columns.length / 2);

  if (!useHeader && requiredColumns?.length) throw new Error('TEMPLATE_MISMATCH');
  if (useHeader && requiredColumns?.length) {
    const missing = requiredColumns.filter((c) => !headerMap.has(c.replace(/[\s　]/g, '')));
    if (missing.length) throw new Error(`TEMPLATE_MISSING_COLUMNS: ${missing.join('、')}`);
  }

  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const obj: Record<string, any> = {};
    columns.forEach((c, i) => {
      const key = c.replace(/[\s　]/g, '');
      const colNumber = useHeader ? (headerMap.get(key) ?? i + 1) : i + 1;
      const raw = row.getCell(colNumber).value;
      obj[c] = raw == null ? '' : String(raw).trim();
    });
    if (Object.values(obj).some((v) => v !== '')) rows.push(obj);
  });
  return rows;
}

/** 造一个含表头 + 一行数据的内存工作表（表头文字可能与模板列名不完全一致，如带空格） */
function makeSheet(headers: string[]): ExcelJS.Worksheet {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('t');
  ws.addRow(headers);
  // 表头可能带空格等噪声，取样例值时按规范化后的名字查
  ws.addRow(headers.map((h) => SAMPLE[h.replace(/[\s　]/g, '')] ?? ''));
  return ws;
}

describe('按表头定位列（导入错位回归）', () => {
  const types = ['disability', 'extreme_poverty', 'low_income'] as const;

  for (const t of types) {
    const spec = SPECIAL_IMPORT_SPECS[t];

    it(`${t}：列顺序打乱后仍按表头正确取值`, () => {
      const shuffled = [...spec.columns].reverse();
      const rows = readRowsFromSheet(makeSheet(shuffled), spec.columns, ['姓名', '身份证号']);
      expect(rows[0]['姓名']).toBe('张三');
      expect(rows[0]['残疾类别']).toBe('肢体');
      expect(rows[0]['残疾等级']).toBe('二级');
      expect(rows[0]['银行账号']).toBe('6222000000000000000');
      expect(rows[0]['发放金额']).toBe('850');
    });

    it(`${t}：按表头读取后能正确映射到 person_disability`, () => {
      const rows = readRowsFromSheet(makeSheet(spec.columns), spec.columns, ['姓名', '身份证号']);
      const errs: string[] = [];
      const m = mapRowFields(spec, rows[0], errs);
      expect(errs).toEqual([]);
      if (spec.disabilityFields && Object.keys(spec.disabilityFields).length) {
        expect(m.disability.disability_type).toBe('肢体');
        expect(m.disability.disability_level).toBe('LEVEL_2');
      }
    });

    it(`${t}：列中间插入过空白列也不影响取值`, () => {
      const headers = [...spec.columns];
      headers.splice(2, 0, '（空列）');
      const rows = readRowsFromSheet(makeSheet(headers), spec.columns, ['姓名', '身份证号']);
      expect(rows[0]['残疾等级']).toBe('二级');
      expect(rows[0]['银行账号']).toBe('6222000000000000000');
    });
  }

  it('旧模板（缺必填列）明确报错，不会静默错位', () => {
    const spec = SPECIAL_IMPORT_SPECS.low_income;
    const oldHeaders = spec.columns.filter((c) => c !== '残疾类别' && c !== '残疾等级');
    // 若把残疾两列也列入必填，旧模板必须被拒
    expect(() =>
      readRowsFromSheet(makeSheet(oldHeaders), spec.columns, ['姓名', '身份证号', '残疾等级'])
    ).toThrow(/TEMPLATE_MISSING_COLUMNS/);
  });

  it('完全无关的表头被识别为模板不匹配', () => {
    const spec = SPECIAL_IMPORT_SPECS.disability;
    expect(() =>
      readRowsFromSheet(makeSheet(['列A', '列B', '列C']), spec.columns, ['姓名', '身份证号'])
    ).toThrow(/TEMPLATE_MISMATCH/);
  });

  it('表头含前后空格仍能匹配', () => {
    const spec = SPECIAL_IMPORT_SPECS.low_income;
    const spaced = spec.columns.map((c, i) => (i === 0 ? ` ${c} ` : c));
    const rows = readRowsFromSheet(makeSheet(spaced), spec.columns, ['姓名', '身份证号']);
    expect(rows[0]['姓名']).toBe('张三');
    expect(rows[0]['残疾等级']).toBe('二级');
  });

  /**
   * 事故成因确认：新增残疾两列后，旧模板的「银行账号」正好落在新版
   * 「残疾类别」的位置上（均为第 3 列），纯按列位置读取必然错位。
   * 正因为位置巧合，按表头校验必须存在，否则无法被发现。
   */
  it('旧模板下相邻列恰好占据缺失列的位置（事故成因）', () => {
    const spec = SPECIAL_IMPORT_SPECS.low_income;
    const oldHeaders = spec.columns.filter((c) => c !== '残疾类别' && c !== '残疾等级');
    // 位置相同 —— 这正是「按位置取值会读错」的根本原因
    expect(oldHeaders.indexOf('银行账号') + 1).toBe(spec.columns.indexOf('残疾类别') + 1);
    // 因此旧模板必须靠「必填列缺失」校验挡下来
    expect(() =>
      readRowsFromSheet(makeSheet(oldHeaders), spec.columns, ['姓名', '身份证号', '残疾类别', '残疾等级'])
    ).toThrow(/TEMPLATE_MISSING_COLUMNS/);
  });
});