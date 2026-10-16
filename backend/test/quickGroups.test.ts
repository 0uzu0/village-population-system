import { describe, it, expect } from 'vitest';
import { FOCUS_GROUPS, buildQuickGroups, allFocusTagCodes, isAgeGroup } from '../src/utils/focusGroups';

/**
 * 重点人群快捷入口（GET /key-groups/quick）的人数与筛选口径。
 *
 * 为什么必须测这个：族群人数和「点进去能看到的人」必须完全一致，而且**两边都不报错**。
 * 曾经出现的两个偏差都属于这种「静默错误」：
 *   1. 人数按族群 code 统计，「党员」漏掉预备党员，与工作台卡片 / 网格村庄表格对不上；
 *   2. 响应里没有 tagCodes，客户端只能拿 code 去匹配标签，同样是漏掉预备党员。
 * 结果是卡片写「党员 61 人」、点进去只有 43 人，而页面一切正常。
 */
describe('重点人群快捷入口', () => {
  /** 造一份贴近真实的数据：党员分正式/预备，其余单标签 */
  const counts = {
    tagCounts: {
      PARTY_MEMBER: 43,
      PARTY_PROBATIONARY: 4,
      VETERAN: 55,
      PREFERENTIAL_OBJECT: 21,
      LOW_INCOME_PERSON: 88,
      EXTREME_POVERTY_PERSON: 12,
      DISABLED_PERSON: 47,
    } as Record<string, number>,
    tagColors: { PARTY_MEMBER: '#E5484D', VETERAN: '#5B5BD6' } as Record<string, string>,
    ageCounts: { ELDERLY: 702, MINOR: 118 } as Record<string, number>,
  };

  const groups = buildQuickGroups(counts);
  const byCode = (code: string) => groups.find((g) => g.code === code)!;

  it('覆盖 focusGroups 里的全部族群，顺序一致', () => {
    expect(groups.map((g) => g.code)).toEqual(FOCUS_GROUPS.map((g) => g.code));
  });

  it('身份类人数按 tagCodes 求和（党员 = 正式 + 预备）', () => {
    // 这是本次修复的核心：以前只算 PARTY_MEMBER，得 43
    expect(byCode('PARTY_MEMBER').count).toBe(47);
    expect(byCode('VETERAN').count).toBe(55);
    expect(byCode('DISABLED_PERSON').count).toBe(47);
  });

  it('每个族群都带出 tagCodes，客户端据此才能筛对', () => {
    expect(byCode('PARTY_MEMBER').tagCodes).toEqual(['PARTY_MEMBER', 'PARTY_PROBATIONARY']);
    expect(byCode('LOW_INCOME_PERSON').tagCodes).toEqual(['LOW_INCOME_PERSON']);
    // 年龄类没有标签，只有年龄区间
    expect(byCode('ELDERLY').tagCodes).toEqual([]);
    expect(byCode('ELDERLY').byAge).toBe(true);
  });

  it('族群 code 一定在自己的 tagCodes 里（老客户端用 code 匹配时的兜底前提）', () => {
    for (const g of groups.filter((x) => !x.byAge)) {
      expect(g.tagCodes, `${g.code} 应包含自身编码`).toContain(g.code);
    }
  });

  it('年龄类人数取自年龄统计，与标签无关', () => {
    expect(byCode('ELDERLY').count).toBe(702);
    expect(byCode('MINOR').count).toBe(118);
    expect(byCode('ELDERLY').minAge).toBe(60);
    // maxAge 是闭区间，「未成年人」给的是 17（即 <18 岁）
    expect(byCode('MINOR').maxAge).toBe(17);
    expect(byCode('ELDERLY').maxAge).toBeNull();
  });

  it('标签不存在时人数为 0、颜色回退，不抛异常', () => {
    const empty = buildQuickGroups({ tagCounts: {}, tagColors: {} });
    const party = empty.find((g) => g.code === 'PARTY_MEMBER')!;
    expect(party.count).toBe(0);
    expect(party.color).toBe('#3978F6');
  });

  it('年龄类人数与标签名冲突时以年龄为准', () => {
    // 有人给「老年人」也打了同名标签，也不能把它算进年龄类
    const g = buildQuickGroups({
      tagCounts: { ELDERLY: 999 },
      tagColors: {},
      ageCounts: { ELDERLY: 702 },
    }).find((x) => x.code === 'ELDERLY')!;
    expect(g.count).toBe(702);
  });

  it('allFocusTagCodes 覆盖全部身份类标签且去重', () => {
    const codes = allFocusTagCodes();
    expect(codes).toContain('PARTY_PROBATIONARY');
    expect(codes).toContain('DISABLED_PERSON');
    expect(new Set(codes).size).toBe(codes.length);
    // 年龄类不产生标签编码
    expect(codes).not.toContain('ELDERLY');
    expect(codes).not.toContain('MINOR');
  });

  it('年龄类判定只看 minAge/maxAge', () => {
    expect(isAgeGroup({ code: 'ELDERLY', label: '老年人', tagCodes: [], minAge: 60 })).toBe(true);
    expect(isAgeGroup({ code: 'VETERAN', label: '退役军人', tagCodes: ['VETERAN'] })).toBe(false);
  });
});
