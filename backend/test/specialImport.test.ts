import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  SPECIAL_IMPORT_SPECS,
  SPECIAL_TASK_TYPE,
  IMPORT_TASK_TYPES,
  normalizeCell,
  parseDisabilityLevel,
  parsePovertyMode,
  parseAmount,
  mapRowFields,
} from '../src/utils/specialImport';

describe('专项导入配置', () => {
  it('三类导入的列与人员详情页区块字段一致', () => {
    // 残疾人：对应详情页「残疾信息」区块的字段
    const d = SPECIAL_IMPORT_SPECS.disability.columns;
    for (const c of ['残疾类别', '残疾等级', '残疾证号', '监护人', '监护人手机']) {
      expect(d, `残疾人模板缺少 ${c}`).toContain(c);
    }
    // 特困/低保：对应「补贴发放与走访评估」区块
    for (const t of ['extreme_poverty', 'low_income'] as const) {
      const cols = SPECIAL_IMPORT_SPECS[t].columns;
      for (const c of ['银行账号', '发放金额', '家庭情况描述', '身体评估结果']) {
        expect(cols, `${t} 模板缺少 ${c}`).toContain(c);
      }
      // 特困/低保人员中可能兼是残疾人，也要有残疾两列
      expect(cols, `${t} 模板缺少 残疾类别`).toContain('残疾类别');
      expect(cols, `${t} 模板缺少 残疾等级`).toContain('残疾等级');
    }
    // 特困特有供养方式列
    expect(SPECIAL_IMPORT_SPECS.extreme_poverty.columns).toContain('供养方式');
  });

  it('三类导入都有独立 task_type 与自动标签', () => {
    expect(SPECIAL_TASK_TYPE.disability).toBe('DISABLED');
    expect(SPECIAL_IMPORT_SPECS.disability.tagCodes).toContain('DISABLED_PERSON');
    expect(SPECIAL_IMPORT_SPECS.extreme_poverty.tagCodes).toContain('EXTREME_POVERTY_PERSON');
    expect(SPECIAL_IMPORT_SPECS.low_income.tagCodes).toContain('LOW_INCOME_PERSON');
  });

  it('每份模板都有填写说明', () => {
    for (const s of Object.values(SPECIAL_IMPORT_SPECS)) {
      expect(s.notes.length, `${s.type} 缺少填写说明`).toBeGreaterThan(0);
    }
  });

  /**
   * 回归：新增专项类型后，导入任务列表的 taskType 过滤曾报
   * 「Invalid enum value. Expected 'PERSON' | 'KEY_GROUP'」——
   * 写入用新类型、过滤却仍是旧枚举，任务记录因此查不出来。
   */
  it('IMPORT_TASK_TYPES 覆盖全部专项类型，可直接用于列表过滤', () => {
    for (const t of Object.values(SPECIAL_TASK_TYPE)) {
      expect(IMPORT_TASK_TYPES, `任务类型枚举缺少 ${t}`).toContain(t);
    }
    // 与原有两种类型并存，且去重
    expect(IMPORT_TASK_TYPES).toContain('PERSON');
    expect(IMPORT_TASK_TYPES).toContain('KEY_GROUP');
    expect(new Set(IMPORT_TASK_TYPES).size).toBe(IMPORT_TASK_TYPES.length);
  });

  it('导入任务列表的 taskType 过滤用的是这个枚举，而不是写死的旧枚举', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../src/modules/excel.ts'),
      'utf8'
    );
    expect(src).toContain('z.enum(IMPORT_TASK_TYPES)');
    // 旧的硬编码枚举一旦被复制回来，这里会再次报 Invalid enum value
    expect(src).not.toContain("z.enum(['PERSON', 'KEY_GROUP'])");
  });

  it('专项导入写入的 task_type 与过滤枚举一致', () => {
    for (const spec of Object.values(SPECIAL_IMPORT_SPECS)) {
      expect(IMPORT_TASK_TYPES).toContain(spec.taskType);
    }
  });
});

describe('单元格解析容错', () => {
it('normalizeCell 去掉空格与全角空格，但保留下划线（LEVEL_1 需靠它匹配）', () => {
expect(normalizeCell(' 一 级 ')).toBe('一级');
expect(normalizeCell('LEVEL　1')).toBe('LEVEL1');
expect(normalizeCell('LEVEL_1')).toBe('LEVEL_1');
expect(normalizeCell(null)).toBe('');
});

  it('残疾等级支持中文、数字、编码多种写法', () => {
    expect(parseDisabilityLevel('一级')).toBe('LEVEL_1');
    expect(parseDisabilityLevel('二级（重度）')).toBe('LEVEL_2');
    expect(parseDisabilityLevel('3')).toBe('LEVEL_3');
    expect(parseDisabilityLevel('LEVEL_4')).toBe('LEVEL_4');
    expect(parseDisabilityLevel('四级')).toBe('LEVEL_4');
  });

  it('无法识别的残疾等级返回 null（不猜）', () => {
    expect(parseDisabilityLevel('五级')).toBeNull();
    expect(parseDisabilityLevel('优秀')).toBeNull();
    expect(parseDisabilityLevel('')).toBeNull();
  });

  it('供养方式支持简写', () => {
    expect(parsePovertyMode('集中供养')).toBe('CENTRALIZED');
    expect(parsePovertyMode('分散')).toBe('DISPERSED');
    expect(parsePovertyMode('集中')).toBe('CENTRALIZED');
    expect(parsePovertyMode('未知方式')).toBeNull();
  });

  it('金额容错千分位与货币符号，拒绝非法值', () => {
    expect(parseAmount('1,200.50')).toBe(1200.5);
    expect(parseAmount('850元')).toBe(850);
    expect(parseAmount('￥350')).toBe(350);
    expect(parseAmount('850')).toBe(850);
    expect(parseAmount('abc')).toBeNull();
    expect(parseAmount('-100')).toBeNull();
  });
});

describe('字段映射', () => {
  it('残疾行映射到 person_disability 列', () => {
    const spec = SPECIAL_IMPORT_SPECS.disability;
    const errs: string[] = [];
    const r = mapRowFields(spec, {
      '残疾类别': '肢体', '残疾等级': '二级', '残疾证号': '1321',
      '监护人': '李四', '监护人手机': '13900000000',
      '银行账号': '6222', '发放金额': '850',
    }, errs);
    expect(errs).toEqual([]);
    expect(r.disability).toEqual({
      disability_type: '肢体',
      disability_level: 'LEVEL_2',
      disability_card: '1321',
      guardian_name: '李四',
      guardian_phone: '13900000000',
    });
    expect(r.person).toEqual({ bank_account: '6222', subsidy_amount: 850 });
  });

  it('残疾等级缺失时报错（必填）', () => {
    const errs: string[] = [];
    mapRowFields(SPECIAL_IMPORT_SPECS.disability, { '残疾类别': '视力' }, errs);
    expect(errs.join()).toContain('残疾等级');
  });

  it('等级无法识别时报错且不写入脏值', () => {
    const errs: string[] = [];
    const r = mapRowFields(SPECIAL_IMPORT_SPECS.disability, { '残疾等级': '五级' }, errs);
    expect(errs.join()).toContain('残疾等级');
    expect(r.disability.disability_level).toBeUndefined();
  });

  it('金额非法时报错且不写入', () => {
    const errs: string[] = [];
    const r = mapRowFields(SPECIAL_IMPORT_SPECS.low_income, { '发放金额': '大约三百' }, errs);
    expect(errs.join()).toContain('发放金额');
    expect(r.person.subsidy_amount).toBeUndefined();
  });

  it('空值不进入待写入集合（保证不覆盖已有数据）', () => {
    const errs: string[] = [];
    const r = mapRowFields(SPECIAL_IMPORT_SPECS.low_income, {
      '银行账号': '', '发放金额': '', '家庭情况描述': '  ', '身体评估结果': null,
    }, errs);
    expect(errs).toEqual([]);
    expect(r.person).toEqual({});
  });

  it('低保模板同样可写入残疾类别与等级（低保人员中可能兼是残疾人）', () => {
    const errs: string[] = [];
    const r = mapRowFields(SPECIAL_IMPORT_SPECS.low_income, { '残疾类别': '听力', '残疾等级': '三级' }, errs);
    expect(errs).toEqual([]);
    expect(r.disability).toEqual({ disability_type: '听力', disability_level: 'LEVEL_3' });
  });

  it('特困模板同样可写入残疾类别与等级', () => {
    const errs: string[] = [];
    const r = mapRowFields(SPECIAL_IMPORT_SPECS.extreme_poverty, { '残疾类别': '智力', '残疾等级': '一级' }, errs);
    expect(errs).toEqual([]);
    expect(r.disability).toEqual({ disability_type: '智力', disability_level: 'LEVEL_1' });
  });

  it('特困/低保的残疾两列留空表示非残疾人，不产生残疾档案写入', () => {
    for (const t of ['extreme_poverty', 'low_income'] as const) {
      const errs: string[] = [];
      const r = mapRowFields(SPECIAL_IMPORT_SPECS[t], { '发放金额': '800' }, errs);
      expect(errs, `${t} 不应因残疾列留空而报错`).toEqual([]);
      expect(r.disability, `${t} 残疾列留空时不应写入档案`).toEqual({});
    }
  });

  it('特困/低保的残疾等级不是必填（只有残疾人台账才是）', () => {
    expect(SPECIAL_IMPORT_SPECS.disability.requireDisabilityLevel).toBe(true);
    expect(SPECIAL_IMPORT_SPECS.extreme_poverty.requireDisabilityLevel).toBeFalsy();
    expect(SPECIAL_IMPORT_SPECS.low_income.requireDisabilityLevel).toBeFalsy();
  });

  it('特困/低保只填残疾类别不填等级也可以（部分补录）', () => {
    const errs: string[] = [];
    const r = mapRowFields(SPECIAL_IMPORT_SPECS.low_income, { '残疾类别': '视力' }, errs);
    expect(errs).toEqual([]);
    expect(r.disability).toEqual({ disability_type: '视力' });
  });

  it('特困行解析出供养方式，供打集中/分散标签', () => {
    const errs: string[] = [];
    const r = mapRowFields(SPECIAL_IMPORT_SPECS.extreme_poverty, { '供养方式': '集中供养' }, errs);
    expect(errs).toEqual([]);
    expect(r.povertyMode).toBe('CENTRALIZED');
  });

  it('供养方式留空时返回 null，不自动改标签', () => {
    const errs: string[] = [];
    const r = mapRowFields(SPECIAL_IMPORT_SPECS.extreme_poverty, { '发放金额': '900' }, errs);
    expect(r.povertyMode).toBeNull();
    expect(errs).toEqual([]);
  });

  it('供养方式无法识别时报错', () => {
    const errs: string[] = [];
    mapRowFields(SPECIAL_IMPORT_SPECS.extreme_poverty, { '供养方式': '集中加分散' }, errs);
    expect(errs.join()).toContain('供养方式');
  });
});