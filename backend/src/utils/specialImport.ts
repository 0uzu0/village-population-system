/**
 * 重点人群专项台账导入（残疾人 / 特困供养 / 低保）。
 *
 * 与「重点人群名单导入」同定位：**只匹配已有人员，不新建**——
 * 这些人必然已在人口档案中，匹配不到就报错让用户先导档案，避免造出脏数据。
 *
 * 三类导入共用一套引擎，差异全部收敛到本文件的配置表：
 * - 列清单（与人员详情页对应区块字段一致）
 * - 要写入的字段（person 主表列 / person_disability 列）
 * - 自动打的标签编码
 *
 * 覆盖策略：**空值不覆盖**已有数据。台账通常是分批补录的，
 * 某次表格没填某列不应该把库里已有的信息清掉。
 */

export type SpecialImportType = 'disability' | 'extreme_poverty' | 'low_income';

/** 专项导入类型 → excel_import_task.task_type */
export const SPECIAL_TASK_TYPE: Record<SpecialImportType, string> = {
  disability: 'DISABLED',
  extreme_poverty: 'EXTREME_POVERTY',
  low_income: 'LOW_INCOME',
};

/**
 * 全部合法的 task_type 集合（含人口档案与重点人群名单）。
 * 导入任务列表的 taskType 过滤直接用它做校验——新增导入类型时只改这一处，
 * 否则会出现「任务写进去了但列表接口报 Invalid enum value」。
 */
export const IMPORT_TASK_TYPES = [
  'PERSON', 'KEY_GROUP',
  ...Object.values(SPECIAL_TASK_TYPE),
] as const;

/** 残疾等级单元格可接受的写法 → 标准编码 */
export const DISABILITY_LEVEL_INPUT: Record<string, string> = {
  '一级': 'LEVEL_1', '一级（极重度）': 'LEVEL_1', '1级': 'LEVEL_1', '1': 'LEVEL_1',
  '二级': 'LEVEL_2', '二级（重度）': 'LEVEL_2', '2级': 'LEVEL_2', '2': 'LEVEL_2',
  '三级': 'LEVEL_3', '三级（中度）': 'LEVEL_3', '3级': 'LEVEL_3', '3': 'LEVEL_3',
  '四级': 'LEVEL_4', '四级（轻度）': 'LEVEL_4', '4级': 'LEVEL_4', '4': 'LEVEL_4',
};

/** 特困供养方式单元格可接受的写法 → 标准编码 */
export const POVERTY_MODE_INPUT: Record<string, string> = {
  '集中供养': 'CENTRALIZED', '集中': 'CENTRALIZED', '机构供养': 'CENTRALIZED',
  '分散供养': 'DISPERSED', '分散': 'DISPERSED', '居家供养': 'DISPERSED',
};

/**
 * 各类导入的列清单与字段映射。
 * columns 顺序即模板列顺序，必须与人员详情页对应区块的字段一致。
 */
export interface SpecialImportSpec {
  type: SpecialImportType;
  label: string;
  taskType: string;
  /** 自动打的人员标签编码 */
  tagCodes: string[];
  columns: string[];
  /** 表格列 → person 主表列（仅非空才写入） */
  personFields: Record<string, string>;
  /** 表格列 → person_disability 列（仅非空才写入） */
  disabilityFields?: Record<string, string>;
  /** 是否需要残疾等级校验（残疾人导入） */
  requireDisabilityLevel?: boolean;
  /** 表头下的说明文案，前端模板说明区展示 */
  notes: string[];
}

export const SPECIAL_IMPORT_SPECS: Record<SpecialImportType, SpecialImportSpec> = {
  disability: {
    type: 'disability',
    label: '残疾人台账',
    taskType: 'DISABLED',
    tagCodes: ['DISABLED_PERSON'],
    // 与人员详情页「残疾信息」区块一一对应
    columns: [
      '姓名', '身份证号', '残疾类别', '残疾等级', '残疾证号',
      '监护人', '监护人手机', '银行账号', '发放金额', '备注',
    ],
    personFields: { '银行账号': 'bank_account', '发放金额': 'subsidy_amount' },
    disabilityFields: {
      '残疾类别': 'disability_type',
      '残疾等级': 'disability_level',
      '残疾证号': 'disability_card',
      '监护人': 'guardian_name',
      '监护人手机': 'guardian_phone',
      '备注': 'remark',
    },
    requireDisabilityLevel: true,
    notes: [
      '本表只更新已在人口档案中的人员，不新建人员；查不到请先导入人口档案',
      '⚠ 身份证号必须是 18 位完整号码（末位校验码不能省略）。户籍表导出常见 14 位脱敏号（末4 位被抹掉），这种号码无法匹配人员，需补全后再导入',
      '若身份证确实无法取得，可将「身份证号」列留空——系统会按姓名匹配，但要求该姓名在系统中唯一',
      '残疾等级可填：一级 / 二级 / 三级 / 四级（一级最重），或直接填 LEVEL_1~LEVEL_4',
      '残疾类别可填：视力 / 听力 / 言语 / 肢体 / 智力 / 精神 / 多重',
      '留空的列不会覆盖系统内已有数据',
      '导入后会自动为该人员打上「残疾人」标签',
    ],
  },
  extreme_poverty: {
    type: 'extreme_poverty',
    label: '特困供养台账',
    taskType: 'EXTREME_POVERTY',
    tagCodes: ['EXTREME_POVERTY_PERSON'],
    // 与人员详情页「补贴发放与走访评估」区块对应
    columns: [
      '姓名', '身份证号', '供养方式', '残疾类别', '残疾等级',
      '银行账号', '发放金额', '家庭情况描述', '身体评估结果', '备注',
    ],
    personFields: {
      '银行账号': 'bank_account',
      '发放金额': 'subsidy_amount',
      '家庭情况描述': 'family_condition',
      '身体评估结果': 'health_assessment',
      '备注': 'remark',
    },
    // 特困人员中可能同时是残疾人：残疾类别/等级写进专项档案，
    // 留空则不动已有档案（不覆盖规则同样生效）
    disabilityFields: {
      '残疾类别': 'disability_type',
      '残疾等级': 'disability_level',
    },
    notes: [
      '本表只更新已在人口档案中的人员，不新建人员；查不到请先导入人口档案',
      '⚠ 身份证号必须是 18 位完整号码（末位校验码不能省略）。户籍表导出常见 14 位脱敏号，这种号码无法匹配人员，需补全后再导入',
      '若身份证确实无法取得，可将「身份证号」列留空——系统会按姓名匹配，但要求该姓名在系统中唯一',
      '供养方式可填：集中供养 / 分散供养（留空则不自动改供养方式标签）',
      '发放金额单位为元/月，填数字（如 800 或 850.5）',
      '残疾类别可填：视力 / 听力 / 言语 / 肢体 / 智力 / 精神 / 多重；残疾等级填一级 / 二级 / 三级 / 四级（一级最重）',
      '两列都留空表示非残疾人，不改动其残疾档案；只填其一也可以',
      '留空的列不会覆盖系统内已有数据',
      '导入后会自动为该人员打上「特困供养对象」标签',
    ],
  },
  low_income: {
    type: 'low_income',
    label: '低保台账',
    taskType: 'LOW_INCOME',
    tagCodes: ['LOW_INCOME_PERSON'],
    // 与人员详情页「补贴发放与走访评估」区块对应
    columns: [
      '姓名', '身份证号', '残疾类别', '残疾等级', '银行账号', '发放金额',
      '家庭情况描述', '身体评估结果', '备注',
    ],
    personFields: {
      '银行账号': 'bank_account',
      '发放金额': 'subsidy_amount',
      '家庭情况描述': 'family_condition',
      '身体评估结果': 'health_assessment',
      '备注': 'remark',
    },
    // 低保人员中可能同时是残疾人，与特困台账同理写入专项档案
    disabilityFields: {
      '残疾类别': 'disability_type',
      '残疾等级': 'disability_level',
    },
    notes: [
      '本表只更新已在人口档案中的人员，不新建人员；查不到请先导入人口档案',
      '⚠ 身份证号必须是 18 位完整号码（末位校验码不能省略）。户籍表导出常见 14 位脱敏号，这种号码无法匹配人员，需补全后再导入',
      '若身份证确实无法取得，可将「身份证号」列留空——系统会按姓名匹配，但要求该姓名在系统中唯一',
      '发放金额单位为元/月，填数字（如 350 或 450.5）',
      '残疾类别可填：视力 / 听力 / 言语 / 肢体 / 智力 / 精神 / 多重；残疾等级填一级 / 二级 / 三级 / 四级（一级最重）',
      '两列都留空表示非残疾人，不改动其残疾档案；只填其一也可以',
      '留空的列不会覆盖系统内已有数据',
      '导入后会自动为该人员打上「低保对象」标签',
    ],
  },
};

/**
 * 归一化单元格文本：去空白、全角空格。
 * 注意**不去下划线**——残疾等级编码形如 LEVEL_1，去掉就匹配不上了。
 */
export function normalizeCell(v: unknown): string {
  return String(v ?? '').replace(/[\s　]/g, '').trim();
}

/** 解析残疾等级：支持中文/数字/编码；无法识别返回 null */
export function parseDisabilityLevel(v: unknown): string | null {
  const s = normalizeCell(v);
  if (!s) return null;
  const upper = s.toUpperCase();
  if (/^LEVEL_[1-4]$/.test(upper)) return upper;
  return DISABILITY_LEVEL_INPUT[s] ?? null;
}

/** 解析供养方式：支持中文简写；无法识别返回 null */
export function parsePovertyMode(v: unknown): string | null {
  const s = normalizeCell(v);
  if (!s) return null;
  return POVERTY_MODE_INPUT[s] ?? null;
}

/** 解析金额：容错千分位逗号与货币符号；非法返回 null */
export function parseAmount(v: unknown): number | null {
  const s = normalizeCell(v).replace(/[,，¥￥元]/g, '');
  if (!s) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * 把一行表格数据按 spec 映射为待写入的字段集（仅含非空值）。
 * 校验错误通过 errs 收集，不抛异常——单行出错不影响整批其余行。
 */
export function mapRowFields(
  spec: SpecialImportSpec,
  row: Record<string, any>,
  errs: string[]
): { person: Record<string, any>; disability: Record<string, any>; povertyMode: string | null } {
  const person: Record<string, any> = {};
  const disability: Record<string, any> = {};

  for (const [col, dbCol] of Object.entries(spec.personFields)) {
    const raw = row[col];
    if (normalizeCell(raw) === '') continue; // 空值不覆盖
    if (dbCol === 'subsidy_amount') {
      const amt = parseAmount(raw);
      if (amt == null) {
        errs.push(`「${col}」不是有效金额：${String(raw)}（应为数字，单位元/月）`);
        continue;
      }
      person[dbCol] = amt;
    } else {
      person[dbCol] = String(raw).trim();
    }
  }

  let povertyMode: string | null = null;
  if (spec.type === 'extreme_poverty') {
    const rawMode = row['供养方式'];
    if (normalizeCell(rawMode) !== '') {
      povertyMode = parsePovertyMode(rawMode);
      if (!povertyMode) {
        errs.push(`无法识别的供养方式：${String(rawMode)}（可填：集中供养 / 分散供养）`);
      }
    }
  }

  for (const [col, dbCol] of Object.entries(spec.disabilityFields || {})) {
    const raw = row[col];
    if (normalizeCell(raw) === '') continue;
    if (dbCol === 'disability_level') {
      const lv = parseDisabilityLevel(raw);
      if (!lv) {
        errs.push(`无法识别的残疾等级：${String(raw)}（可填：一级 / 二级 / 三级 / 四级）`);
        continue;
      }
      disability[dbCol] = lv;
    } else {
      disability[dbCol] = String(raw).trim();
    }
  }

  // 残疾人台账必须能判定等级，否则档案无法用于筛选与统计
  if (spec.requireDisabilityLevel && normalizeCell(row['残疾等级']) === '') {
    errs.push('残疾等级为必填项（一级最重，可填：一级 / 二级 / 三级 / 四级）');
  }

  return { person, disability, povertyMode };
}