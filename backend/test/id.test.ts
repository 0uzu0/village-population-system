import { describe, it, expect } from 'vitest';
import { genPersonNo } from '../src/utils/id';

describe('人员编号生成', () => {
  it('格式以 P 开头且长度固定', () => {
    const no = genPersonNo(0);
    expect(no.startsWith('P')).toBe(true);
    // P + 时间戳段 + 4 位随机段 + 3 位序号段
    expect(no.length).toBe(1 + 8 + 4 + 3);
    expect(no).toMatch(/^P[0-9A-Z]+$/);
  });

  it('同一批次内绝不重复（旧实现在万行导入时会有约 3% 碰撞）', () => {
    const set = new Set<string>();
    for (let i = 0; i < 20000; i++) set.add(genPersonNo(i));
    expect(set.size).toBe(20000);
  });

  it('序号缺省为 0 时仍可生成', () => {
    expect(genPersonNo()).toMatch(/^P[0-9A-Z]+$/);
  });
});
