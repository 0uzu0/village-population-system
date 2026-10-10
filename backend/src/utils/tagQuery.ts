/**
 * 标签筛选 SQL 构建工具（个人标签交集/并集、家庭标签）
 * 独立纯函数，便于单元测试
 */

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
 * 个人标签筛选
 * - ALL：要求人员同时具备所有标签（EXISTS 逐条）
 * - ANY：人员具备任一标签
 */
export function buildPersonTagFilter(filter: TagFilter | undefined, prefix = 'p'): BuiltFilter {
  if (!filter || !filter.tags.length) return { where: '', params: [] };
  if (filter.mode === 'ALL') {
    const parts: string[] = [];
    const params: number[] = [];
    for (const tagId of filter.tags) {
      parts.push(
        `EXISTS (SELECT 1 FROM person_tag pt WHERE pt.person_id = ${prefix}.id AND pt.tag_id = ? AND pt.status = 'ACTIVE')`
      );
      params.push(tagId);
    }
    return { where: ` AND (${parts.join(' AND ')})`, params };
  }
  const placeholders = filter.tags.map(() => '?').join(',');
  return {
    where: ` AND EXISTS (SELECT 1 FROM person_tag pt WHERE pt.person_id = ${prefix}.id AND pt.status = 'ACTIVE' AND pt.tag_id IN (${placeholders}))`,
    params: [...filter.tags],
  };
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
    where.push(`${prefix}.birth_date >= DATE_SUB(CURDATE(), INTERVAL ? YEAR)`);
    params.push(String(maxAge + 1));
  }
  if (!where.length) return { where: '', params: [] };
  return { where: ` AND (${where.join(' AND ')})`, params: params as unknown as number[] };
}
