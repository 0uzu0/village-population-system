/**
 * 残疾信息口径（V008 起）。
 *
 * 残疾专项档案存 person_disability 表，与 person 一对一（uk_pd_person）。
 * 大多数人没有残疾信息，因此独立成表，不在 person 主表留 5 个空列。
 */

/** 残疾等级：一级最重，四级最轻，与国家残疾人证等级口径一致 */
export const DISABILITY_LEVELS = ['LEVEL_1', 'LEVEL_2', 'LEVEL_3', 'LEVEL_4'] as const;
export type DisabilityLevel = (typeof DISABILITY_LEVELS)[number];

export const DISABILITY_LEVEL_LABELS: Record<string, string> = {
  LEVEL_1: '一级（极重度）',
  LEVEL_2: '二级（重度）',
  LEVEL_3: '三级（中度）',
  LEVEL_4: '四级（轻度）',
};

/** 残疾类别：GB/T 26341 标准六类 + 多重残疾 */
export const DISABILITY_TYPES = ['视力', '听力', '言语', '肢体', '智力', '精神', '多重'] as const;

export function disabilityLevelLabel(level?: string | null): string {
  if (!level) return '';
  return DISABILITY_LEVEL_LABELS[level] || level;
}

/**
 * 残疾等级区间 SQL 片段（筛选用）。
 * 等级数字越小越重，所以「一级~二级」对应 LEVEL_NUMBER BETWEEN 1 AND 2，
 * 不能直接拿 LEVEL_1~LEVEL_2 做字符串比较（会得到相反结果）。
 */
export function buildDisabilityLevelFilter(
  minLevel: string | null | undefined,
  maxLevel: string | null | undefined,
): { where: string; params: any[] } {
  const num = (v?: string | null) => {
    if (!v) return null;
    const m = /^LEVEL_([1-4])$/.exec(v);
    return m ? Number(m[1]) : null;
  };
  const min = num(minLevel);
  const max = num(maxLevel);
  const where: string[] = [];
  const params: any[] = [];
  if (min != null && max != null) {
    const lo = Math.min(min, max);
    const hi = Math.max(min, max);
    where.push("CAST(SUBSTRING(pd.disability_level, 7) AS UNSIGNED) BETWEEN ? AND ?");
    params.push(lo, hi);
  } else if (min != null) {
    // 一级最重：只要下界即表示「不轻于该等级」，数字 <= min
    where.push('CAST(SUBSTRING(pd.disability_level, 7) AS UNSIGNED) <= ?');
    params.push(min);
  } else if (max != null) {
    where.push('CAST(SUBSTRING(pd.disability_level, 7) AS UNSIGNED) >= ?');
    params.push(max);
  }
  return { where: where.join(' AND '), params };
}