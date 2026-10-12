/**
 * 残疾信息口径（与后端 utils/disability.ts 保持一致）。
 *
 * 残疾专项档案存 person_disability 表，与人员一对一。
 * 一级最重、四级最轻，与国家残疾人证等级口径一致。
 */

export const DISABILITY_LEVELS = [
  { label: '一级（极重度）', value: 'LEVEL_1' },
  { label: '二级（重度）', value: 'LEVEL_2' },
  { label: '三级（中度）', value: 'LEVEL_3' },
  { label: '四级（轻度）', value: 'LEVEL_4' },
] as const;

export const DISABILITY_LEVEL_LABELS: Record<string, string> = {
  LEVEL_1: '一级（极重度）',
  LEVEL_2: '二级（重度）',
  LEVEL_3: '三级（中度）',
  LEVEL_4: '四级（轻度）',
};

export const DISABILITY_TYPES = ['视力', '听力', '言语', '肢体', '智力', '精神', '多重'] as const;

export function disabilityLevelLabel(level?: string | null): string {
  if (!level) return '';
  return DISABILITY_LEVEL_LABELS[level] || level;
}

/** 紧凑标签：表格列宽有限，只显示「一级」这样的简称 */
export function disabilityLevelShort(level?: string | null): string {
  if (!level) return '';
  const m = /^LEVEL_(\d)$/.exec(level);
  return m ? `${['一', '二', '三', '四'][Number(m[1]) - 1]}级` : level;
}

/** 特困供养方式（V008 新增的两个标签维度） */
export const EXTREME_POVERTY_MODES = [
  { label: '集中供养', value: 'CENTRALIZED' },
  { label: '分散供养', value: 'DISPERSED' },
] as const;