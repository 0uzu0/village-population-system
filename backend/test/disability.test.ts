import { describe, it, expect } from 'vitest';
import {
  DISABILITY_LEVELS,
  DISABILITY_TYPES,
  DISABILITY_LEVEL_LABELS,
  disabilityLevelLabel,
  buildDisabilityLevelFilter,
} from '../src/utils/disability';

describe('残疾等级口径（V008）', () => {
  it('等级枚举四级，且一级最重', () => {
    expect(DISABILITY_LEVELS).toEqual(['LEVEL_1', 'LEVEL_2', 'LEVEL_3', 'LEVEL_4']);
    expect(DISABILITY_LEVEL_LABELS.LEVEL_1).toContain('极重度');
    expect(DISABILITY_LEVEL_LABELS.LEVEL_4).toContain('轻度');
  });

  it('残疾类别覆盖国标六类 + 多重', () => {
    expect(DISABILITY_TYPES).toContain('视力');
    expect(DISABILITY_TYPES).toContain('多重');
    expect(DISABILITY_TYPES).toHaveLength(7);
  });

  it('等级标签可回显，未知值原样返回', () => {
    expect(disabilityLevelLabel('LEVEL_2')).toBe('二级（重度）');
    expect(disabilityLevelLabel(null)).toBe('');
    expect(disabilityLevelLabel('UNKNOWN')).toBe('UNKNOWN');
  });
});

describe('残疾等级区间筛选', () => {
  it('不传条件时不加任何过滤', () => {
    const f = buildDisabilityLevelFilter(null, undefined);
    expect(f.where).toBe('');
    expect(f.params).toEqual([]);
  });

  /**
   * 关键：等级数字越小越重，若按字符串比较会得到相反结果。
   * 「一级~二级」必须翻译成数字区间 1..2，而不是 LEVEL_1~LEVEL_2 的字典序。
   */
  it('区间条件转成数字 BETWEEN，而非字符串比较', () => {
    const f = buildDisabilityLevelFilter('LEVEL_1', 'LEVEL_2');
    expect(f.where).toContain('CAST(SUBSTRING(pd.disability_level, 7) AS UNSIGNED) BETWEEN ? AND ?');
    expect(f.params).toEqual([1, 2]);
  });

  it('只传等级下界 = 不轻于该等级（数字 <=）', () => {
    const f = buildDisabilityLevelFilter('LEVEL_2', undefined);
    expect(f.where).toContain('<= ?');
    expect(f.params).toEqual([2]);
  });

  it('只传等级上界 = 不重于该等级（数字 >=）', () => {
    const f = buildDisabilityLevelFilter(undefined, 'LEVEL_3');
    expect(f.where).toContain('>= ?');
    expect(f.params).toEqual([3]);
  });

  it('上下界传反时自动纠正顺序（界面允许任意方向选择）', () => {
    const f = buildDisabilityLevelFilter('LEVEL_3', 'LEVEL_1');
    expect(f.params).toEqual([1, 3]);
  });

  it('非法等级值被忽略，不会拼进 SQL', () => {
    const f = buildDisabilityLevelFilter('LEVEL_9' as any, 'X' as any);
    expect(f.where).toBe('');
    expect(f.params).toEqual([]);
  });
});