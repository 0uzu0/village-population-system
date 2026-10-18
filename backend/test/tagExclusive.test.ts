import { describe, it, expect } from 'vitest';
import {
  pickExclusiveWinners,
  notSupersededByTagIdSql,
  notSupersededByCodeSql,
  tagPersonCountExclusiveGuard,
  type TagExclusiveInfo,
} from '../src/utils/tagExclusive';

/**
 * 标签互斥组的裁决规则。
 *
 * 这组用例锁的是「规则来自数据」这件事本身：
 * 代码里不再出现 HUKOU_POP / FLOATING_POP，改由
 * tag_definition.exclusive_group / exclusive_priority 决定谁留下。
 * 以后在标签管理里配第三组互斥，不需要改代码，也不该改这些用例。
 */

function info(id: number, group: string | null, priority = 100): TagExclusiveInfo {
  return { id, code: `TAG_${id}`, group, priority };
}

describe('写入侧：同组只保留优先级最高的一枚', () => {
  const dict = new Map<number, TagExclusiveInfo>([
    [1, info(1, 'HUKOU_FLOATING', 10)], // 户籍（优先）
    [2, info(2, 'HUKOU_FLOATING', 20)], // 流动
    [3, info(3, null)], // 党员，不互斥
    [4, info(4, 'HOUSEHOLD', 10)], // 另一组：低保户
    [5, info(5, 'HOUSEHOLD', 20)], // 另一组：特困
  ]);

  it('同组两枚 → 只留优先级小的那枚', () => {
    expect(pickExclusiveWinners([1, 2], dict)).toEqual([1]);
    expect(pickExclusiveWinners([2, 1], dict)).toEqual([1]);
  });

  it('不互斥的标签原样保留', () => {
    expect(pickExclusiveWinners([3], dict)).toEqual([3]);
    expect(pickExclusiveWinners([3, 1, 2], dict)).toEqual([3, 1]);
  });

  it('不同互斥组互不影响', () => {
    expect(pickExclusiveWinners([1, 4], dict)).toEqual([1, 4]);
    expect(pickExclusiveWinners([1, 2, 4, 5], dict)).toEqual([1, 4]);
  });

  it('优先级并列时保留先出现的（用户先点的那侧）', () => {
    const tie = new Map<number, TagExclusiveInfo>([
      [1, info(1, 'G', 10)],
      [2, info(2, 'G', 10)],
    ]);
    expect(pickExclusiveWinners([2, 1], tie)).toEqual([2]);
  });

  it('字典里没有的 id 原样保留，交给后续 SQL 报错', () => {
    expect(pickExclusiveWinners([99], dict)).toEqual([99]);
  });

  it('空输入返回空数组', () => {
    expect(pickExclusiveWinners([], dict)).toEqual([]);
  });
});

describe('读数侧：SQL 片段按数据裁决', () => {
  it('按标签 id 判定时不出现硬编码编码', () => {
    const sql = notSupersededByTagIdSql('pt.tag_id', 'p.id');
    expect(sql).toContain('td_self.id = pt.tag_id');
    expect(sql).toContain('td_g.exclusive_group = td_self.exclusive_group');
    expect(sql).toContain('td_g.exclusive_priority < td_self.exclusive_priority');
    expect(sql).not.toContain('HUKOU_POP');
    expect(sql).not.toContain('FLOATING_POP');
  });

  it('按编码判定时只接受代码常量形式的编码', () => {
    expect(notSupersededByCodeSql('FLOATING_POP', 'p.id')).toContain("td_self.code = 'FLOATING_POP'");
    // 注入尝试必须直接抛错，而不是拼进 SQL
    expect(() => notSupersededByCodeSql("X' OR 1=1 --", 'p.id')).toThrow();
    expect(() => notSupersededByCodeSql('lower_case', 'p.id')).toThrow();
  });

  it('标签人数守卫取当前行的 code 列，新增互斥组自动生效', () => {
    const sql = tagPersonCountExclusiveGuard('td.code', 'pt.person_id');
    expect(sql).toContain('td_self.code = td.code');
    expect(sql).toContain('td_g.exclusive_priority < td_self.exclusive_priority');
  });

  it('片段里没有占位符——参数数量不会被互斥判定改变', () => {
    for (const sql of [
      notSupersededByTagIdSql('pt.tag_id', 'p.id'),
      notSupersededByCodeSql('FLOATING_POP', 'p.id'),
      tagPersonCountExclusiveGuard('td.code', 'pt.person_id'),
    ]) {
      expect(sql).not.toContain('?');
    }
  });
});
