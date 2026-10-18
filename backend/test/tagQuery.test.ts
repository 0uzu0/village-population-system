import { describe, it, expect } from 'vitest';
import { buildPersonTagFilter, buildFamilyTagFilter, buildAgeFilter, combineFilters } from '../src/utils/tagQuery';
import { ELDERLY_MIN_AGE, MINOR_MAX_AGE, ageRangeText } from '../src/utils/age';

/** 占位符数量必须与参数数量严格一致，否则 SQL 参数会错位（查错人/报错） */
function holes(f: { where: string }): number {
  return (f.where.match(/\?/g) || []).length;
}

describe('标签筛选 SQL 构建', () => {
  it('并集（ANY）生成 EXISTS IN 条件', () => {
    const f = buildPersonTagFilter({ tags: [1, 2, 3], mode: 'ANY' }, 'p');
    expect(f.where).toContain('pt.tag_id IN (?,?,?)');
    // 参数就是标签 ID 本身；互斥判定写在 SQL 里（见下方专项用例）
    expect(f.params.slice(0, 3)).toEqual([1, 2, 3]);
  });

  it('交集（ALL）为每个标签生成独立 EXISTS', () => {
    const f = buildPersonTagFilter({ tags: [1, 2], mode: 'ALL' }, 'p');
    // 逐条 tag_id = ? 判定（不是 IN），两个标签就是两条
    expect(f.where.match(/pt\.tag_id = \?/g)?.length).toBe(2);
    expect(f.params.slice(0, 2)).toEqual([1, 2]);
  });

  it('空标签返回空片段', () => {
    expect(buildPersonTagFilter({ tags: [], mode: 'ANY' }).where).toBe('');
    expect(buildPersonTagFilter(undefined).where).toBe('');
  });

  it('互斥判定来自标签字典，不写死具体编码', () => {
    const f = buildPersonTagFilter({ tags: [14], mode: 'ANY' }, 'p');
    // v2.2 起不再在 SQL 里出现 HUKOU_POP / FLOATING_POP 字面量，
    // 而是关联 tag_definition 的互斥组与优先级来裁决；
    // 新增一组互斥只要改数据，这里不用动代码
    expect(f.where).toContain('td_g.exclusive_group');
    expect(f.where).toContain('td_g.exclusive_priority < td_self.exclusive_priority');
    expect(f.where).not.toContain('FLOATING_POP');
    expect(f.where).not.toContain('HUKOU_POP');
  });

  it('任何标签组合下占位符与参数都对齐', () => {
    const cases: Array<{ tags: number[]; mode: 'ANY' | 'ALL' }> = [
      { tags: [1], mode: 'ANY' },
      { tags: [1, 2, 3], mode: 'ANY' },
      { tags: [1, 2], mode: 'ALL' },
      { tags: [14], mode: 'ANY' },
      { tags: [14, 15], mode: 'ANY' },
      { tags: [14, 3, 9], mode: 'ALL' },
    ];
    for (const c of cases) {
      const f = buildPersonTagFilter(c, 'p');
      expect(holes(f), `${c.mode} ${c.tags.join(',')} 占位符与参数不一致`).toBe(f.params.length);
    }
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
    // 参数按片段顺序拼接，长度必须是各片段之和（拼错会整体错位）
    expect(combined.params.length).toBe(f1.params.length + f2.params.length);
    expect(holes(combined)).toBe(combined.params.length);
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
