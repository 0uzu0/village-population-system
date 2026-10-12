/**
 * 人员状态口径（V007 起：新增「死亡」，取消「注销」）。
 *
 * 在册 = NORMAL / MOVED_IN：当前实际人口，计入人口统计与网格/村庄人数。
 * 非在册 = MOVED_OUT / DEAD：档案保留、可追溯，但不计入任何人口统计。
 *
 * 死亡、迁出一律走状态变更，不做物理删除——删除会连带清掉标签与变更记录，
 * 低保停发、殡葬补贴、户籍核对都需要留痕。删除只用于清理导入产生的重复/错误数据。
 */
export const PERSON_STATUSES = ['NORMAL', 'MOVED_IN', 'MOVED_OUT', 'DEAD'] as const;
export type PersonStatus = (typeof PERSON_STATUSES)[number];

/** 在册状态：这两类才计入人口统计 */
export const ACTIVE_STATUSES = ['NORMAL', 'MOVED_IN'] as const;

/**
 * 在册过滤 SQL 片段（列表别名为 p）。
 * 统计模块用 p_ 等其他别名时不要直接复用这个常量，避免别名错配。
 */
export const PERSON_ACTIVE_SQL = "p.status IN ('NORMAL','MOVED_IN')";

export const STATUS_LABELS: Record<string, string> = {
  NORMAL: '正常',
  MOVED_IN: '迁入',
  MOVED_OUT: '迁出',
  DEAD: '死亡',
};

export function isActiveStatus(status: string): boolean {
  return (ACTIVE_STATUSES as readonly string[]).includes(status);
}

/** 转为非在册时需要解除该人员的家庭成员关联（家庭本身保留） */
export function isInactiveStatus(status: string): boolean {
  return !isActiveStatus(status);
}
