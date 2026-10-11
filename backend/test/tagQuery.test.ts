import { describe, it, expect } from 'vitest';
import { buildPersonTagFilter, buildFamilyTagFilter, buildAgeFilter, combineFilters } from '../src/utils/tagQuery';
import { ELDERLY_MIN_AGE, MINOR_MAX_AGE, ageRangeText } from '../src/utils/age';

describe('标签筛选 SQL 构建', () => {
  it('并集（ANY）生成 EXISTS IN 条件', () => {
    const f = buildPersonTagFilter({ tags: [1, 2, 3], mode: 'ANY' }, 'p');
    expect(f.where).toContain('pt.tag_id IN (?,?,?)');
    expect(f.params).toEqual([1, 2, 3]);
  });

  it('交集（ALL）为每个标签生成独立 EXISTS', () => {
    const f = buildPersonTagFilter({ tags: [1, 2], mode: 'ALL' }, 'p');
    expect(f.where.split('EXISTS').length).toBe(3); // 两个 EXISTS + 前缀
    expect(f.params).toEqual([1, 2]);
  });

  it('空标签返回空片段', () => {
    expect(buildPersonTagFilter({ tags: [], mode: 'ANY' }).where).toBe('');
    expect(buildPersonTagFilter(undefined).where).toBe('');
  });

  it('家庭标签筛选', () => {
    const f = buildFamilyTagFilter([19], 'p');
    expect(f.where).toContain('family_tag');
    expect(f.params).toEqual([19]);
  });

  it('年龄区间生成出生日期范围', () => {
    const f = buildAgeFilter(60, null, 'p');
    expect(f.where).toContain('birth_date');
  });

  it('组合多个筛选片段', () => {
    const f1 = buildPersonTagFilter({ tags: [1], mode: 'ANY' }, 'p');
    const f2 = buildAgeFilter(18, null, 'p');
    const combined = combineFilters([f1, f2]);
    expect(combined.params.length).toBe(2);
  });
});

describe('重点人群年龄类口径', () => {
  it('老年人：60 周岁及以上', () => {
    expect(ELDERLY_MIN_AGE).toBe(60);
    const f = buildAgeFilter(ELDERLY_MIN_AGE, null, 'p');
    // 下界：出生日期不晚于「今天减 60 年」，即已满 60 周岁
    expect(f.where).toContain('birth_date <= DATE_SUB(CURDATE(), INTERVAL ? YEAR)');
    expect(f.params).toEqual(['60']);
  });

  it('未成年人：18 周岁以下（最大 17 岁）', () => {
    expect(MINOR_MAX_AGE).toBe(17);
    const f = buildAgeFilter(null, MINOR_MAX_AGE, 'p');
    // 上界为闭区间 17，SQL 侧换算成「出生日期严格晚于今天减 18 年」，即不满 18 周岁。
    // 注意这里是 > 而非 >=：恰好今天满 18 周岁的人不算未成年人。
    expect(f.where).toContain('birth_date > DATE_SUB(CURDATE(), INTERVAL ? YEAR)');
    expect(f.params).toEqual(['18']);
  });

  it('上界排除「恰好满上界+1 周岁」的边界值', () => {
    // 与 ageRangeText(null, 17) => '<18 岁' 保持一致：18 岁生日当天即已成年
    const f = buildAgeFilter(null, MINOR_MAX_AGE, 'p');
    expect(f.where).not.toContain('birth_date >= DATE_SUB');
  });

  it('年龄区间人话表述', () => {
    expect(ageRangeText(60, null)).toBe('≥60 岁');
    expect(ageRangeText(null, 17)).toBe('<18 岁');
    expect(ageRangeText(18, 60)).toBe('18-60 岁');
    expect(ageRangeText(null, null)).toBe('不限');
  });
});
