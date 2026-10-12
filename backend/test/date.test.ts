import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { formatDate, formatDateOrEmpty, today } from '../src/utils/date';

const SRC_DIR = path.resolve(__dirname, '../src');

describe('日期格式化（时区回归）', () => {
  /**
   * 连接池配置了 timezone:'+08:00'，mysql2 把 DATE 列解析成本地零点时刻。
   * 1990-01-15 00:00:00+08:00 的 UTC 时刻是 1990-01-14 16:00Z——
   * 用 toISOString().slice(0,10) 会得到 1990-01-14，**凭空少一天**。
   */
  it('Date 对象按本地时区取值，不做 UTC 偏移', () => {
    const d = new Date('1990-01-15T00:00:00+08:00');
    expect(formatDate(d)).toBe('1990-01-15');
  });

  it('月末、年末不跨错', () => {
    expect(formatDate(new Date('1990-01-31T00:00:00+08:00'))).toBe('1990-01-31');
    expect(formatDate(new Date('2026-12-31T00:00:00+08:00'))).toBe('2026-12-31');
    expect(formatDate(new Date('2026-01-01T00:00:00+08:00'))).toBe('2026-01-01');
  });

  it('午夜时刻不会退回前一天', () => {
    // 这是旧写法最典型的出错场景
    const midnight = new Date('2026-03-05T00:00:00+08:00');
    const old = new Date(midnight).toISOString().slice(0, 10);
    expect(old).not.toBe('2026-03-05'); // 旧写法确实会错
    expect(formatDate(midnight)).toBe('2026-03-05');
  });

  it('字符串输入（驱动返回文本时）取日期部分', () => {
    expect(formatDate('1990-01-15')).toBe('1990-01-15');
    expect(formatDate('1990-01-15 10:20:30')).toBe('1990-01-15');
    expect(formatDate('  1990-01-15T00:00:00.000Z  ')).toBe('1990-01-15');
  });

  it('空值与非法值返回 null，不产生假日期', () => {
    expect(formatDate(null)).toBeNull();
    expect(formatDate(undefined)).toBeNull();
    expect(formatDate('')).toBeNull();
    expect(formatDate('不是日期')).toBeNull();
    expect(formatDate(new Date('invalid'))).toBeNull();
  });

  it('formatDateOrEmpty 空值返回空字符串（导出单元格用）', () => {
    expect(formatDateOrEmpty(null)).toBe('');
    expect(formatDateOrEmpty('1990-01-15')).toBe('1990-01-15');
  });

  it('today 返回本地时区的今天', () => {
    const t = today();
    expect(t).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(formatDate(new Date())).toBe(t);
  });

  /**
   * 静态断言：业务代码里不得再出现 toISOString().slice(0, 10)。
   * 只要有人图省事直接用，会让所有 DATE 字段显示少一天，
   * 且 pending.ts 会把错误日期写回 birth_date 污染出生日期。
   */
  it('业务代码不得再用 toISOString().slice 取日期', () => {
    const files = ['modules/person.ts', 'modules/keygroup.ts', 'modules/excel.ts', 'modules/pending.ts'];
    for (const f of files) {
      const src = fs.readFileSync(path.join(SRC_DIR, f), 'utf8');
      expect(
        src.includes('toISOString().slice'),
        `${f} 又出现了 toISOString().slice，会导致日期少一天`
      ).toBe(false);
    }
  });
});