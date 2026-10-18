/**
 * 标签筛选 SQL 构建工具（个人标签交集/并集、家庭标签）
 * 独立纯函数，便于单元测试
 */

import { FLOATING_POP_CODE, HUKOU_POP_CODE, hukouPersonExistsSql } from './hukouFloating';

export interface TagFilter {
  /** 标签 ID 列表 */
  tags: number[];
  /** ANY=并集（命中任一），ALL=交集（命中全部） */
  mode: 'ANY' | 'ALL';
}

export interface BuiltFilter {
  where: string;
  params: number[];
}

/**
 * 户籍优先守卫（追加在标签筛选之后）。
 *
 * 语义：只有「所选标签里含流动人口、且不含户籍人口」时才排除已持户籍标签的人；
 * 其余情况原样放行。判定全部在 SQL 里完成（用子查询查 tag_definition），
 * 不需要调用方先查一次标签编码——这样纯函数签名不变，
 * 列表 / 导出 / 重点人群三条路径自动用上同一条口径。
 *
 * 为什么需要：写入侧互斥只管新数据，历史数据与批量导入可能让一人同时挂着
 * 两类标签。「工作台流动人口」已经按户籍优先排除，如果筛选不排除，
 * 就会出现「标签页说 280 人、点进去列出 285 人」。
 */
function hukouFloatingExclusiveGuard(tagIds: number[], prefix: string): BuiltFilter {
  const ph = tagIds.map(() => '?').join(',');
  return {
    where: ` AND (
      EXISTS (SELECT 1 FROM tag_definition td_sel_h WHERE td_sel_h.id IN (${ph}) AND td_sel_h.code = '${HUKOU_POP_CODE}')
      OR NOT EXISTS (SELECT 1 FROM tag_definition td_sel_f WHERE td_sel_f.id IN (${ph}) AND td_sel_f.code = '${FLOATING_POP_CODE}')
      OR NOT ${hukouPersonExistsSql(`${prefix}.id`)}
    )`,
    params: [...tagIds, ...tagIds],
  };
}

/**
 * 个人标签筛选
 * - ALL：要求人员同时具备所有标签（EXISTS 逐条）
 * - ANY：人员具备任一标签
 *
 * 末尾统一追加户籍优先守卫（见 hukouFloatingExclusiveGuard）。
 */
export function buildPersonTagFilter(filter: TagFilter | undefined, prefix = 'p'): BuiltFilter {
  if (!filter || !filter.tags.length) return { where: '', params: [] };
  let base: BuiltFilter;
  if (filter.mode === 'ALL') {
    const parts: string[] = [];
    const params: number[] = [];
    for (const tagId of filter.tags) {
      parts.push(
        `EXISTS (SELECT 1 FROM person_tag pt WHERE pt.person_id = ${prefix}.id AND pt.tag_id = ? AND pt.status = 'ACTIVE')`
      );
      params.push(tagId);
    }
    base = { where: ` AND (${parts.join(' AND ')})`, params };
  } else {
    const placeholders = filter.tags.map(() => '?').join(',');
    base = {
      where: ` AND EXISTS (SELECT 1 FROM person_tag pt WHERE pt.person_id = ${prefix}.id AND pt.status = 'ACTIVE' AND pt.tag_id IN (${placeholders}))`,
      params: [...filter.tags],
    };
  }
  const guard = hukouFloatingExclusiveGuard(filter.tags, prefix);
  return { where: base.where + guard.where, params: [...base.params, ...guard.params] };
}

/**
 * 家庭标签筛选：命中具备某家庭级标签的家庭内全部成员
 */
export function buildFamilyTagFilter(tagIds: number[], prefix = 'p'): BuiltFilter {
  if (!tagIds || !tagIds.length) return { where: '', params: [] };
  const placeholders = tagIds.map(() => '?').join(',');
  return {
    where: ` AND ${prefix}.family_id IN (
      SELECT ft.family_id FROM family_tag ft
      WHERE ft.tag_id IN (${placeholders}) AND ft.status = 'ACTIVE'
    )`,
    params: [...tagIds],
  };
}

/**
 * 组合多个筛选片段，拼接为完整 WHERE（以 AND 连接，忽略空片段）
 */
export function combineFilters(filters: BuiltFilter[]): BuiltFilter {
  const where = filters.map((f) => f.where).filter(Boolean).join('');
  const params = filters.flatMap((f) => f.params);
  return { where, params };
}

/**
 * 年龄区间筛选（基于 birth_date 计算，走索引友好的范围条件）
 * 输入 [minAge, maxAge]，返回出生日期区间条件
 */
export function buildAgeFilter(minAge?: number | null, maxAge?: number | null, prefix = 'p'): BuiltFilter {
  const where: string[] = [];
  const params: string[] = [];
  if (minAge != null) {
    where.push(`${prefix}.birth_date <= DATE_SUB(CURDATE(), INTERVAL ? YEAR)`);
    params.push(String(minAge));
  }
  if (maxAge != null) {
    // 必须用严格大于：「出生日期 = 今天减 (maxAge+1) 年」的人恰好满 maxAge+1 周岁，
    // 已超出闭区间上界，应排除。用 >= 会把刚满 18 岁的人算进「未成年人」。
    where.push(`${prefix}.birth_date > DATE_SUB(CURDATE(), INTERVAL ? YEAR)`);
    params.push(String(maxAge + 1));
  }
  if (!where.length) return { where: '', params: [] };
  return { where: ` AND (${where.join(' AND ')})`, params: params as unknown as number[] };
}
