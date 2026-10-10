import { describe, it, expect } from 'vitest';
import { calcAge, ageBand, AGE_BANDS } from '../src/utils/age';

describe('年龄计算与分段', () => {
  it('计算周岁', () => {
    expect(calcAge('1960-05-12', new Date('2026-10-10'))).toBe(66);
    expect(calcAge('1990-01-15', new Date('2026-10-10'))).toBe(36);
  });

  it('生日未到则减一岁', () => {
    expect(calcAge('2018-12-31', new Date('2026-10-10'))).toBe(7);
  });

  it('年龄段划分', () => {
    expect(ageBand(16)).toBe('0-17岁');
    expect(ageBand(30)).toBe('18-35岁');
    expect(ageBand(50)).toBe('36-59岁');
    expect(ageBand(65)).toBe('60-79岁');
    expect(ageBand(85)).toBe('80岁及以上');
  });

  it('年龄段连续无断档', () => {
    for (let i = 1; i < AGE_BANDS.length; i++) {
      expect(AGE_BANDS[i].min).toBe(AGE_BANDS[i - 1].max + 1);
    }
  });
});
