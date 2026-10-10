/**
 * 年龄计算与年龄段划分
 */

/** 根据出生日期计算周岁年龄 */
export function calcAge(birthDate: string | Date | null | undefined, at?: Date): number | null {
  if (!birthDate) return null;
  const birth = typeof birthDate === 'string' ? new Date(birthDate) : birthDate;
  if (isNaN(birth.getTime())) return null;
  const now = at || new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const m = now.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) age--;
  return age;
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
