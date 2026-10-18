/**
 * 标签筛选 SQL 构建工具（个人标签交集/并集、年龄区间）
 * 独立纯函数，便于单元测试
 * 注：家庭标签筛选已随家庭标签功能下线（V026）移除
 */

import { notSupersededByTagIdSql } from './tagExclusive';

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
 *
 * 每条 EXISTS 里都带「未被同组更高优先级标签压制」的判定（见 utils/tagExclusive.ts）。
 * 这样列表 / 导出 / 重点人群三条路径自动与工作台、标签人数用同一条口径：
 * 写「流动人口」筛出的人，恰好就是工作台算进流动人口的那批人。
 *
 * 为什么不用「先查标签编码再加守卫」的老做法：那需要调用方多做一次查询，
 * 而且每加一组互斥就要改一次调用方。现在的判定全部来自
 * tag_definition.exclusive_group / exclusive_priority，纯函数签名不变。
 *
 * 顺带修正了一个语义问题：同时勾选互斥的两个标签时，
 * AND 语义（ALL）现在会返回空集（一个人不可能同时有效持有两枚），
 * OR 语义（ANY）返回并集——都符合「互斥」的定义。
 */
export function buildPersonTagFilter(filter: TagFilter | undefined, prefix = 'p'): BuiltFilter {
  if (!filter || !filter.tags.length) return { where: '', params: [] };
  if (filter.mode === 'ALL') {
    const parts: string[] = [];
    const params: number[] = [];
    for (const tagId of filter.tags) {
      parts.push(
        `EXISTS (SELECT 1 FROM person_tag pt
                  WHERE pt.person_id = ${prefix}.id AND pt.tag_id = ? AND pt.status = 'ACTIVE'
                    AND ${notSupersededByTagIdSql('pt.tag_id', `${prefix}.id`)})`
      );
      params.push(tagId);
    }
    return { where: ` AND (${parts.join(' AND ')})`, params };
  }
  const placeholders = filter.tags.map(() => '?').join(',');
  return {
    where: ` AND EXISTS (SELECT 1 FROM person_tag pt
                WHERE pt.person_id = ${prefix}.id AND pt.status = 'ACTIVE' AND pt.tag_id IN (${placeholders})
                  AND ${notSupersededByTagIdSql('pt.tag_id', `${prefix}.id`)})`,
    params: [...filter.tags],
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
