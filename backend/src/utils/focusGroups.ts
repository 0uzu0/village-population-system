import { ELDERLY_MIN_AGE, MINOR_MAX_AGE } from './age';

/**
 * 重点人群「人群定义」的唯一来源。
 *
 * 为什么需要：此前同一批人群在三个地方各写了一遍，改一处要同步三处，极易漏：
 *   - `modules/keygroup.ts` 的 QUICK_GROUPS（快捷入口）
 *   - `modules/grid.ts` 的 FOCUS_TAGS（网格/村庄统计列）
 *   - `modules/statistics.ts` 的 IN 列表（工作台卡片）
 *   - `modules/excel.ts` 的 EXPORT_TAG_FLAGS（导出标志列）
 * 现在统一从这里取，新增一类人群只改本文件。
 *
 * ⚠️ `code` 是对外契约：身份类的 code 必须等于真实的 `tag_definition.code`
 * （前端用它匹配标签做筛选），年龄类固定为 ELDERLY / MINOR。**不要随意变更。**
 */
export interface FocusGroupDef {
  /** 对外编码：身份类为主标签编码；年龄类为 ELDERLY / MINOR */
  code: string;
  /** 基础中文名（不含年龄阈值后缀） */
  label: string;
  /** 归属标签编码，命中任一即计入；年龄类为空数组（按年龄自动判定） */
  tagCodes: string[];
  /** 年龄类阈值（口径：≥minAge 岁 / ≤maxAge 岁） */
  minAge?: number;
  maxAge?: number;
  /** 网格 / 村庄维度统计的 SQL 列名（grid.ts） */
  countField?: string;
  /** 工作台统计卡片字段名（statistics.ts） */
  dashboardField?: string;
  /** 导出时对应的标志列 key（excel.ts） */
  exportFlagKey?: string;
  /** 导出标志列标题（可与 label 不同，如「五保/特困」） */
  exportFlagLabel?: string;
}

export const FOCUS_GROUPS: FocusGroupDef[] = [
  {
    code: 'PARTY_MEMBER',
    label: '党员',
    tagCodes: ['PARTY_MEMBER', 'PARTY_PROBATIONARY'],
    countField: 'party_count',
    dashboardField: 'partyCount',
    exportFlagKey: 'is_party',
    exportFlagLabel: '党员',
  },
  {
    code: 'VETERAN',
    label: '退役军人',
    tagCodes: ['VETERAN'],
    countField: 'veteran_count',
    dashboardField: 'veteranCount',
    exportFlagKey: 'is_veteran',
    exportFlagLabel: '退役军人',
  },
  {
    code: 'PREFERENTIAL_OBJECT',
    label: '优抚对象',
    tagCodes: ['PREFERENTIAL_OBJECT'],
    countField: 'preferential_count',
    dashboardField: 'preferentialCount',
    exportFlagKey: 'is_preferential',
    exportFlagLabel: '优抚对象',
  },
  {
    code: 'LOW_INCOME_PERSON',
    label: '低保对象',
    tagCodes: ['LOW_INCOME_PERSON'],
    countField: 'low_income_count',
    dashboardField: 'lowIncomePersonCount',
    exportFlagKey: 'is_low_income',
    exportFlagLabel: '低保',
  },
  {
    code: 'EXTREME_POVERTY_PERSON',
    label: '特困供养对象',
    tagCodes: ['EXTREME_POVERTY_PERSON'],
    countField: 'extreme_poverty_count',
    dashboardField: 'extremePovertyCount',
    exportFlagKey: 'is_extreme_poverty',
    exportFlagLabel: '五保/特困',
  },
  {
    code: 'DISABLED_PERSON',
    label: '残疾人',
    tagCodes: ['DISABLED_PERSON'],
    countField: 'disabled_count',
    dashboardField: 'disabledCount',
    exportFlagKey: 'is_disabled',
    exportFlagLabel: '残疾人',
  },
  // ---- 年龄类：无需打标签，按出生日期自动判定 ----
  {
    code: 'ELDERLY',
    label: '老年人',
    tagCodes: [],
    minAge: ELDERLY_MIN_AGE,
  },
  {
    code: 'MINOR',
    label: '未成年人',
    tagCodes: [],
    maxAge: MINOR_MAX_AGE,
  },
];

/** 年龄类人群（无标签，按年龄判定） */
export function isAgeGroup(g: FocusGroupDef): boolean {
  return g.minAge != null || g.maxAge != null;
}

/** 带年龄阈值后缀的展示名，如「老年人（≥60岁）」——快捷入口与筛选条件用 */
export function focusGroupLabel(g: FocusGroupDef): string {
  if (g.minAge != null) return `${g.label}（≥${g.minAge}岁）`;
  if (g.maxAge != null) return `${g.label}（<${g.maxAge + 1}岁）`;
  return g.label;
}

/** 全部身份类标签编码（去重），用于一次 IN 查询覆盖所有身份类人群 */
export function allFocusTagCodes(): string[] {
  const set = new Set<string>();
  for (const g of FOCUS_GROUPS) for (const c of g.tagCodes) set.add(c);
  return [...set];
}

/** 快捷入口（GET /key-groups/quick）返回给客户端的单条 */
export interface QuickGroupVo {
  label: string;
  code: string;
  /**
   * 构成该族群的标签编码（命中任一即计入）。
   *
   * ⚠️ 这是**客户端下钻筛选的依据**：`code` 只是族群编码，拿它去匹配标签会漏人
   * （「党员」的 code 是 PARTY_MEMBER，但这个人群还要算上预备党员）。
   * 因此接口必须把它带出去，前端不能再靠自己猜。
   */
  tagCodes: string[];
  count: number;
  color: string;
  /** true 表示按年龄判定（筛 minAge/maxAge），false 表示按标签筛 */
  byAge: boolean;
  minAge: number | null;
  maxAge: number | null;
}

export interface QuickGroupCounts {
  /** 标签编码 → 在册人数 */
  tagCounts: Record<string, number>;
  /** 标签编码 → 颜色 */
  tagColors: Record<string, string>;
  /** 年龄类族群 code → 人数（按出生日期推算，与标签无关） */
  ageCounts?: Record<string, number>;
}

/**
 * 把「各标签人数 / 各年龄组人数」投影成快捷入口列表。
 *
 * 抽成纯函数是为了能直接测「人数与筛选口径是否一致」——这是本模块最容易
 * 出错也最难发现的地方：族群人数由 `tagCodes` 求和（与工作台卡片同一算法），
 * 客户端拿 `tagCodes` 去筛，两边才对得上。
 */
export function buildQuickGroups(counts: QuickGroupCounts): QuickGroupVo[] {
  return FOCUS_GROUPS.map((g) => {
    const byAge = isAgeGroup(g);
    return {
      label: focusGroupLabel(g),
      code: g.code,
      tagCodes: g.tagCodes,
      count: byAge
        ? counts.ageCounts?.[g.code] ?? 0
        : g.tagCodes.reduce((sum, c) => sum + (counts.tagCounts[c] ?? 0), 0),
      // 颜色取族群主标签（身份类的 code 一定在自己的 tagCodes 里）
      color: counts.tagColors[g.code] ?? '#3978F6',
      byAge,
      minAge: g.minAge ?? null,
      maxAge: g.maxAge ?? null,
    };
  });
}
