import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { formatDate, formatDateOrEmpty, today } from '../src/utils/date';
import { calcAge } from '../src/utils/age';

const SRC_DIR = path.resolve(__dirname, '../src');

/**
 * 日期口径回归。
 *
 * ## 背景
 * 1) 曾用`new Date(dateCol).toISOString().slice(0,10)` 格式化 DATE，
 *    而 mysql2 把 DATE 解析为本地零点时刻，转 UTC 会**退回前一天**。
 * 2) 首版修复改用 `formatDate()` 按本地时区取值，开发机（+08:00）通过，
 *    但 CI（UTC 时区）实测失败——说明「按本地时区取值」同样依赖环境。
 * 3) 根本解法：连接池加 `dateStrings: ['DATE']`，DATE 列直接返回字符串，
 *    完全不经过 Date 转换，与环境时区无关。
 *
 * 本测试刻意用「不预设运行环境时区」的断言方式。
 */

describe('DATE 列以字符串返回（时区歧义的根源已消除）', () => {
  it('连接池配置了 dateStrings: ["DATE"]', () => {
    const src = fs.readFileSync(path.join(SRC_DIR, 'config/db.ts'), 'utf8');
    expect(src, 'DATE 列必须以字符串返回，否则会因时区解释不同而差一天').toContain("dateStrings: ['DATE']");
  });

  it('只对 DATE 生效，不影响 DATETIME', () => {
    const src = fs.readFileSync(path.join(SRC_DIR, 'config/db.ts'), 'utf8');
    // dateStrings: true 会连created_at 等 DATETIME 也变字符串，影响范围过大
    expect(src).not.toMatch(/dateStrings:\s*true/);
  });
});

describe('formatDate', () => {
  it('DATE 字符串（主路径）原样规范返回', () => {
    expect(formatDate('1990-01-15')).toBe('1990-01-15');
    expect(formatDate('2026-02-28')).toBe('2026-02-28');
    expect(formatDate('2026-12-31')).toBe('2026-12-31');
  });

  it('字符串带时刻部分时只取日期', () => {
    expect(formatDate('1990-01-15 10:20:30')).toBe('1990-01-15');
    expect(formatDate('  1990-01-15T08:00:00.000Z  ')).toBe('1990-01-15');
  });

  it('月末、跨年不丢日期', () => {
    expect(formatDate('1990-01-31')).toBe('1990-01-31');
    expect(formatDate('2000-02-29')).toBe('2000-02-29');
    expect(formatDate('2026-01-01')).toBe('2026-01-01');
    expect(formatDate('2026-12-31')).toBe('2026-12-31');
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

  it('Date 对象按本地时区取值（DATETIME 场景：时刻按本地时区展示）', () => {
    // 这个断言与本机时区一致，因此不硬编码具体日期，只断言「与本地取值一致」
    const d = new Date(2026, 2, 5, 10, 0, 0); // 本地 2026-03-05 10:00
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    expect(formatDate(d)).toBe(`${y}-${m}-${day}`);
  });

  it('today 返回格式正确的今天', () => {
    expect(today()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(formatDate(new Date())).toBe(today());
  });

  /**
   * 静态断言：业务代码不得再用 toISOString().slice 取日期。
   * 该写法按 UTC 取年月日，遇到本地零点的时刻对象会退回前一天。
   */
  it('业务代码不得再用 toISOString().slice 取日期', () => {
    const files = ['modules/person.ts', 'modules/keygroup.ts', 'modules/excel.ts', 'modules/pending.ts', 'modules/family.ts'];
    for (const f of files) {
      const src = fs.readFileSync(path.join(SRC_DIR, f), 'utf8');
      expect(src.includes('toISOString().slice'), `${f} 又出现了 toISOString().slice，会导致日期少一天`).toBe(false);
    }
  });
});

describe('calcAge 不受运行环境时区影响', () => {
  const at = new Date(2026, 9, 12); // 本地 2026-10-12

  it('出生日期为 DATE 字符串时结果正确', () => {
    expect(calcAge('1990-01-15', at)).toBe(36);
    expect(calcAge('2026-10-12', at)).toBe(0);
    expect(calcAge('2026-10-13', at)).toBeNull(); // 尚未出生，非法值
  });

  it('生日未到当年不算周岁（边界）', () => {
    expect(calcAge('2018-10-13', at)).toBe(7); // 生日差一天未过
    expect(calcAge('2018-10-11', at)).toBe(8); // 已过生日
    expect(calcAge('2018-10-12', at)).toBe(8); // 今天正好生日
  });

  it('1月1日出生者跨年年龄正确', () => {
    expect(calcAge('1960-01-01', at)).toBe(66);
    expect(calcAge('1960-12-31', at)).toBe(65);
  });

  it('非法输入返回 null', () => {
    expect(calcAge(null)).toBeNull();
    expect(calcAge('')).toBeNull();
    expect(calcAge('不是日期')).toBeNull();
  });

  /**
   * 关键：字符串与 Date 两种输入必须给出一致结果。
   * 旧实现里字符串按 UTC 解析、Date 按本地取值，混用会错位。
   */
  it('字符串与 Date 输入结果一致', () => {
    const s = '1990-01-15';
    const d = new Date(Date.UTC(1990, 0, 15));
    expect(calcAge(s, at)).toBe(calcAge(d, at));
  });

  it('不合理年龄（负数/超150）返回 null', () => {
    expect(calcAge('2030-01-01', at)).toBeNull();
    expect(calcAge('1800-01-01', at)).toBeNull();
  });
});