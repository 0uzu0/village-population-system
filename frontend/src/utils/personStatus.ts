/**
 * 人员状态口径（与后端 utils/personStatus.ts 保持一致）。
 *
 * 在册 = NORMAL / MOVED_IN：计入人口统计与服务名单。
 * 非在册 = MOVED_OUT / DEAD：档案保留、可追溯，不计入统计。
 *
 * 死亡、迁出一律走状态变更，不删除档案；删除只用于清理导入产生的重复/错误数据。
 */
export const PERSON_STATUSES = ['NORMAL', 'MOVED_IN', 'MOVED_OUT', 'DEAD'] as const;
export type PersonStatus = (typeof PERSON_STATUSES)[number];

export const ACTIVE_STATUSES = ['NORMAL', 'MOVED_IN'] as const;

export const STATUS_LABELS: Record<string, string> = {
  NORMAL: '正常',
  MOVED_IN: '迁入',
  MOVED_OUT: '迁出',
  DEAD: '死亡',
};

/** Element Plus el-tag 的 type 取值（写死联合类型，避免退回宽泛的 string） */
export type TagType = 'primary' | 'success' | 'warning' | 'info' | 'danger';

/** Element Plus tag 类型：正常=绿、迁入=蓝、迁出=橙、死亡=红 */
export const STATUS_TAG_TYPES: Record<string, TagType> = {
  NORMAL: 'success',
  MOVED_IN: 'primary',
  MOVED_OUT: 'warning',
  DEAD: 'danger',
};

export function statusLabel(s?: string): string {
  return STATUS_LABELS[s || ''] || s || '—';
}

export function statusTagType(s?: string): TagType {
  return STATUS_TAG_TYPES[s || ''] || 'info';
}

export function isActiveStatus(s?: string): boolean {
  return (ACTIVE_STATUSES as readonly string[]).includes(s || '');
}

/** 状态变更下拉选项（含「全部」用于筛选） */
export const STATUS_OPTIONS = PERSON_STATUSES.map((v) => ({ label: STATUS_LABELS[v], value: v }));
