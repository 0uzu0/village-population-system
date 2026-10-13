/**
 * 专项条口台账的「条口 / 工作类型」配置。
 *
 * 与重点人群专项导入（specialImport.ts 的 SPECIAL_IMPORT_SPECS）同一套路：
 * 枚举类扩展走「配置写在代码里」，新增条口/工作类型只改这个文件 + 迁移里补权限，
 * 不建额外的 DB 字典表，也不做后台配置界面——村级系统规模下更简单也更可控。
 *
 * 数据库只存编码（如 WATER / RIVER_MOWING），中文名由这里统一映射。
 * 前端下拉与图表图例都从这里取（经 /ledgers/meta 暴露）。
 */

export interface LedgerWorkType {
  code: string;
  name: string;
}

export interface LedgerCategory {
  code: string;
  name: string;
  workTypes: LedgerWorkType[];
}

export const LEDGER_CATEGORIES: LedgerCategory[] = [
  {
    code: 'WATER',
    name: '水利',
    workTypes: [
      { code: 'RIVER_MOWING', name: '河道打草' },
      { code: 'SMALL_PROJECT', name: '河道小型工程' },
      { code: 'PUMP_REPAIR', name: '泵站维修' },
    ],
  },
  // 未来新增条口（如民政、卫健）在此追加一项即可，无需改表结构：
  // { code: 'CIVIL', name: '民政', workTypes: [ { code: 'VISIT', name: '走访慰问' } ] },
];

const CATEGORY_MAP = new Map<string, LedgerCategory>(LEDGER_CATEGORIES.map((c) => [c.code, c]));
const WORKTYPE_MAP = new Map<string, string>();
for (const c of LEDGER_CATEGORIES) {
  for (const w of c.workTypes) WORKTYPE_MAP.set(w.code, w.name);
}

/** 条口编码 → 名称（未知回退原值） */
export function categoryName(code: string): string {
  return CATEGORY_MAP.get(code)?.name ?? code;
}

/** 工作类型编码 → 名称（未知回退原值） */
export function workTypeName(code: string): string {
  return WORKTYPE_MAP.get(code) ?? code;
}

/** 校验条口编码是否合法 */
export function isValidCategory(code: string): boolean {
  return CATEGORY_MAP.has(code);
}

/** 校验工作类型编码是否合法 */
export function isValidWorkType(code: string): boolean {
  return WORKTYPE_MAP.has(code);
}

/** 该工作类型是否属于该条口（用于写接口双字段一致性校验） */
export function isWorkTypeUnderCategory(category: string, workType: string): boolean {
  return CATEGORY_MAP.get(category)?.workTypes.some((w) => w.code === workType) ?? false;
}
