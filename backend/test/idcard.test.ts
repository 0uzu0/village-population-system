import { describe, it, expect } from 'vitest';
import { validateIdCard, birthFromIdCard, genderFromIdCard } from '../src/utils/idcard';

describe('身份证校验', () => {
  it('校验合法的18位身份证', () => {
    // 校验位经 GB 11643 计算为合法
    const r = validateIdCard('11010519491231002X');
    expect(r.valid).toBe(true);
  });

  it('校验位错误应拒绝', () => {
    const r = validateIdCard('110105194912310021');
    expect(r.valid).toBe(false);
  });

  it('长度错误应拒绝', () => {
    expect(validateIdCard('123456789012').valid).toBe(false);
    expect(validateIdCard('12345678901234567890').valid).toBe(false);
  });

  it('15位旧版格式应通过并升位', () => {
    const r = validateIdCard('110105491231002');
    expect(r.valid).toBe(true);
    expect(r.normalized?.length).toBe(18);
  });

  it('含非法字符应拒绝', () => {
    expect(validateIdCard('11010519491231002A').valid).toBe(false);
  });

  it('从身份证提取出生日期', () => {
    expect(birthFromIdCard('11010519491231002X')).toBe('1949-12-31');
  });

  it('15 位旧版按 19 开头补全年份', () => {
    expect(birthFromIdCard('110105491231002')).toBe('1949-12-31');
  });

  it('月日不存在的号码返回 null（不把假日期写进档案）', () => {
    // 校验位合法 ≠ 日期真实存在
    expect(birthFromIdCard('11010519490230002X')).toBeNull(); // 2 月没有 30 日
    expect(birthFromIdCard('11010519491301002X')).toBeNull(); // 没有 13 月
    expect(birthFromIdCard('11010519491200002X')).toBeNull(); // 没有 0 日
    expect(birthFromIdCard('11010519491232002X')).toBeNull(); // 12 月只有 31 天
  });

  it('闰年 2 月 29 日有效，平年无效', () => {
    expect(birthFromIdCard('11010520000229002X')).toBe('2000-02-29');
    expect(birthFromIdCard('11010519000229002X')).toBeNull();
  });

  it('长度不对时返回 null', () => {
    expect(birthFromIdCard('1101051949123100')).toBeNull();
    expect(birthFromIdCard('')).toBeNull();
  });

  it('从身份证提取性别', () => {
    // 第17位 2 为偶数 → 女
    expect(genderFromIdCard('11010519491231002X')).toBe('FEMALE');
  });
});
