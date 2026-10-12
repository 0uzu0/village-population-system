/**
 * 导入任务类型文案（与后端 utils/specialImport.ts 的 task_type 保持一致）。
 *
 * 新增导入类型时只改这里一处，任务记录表与统计都不会漏。
 */
export const IMPORT_TASK_TYPE_LABELS: Record<string, string> = {
  PERSON: '人口档案',
  KEY_GROUP: '重点人群',
  DISABLED: '残疾台账',
  EXTREME_POVERTY: '特困台账',
  LOW_INCOME: '低保台账',
};

export function taskTypeLabel(type?: string | null): string {
  return IMPORT_TASK_TYPE_LABELS[type || ''] || type || '未知类型';
}

/** 标签配色：重点人群与专项台账用不同色系区分 */
export function taskTypeTag(type?: string | null): any {
  switch (type) {
    case 'PERSON': return 'info';
    case 'KEY_GROUP': return 'warning';
    case 'DISABLED': return 'success';
    case 'EXTREME_POVERTY': return 'danger';
    case 'LOW_INCOME': return 'warning';
    default: return 'info';
  }
}

/** 专项台账的 task_type 集合（前端筛选任务记录用） */
export const SPECIAL_TASK_TYPES = ['DISABLED', 'EXTREME_POVERTY', 'LOW_INCOME'] as const;