import { describe, it, expect } from 'vitest';
import { buildPersonTagFilter, buildFamilyTagFilter, buildAgeFilter, combineFilters } from '../src/utils/tagQuery';

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
