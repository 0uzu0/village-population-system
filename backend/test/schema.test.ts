import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import { nullableStr, queryEnum } from '../src/utils/schema';
import { villageContactSchema } from '../src/modules/grid';
import { recordSchema } from '../src/modules/ledger';

const SRC_DIR = path.resolve(__dirname, '../src');

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(p));
    else if (entry.name.endsWith('.ts')) out.push(p);
  }
  return out;
}

describe('可空字符串字段统一为 .nullable().optional()', () => {
  it('源码中不得再出现 .optional().or(z.literal(空串)) 联合写法', () => {
    // 该联合类型拒绝 null，而编辑弹窗回显的详情值可能是 null → 500 Invalid input（已踩过）
    const offenders: string[] = [];
    for (const file of walk(SRC_DIR)) {
      const src = fs.readFileSync(file, 'utf8');
      src.split('\n').forEach((line, i) => {
        if (/\.or\(z\.literal\(''\)\)/.test(line)) {
          offenders.push(`${path.relative(SRC_DIR, file)}:${i + 1}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });

  it('nullableStr 接受 undefined / null / 空串', () => {
    const s = nullableStr(20);
    expect(s.parse(undefined)).toBeUndefined();
    expect(s.parse(null)).toBeNull();
    expect(s.parse('')).toBe('');
    expect(s.parse('张三')).toBe('张三');
  });

  it('nullableStr 仍受 max 约束', () => {
    const s = nullableStr(3);
    expect(() => s.parse('abcd')).toThrow();
    // 但 null / undefined 不受长度约束影响
    expect(s.parse(null)).toBeNull();
  });

  it('queryEnum：缺省与空串都归一为默认值，非法值报错', () => {
    const e = queryEnum(['ANY', 'ALL'], 'ANY');
    expect(e.parse(undefined)).toBe('ANY');
    expect(e.parse(null)).toBe('ANY');
    expect(e.parse('')).toBe('ANY'); // 前端「未选择」会传空串
    expect(e.parse('ALL')).toBe('ALL');
    expect(() => e.parse('BAD')).toThrow();
  });
});

describe('代表性请求体 schema 接受 null（编辑回显场景）', () => {
  it('村庄联系人：null 不报 Invalid input', () => {
    const parsed = villageContactSchema.parse({ villageName: '艾园村', manager: null, phone: null });
    expect(parsed.manager).toBeNull();
    expect(parsed.phone).toBeNull();
  });

  it('台账记录：可空字段传 null 通过，必填字段仍校验', () => {
    const parsed = recordSchema.parse({
      category: 'WATER',
      workType: 'WEEDING',
      recordDate: '2026-01-15',
      title: '河道打草',
      location: null,
      detail: null,
      invoiceNo: null,
      responsible: null,
      remark: null,
    });
    expect(parsed.location).toBeNull();
    expect(parsed.laborCost).toBe(0); // 默认值仍生效

    expect(() =>
      recordSchema.parse({ category: '', workType: 'WEEDING', recordDate: '2026-01-15', title: 'x' })
    ).toThrow();
  });

  it('zod 行为确认：nullable().optional() 才接受 null（守住教训）', () => {
    const old = z.string().optional().or(z.literal(''));
    const next = z.string().nullable().optional();
    expect(old.safeParse(null).success).toBe(false); // 旧写法的病根
    expect(next.safeParse(null).success).toBe(true);
  });
});
