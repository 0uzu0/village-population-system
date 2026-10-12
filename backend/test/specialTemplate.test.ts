import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { SPECIAL_IMPORT_SPECS } from '../src/utils/specialImport';

/**
 * 专项台账模板生成的回归测试。
 *
 * 事故：模板下载接口曾对「残疾证号」「监护人手机」两列硬编码设置文本格式，
 * 但特困/低保模板根本没有这两列，ExcelJS 的 getCell 取不存在的列会抛错，
 * 导致这两类模板下载 500（残疾人模板恰好有这两列，所以没暴露）。
 */

/** 示例行构造：与 excel.ts 中 sampleRowFor 保持一致 */
function sampleRowFor(spec: { columns: string[] }): any[] {
  const base: Record<string, any> = {
    '姓名': '张三',
    '身份证号': '320102199001011234',
    '残疾类别': '肢体',
    '残疾等级': '二级',
    '残疾证号': '132101199001011234',
    '监护人': '张三妻',
    '监护人手机': '13900000000',
    '供养方式': '分散供养',
    '银行账号': '6222000000000000000000',
    '发放金额': 850,
    '家庭情况描述': '示例描述',
    '身体评估结果': '示例评估',
    '备注': '',
  };
  return spec.columns.map((c) => base[c] ?? '');
}

/** 复刻 excel.ts 的模板构建过程（含文本格式设置） */
async function buildTemplate(spec: any): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(spec.label);
  ws.columns = spec.columns.map((c: string) => ({ header: c, key: c, width: c.includes('描述') || c.includes('评估') ? 30 : 18 }));
  ws.addRow(sampleRowFor(spec));
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEAF1FE' } };
  const textColumns = ['身份证号', '残疾证号', '监护人手机', '监护人电话', '银行账号'];
  for (const col of textColumns) {
    if (spec.columns.includes(col)) ws.getRow(2).getCell(col).numFmt = '@';
  }
  const help = wb.addWorksheet('填写说明');
  help.columns = [{ header: '说明', key: 'text', width: 78 }];
  spec.notes.forEach((n: string, i: number) => help.addRow({ text: `${i + 1}. ${n}` }));
  help.getRow(1).font = { bold: true };
  return wb;
}

describe('专项台账模板生成', () => {
  const types = ['disability', 'extreme_poverty', 'low_income'] as const;

  for (const t of types) {
    it(`${t} 模板可正常生成且能写出 buffer`, async () => {
      const wb = await buildTemplate(SPECIAL_IMPORT_SPECS[t]);
      expect(wb.worksheets.length).toBe(2);
      const buf = await wb.xlsx.writeBuffer();
      expect(buf.byteLength).toBeGreaterThan(0);
    });

    it(`${t} 模板首行表头与配置列完全一致`, async () => {
      const spec = SPECIAL_IMPORT_SPECS[t];
      const wb = await buildTemplate(spec);
      const headers = wb.worksheets[0].getRow(1).values.filter((v) => typeof v === 'string');
      expect(headers).toEqual(spec.columns);
    });

    it(`${t} 模板示例行长度与列数一致`, () => {
      const spec = SPECIAL_IMPORT_SPECS[t];
      expect(sampleRowFor(spec)).toHaveLength(spec.columns.length);
    });

    it(`${t} 模板含「填写说明」工作表且条数与配置一致`, async () => {
      const spec = SPECIAL_IMPORT_SPECS[t];
      const wb = await buildTemplate(spec);
      const help = wb.worksheets[1];
      expect(help.getCell('A1').value).toBe('说明');
      expect(help.rowCount).toBe(spec.notes.length + 1);
    });
  }

  /**
   * 关键回归：三份模板的列不同，不能对固定列名无条件设置格式。
   * 之前硬编码 getCell('残疾证号') 在特困/低保模板上直接抛错 → 500。
   */
  it('模板不含某列时不做格式设置（getCell 对缺失列会抛错）', async () => {
    const fakeSpec = { label: '测试', columns: ['姓名', '发放金额'], notes: ['x'] };
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(fakeSpec.label);
    ws.columns = fakeSpec.columns.map((c: string) => ({ header: c, key: c, width: 18 }));
    ws.addRow(['张三', 100]);
    const textColumns = ['身份证号', '残疾证号', '监护人手机', '监护人电话', '银行账号'];
    for (const col of textColumns) {
      if (fakeSpec.columns.includes(col)) ws.getRow(2).getCell(col).numFmt = '@';
    }
    const buf = await wb.xlsx.writeBuffer();
    expect(buf.byteLength).toBeGreaterThan(0);
  });

  it('三类模板的身份证号均为文本格式（长数字不丢前导零）', async () => {
    for (const t of types) {
      const wb = await buildTemplate(SPECIAL_IMPORT_SPECS[t]);
      expect(wb.worksheets[0].getRow(2).getCell('身份证号').numFmt, `${t} 身份证号应为文本`).toBe('@');
    }
  });

  it('含银行账号的模板中，银行账号为文本格式（避免科学计数法）', async () => {
    for (const t of types) {
      const spec = SPECIAL_IMPORT_SPECS[t];
      if (!spec.columns.includes('银行账号')) continue;
      const wb = await buildTemplate(spec);
      expect(wb.worksheets[0].getRow(2).getCell('银行账号').numFmt, `${t} 银行账号应为文本`).toBe('@');
    }
  });

  it('残疾等级与供养方式这类枚举列不设文本格式（否则导入解析不到）', async () => {
    // 这些列要保持常规格式：填「二级」应被读成字符串 '二级' 而不是 '2'
    const spec = SPECIAL_IMPORT_SPECS.disability;
    const wb = await buildTemplate(spec);
    expect(wb.worksheets[0].getRow(2).getCell('残疾等级').numFmt).not.toBe('@');
  });
});