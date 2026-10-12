/**
 * 年龄计算与年龄段划分
 */

/**
 * 统一把出生日期解析为「UTC 年/���/日」三个整数。
 *
 * 不返回 Date 对象：JS 对 'YYYY-MM-DD' 字符串按 UTC 解析，而对 Date 走本地取值，
 * 两者混用会在非 +08:00 环境（CI/容器）出现偏差。直接取出年月日三元组后比较，
 * 结果与环境时区无关。
 *
 * Date 输入（如遗留路径）按 UTC 取值——它代表「时刻」，我们要的是其中的日历日期。
 */
function toYmd(birthDate: string | Date): { y: number; m: number; d: number } | null {
  if (typeof birthDate === 'string') {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(birthDate.trim());
    if (!m) {
      const d = new Date(birthDate);
      if (Number.isNaN(d.getTime())) return null;
      return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() };
    }
    return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
  }
  if (Number.isNaN(birthDate.getTime())) return null;
  return { y: birthDate.getUTCFullYear(), m: birthDate.getUTCMonth() + 1, d: birthDate.getUTCDate() };
}

/** 根据出生日期计算周岁年龄（不受运行环境时区影响） */
export function calcAge(birthDate: string | Date | null | undefined, at?: Date): number | null {
  if (!birthDate) return null;
  const b = toYmd(birthDate);
  if (!b) return null;

  const now = at || new Date();
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  const d = now.getDate();

  let age = y - b.y;
  if (m < b.m || (m === b.m && d < b.d)) age--;
  return age >= 0 && age < 150 ? age : null;
}

export interface AgeBand {
  label: string;
  min: number;
  max: number;
}

/** 年龄段划分口径 */
export const AGE_BANDS: AgeBand[] = [
  { label: '0-17岁', min: 0, max: 17 },
  { label: '18-35岁', min: 18, max: 35 },
  { label: '36-59岁', min: 36, max: 59 },
  { label: '60-79岁', min: 60, max:79 },
  { label: '80岁及以上', min: 80, max: 999 },
];

/** 判断年龄所属年龄段 */
export function ageBand(age: number): string {
  for (const band of AGE_BANDS) {
    if (age >= band.min && age <= band.max) return band.label;
  }
  return '未知';
}

/**
 * 重点人群年龄类口径（与 AGE_BANDS 的 0-17 / 60+ 分段保持一致）：
 * - 老年人：60 周岁及以上
 * - 未成年人：18 周岁以下，即最大 17 岁（buildAgeFilter 的 maxAge 为闭区间，故传 17）
 */
export const ELDERLY_MIN_AGE = 60;
export const MINOR_MAX_AGE = 17;

/** 年龄区间的人话表述：只给下界显示「≥N 岁」，只给上界显示「<N+1 岁」，两端齐全显示「A-B 岁」 */
export function ageRangeText(minAge?: number | null, maxAge?: number | null): string {
  if (minAge != null && maxAge != null) return `${minAge}-${maxAge} 岁`;
  if (minAge != null) return `≥${minAge} 岁`;
  if (maxAge != null) return `<${maxAge + 1} 岁`;
  return '不限';
}
