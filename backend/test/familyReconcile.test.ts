/**
 * 两表对账的守卫。
 *
 * 对账这件事最容易出的错不是 SQL 写错，而是**接口报的那批人**和**迁移修的那批人**
 * 不是同一批——判定条件写了两份，谁先改谁就悄悄脱钩。那时运维看到的数字与
 * 实际被修的行对不上，比不对账更糟。所以这里逐条比对两处条件。
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { __diffSpecs } from '../src/services/familyReconcile';
import { ALL_TOOLS } from '../src/modules/mcp/registry';

const ROOT = path.resolve(__dirname, '..');
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');

/** 去掉反引号与多余空白后比较，避免“只是格式不同”造成假红 */
function norm(sql: string): string {
  return sql.replace(/`/g, '').replace(/\s+/g, ' ').trim();
}

describe('对账项的声明', () => {
  it('七个分类，key 不重复', () => {
    const keys = __diffSpecs.map((d) => d.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toEqual([
      'relation_diff',
      'member_without_family',
      'family_without_member',
      'family_conflict',
      'multi_family',
      'head_anomaly',
      'status_drift',
    ]);
  });

  it('每一类都要说清“为什么是问题”，否则运维只看到数字不知道要不要管', () => {
    for (const d of __diffSpecs) {
      expect(d.title.length, d.key).toBeGreaterThan(2);
      expect(d.why.length, d.key).toBeGreaterThan(15);
    }
  });

  it('只有确定无歧义的两类允许自动修', () => {
    expect(__diffSpecs.filter((d) => d.autoFixable).map((d) => d.key)).toEqual([
      'relation_diff',
      'member_without_family',
    ]);
  });

  it('判定 SQL 不带 ORDER BY / LIMIT —— 带了计数就会被截断成“最多 20 条”', () => {
    for (const d of __diffSpecs) {
      expect(d.sql, d.key).not.toMatch(/\bORDER\s+BY\b/i);
      expect(d.sql, d.key).not.toMatch(/\bLIMIT\b/i);
    }
  });

  it('每一类都真的查了两张表', () => {
    for (const d of __diffSpecs) {
      const s = norm(d.sql);
      expect(s, d.key).toMatch(/family_member/);
      expect(s, d.key).toMatch(/\bperson\b|\bfamily\b/);
    }
  });
});

describe('接口判定 与 迁移修复 必须同一口径', () => {
  const migration = norm(read('src/db/migrations/V029__family_reconcile.sql'));

  it('关系不一致：迁移与接口用同一个 NULL 安全比较', () => {
    const spec = __diffSpecs.find((d) => d.key === 'relation_diff')!;
    const byService = norm(spec.sql);
    // <=> 必须两边都在：换成普通 <> 会把“人员表为 NULL”的那半漏在修复之外
    expect(byService).toContain('NOT (p.relation <=> fm.relation)');
    expect(migration).toContain('NOT (p.relation <=> fm.relation)');
    // 且都要求“两表指向同一户”，否则会把 family_conflict 的人也一起改了
    expect(byService).toContain('p.family_id = fm.family_id');
    expect(migration).toContain('p.family_id = fm.family_id');
  });

  it('补归属：迁移只处理“只在一户在户”的人，是接口报告集合的子集', () => {
    const spec = __diffSpecs.find((d) => d.key === 'member_without_family')!;
    const byService = norm(spec.sql);
    expect(byService).toContain('p.family_id IS NULL');
    expect(migration).toContain('p.family_id IS NULL');
    // 一人在多户时迁移必须跳过，否则等于替人挑一户
    expect(migration).toContain('x.n = 1');
    // 计数列必须真的按人分组，否则 x.n 恒为该户成员的条数
    expect(migration).toContain('GROUP BY fm.person_id');
  });

  it('迁移是纯 DML 且两条 UPDATE 都带条件（可重跑）', () => {
    const raw = read('src/db/migrations/V029__family_reconcile.sql');
    expect(raw).not.toMatch(/\b(ALTER|CREATE|DROP)\s+(TABLE|INDEX|VIEW)\b/i);
    const updates = raw.match(/UPDATE[\s\S]*?;/g) || [];
    expect(updates).toHaveLength(2);
    for (const u of updates) expect(u).toMatch(/\bWHERE\b/);
  });

  it('每个会被自动修的分类，都在迁移里有对应语句', () => {
    // 反向：迁移里只要出现 UPDATE，就必须能对应到一个 autoFixable 的分类，
    // 防止有人往迁移里塞“顺手改一下别的东西”——那种改动没有对账口径兜着。
    const fixable = __diffSpecs.filter((d) => d.autoFixable).length;
    // 只数行首的语句，避免把注释里提到的 UPDATE 算进去
    const updates = (read('src/db/migrations/V029__family_reconcile.sql').match(/^UPDATE\b/gm) || []).length;
    expect(updates).toBe(fixable);
  });
});

describe('路由顺序：/reconcile 必须在 /:id 之前', () => {
  it('否则会被当成 id=reconcile 的详情请求，永远 404', () => {
    const src = read('src/modules/family.ts');
    const reconcile = src.indexOf("router.get('/reconcile'");
    const detail = src.indexOf("router.get('/:id'");
    expect(reconcile).toBeGreaterThan(-1);
    expect(detail).toBeGreaterThan(-1);
    expect(reconcile).toBeLessThan(detail);
  });

  it('对账是只读接口，不给写权限', () => {
    const src = read('src/modules/family.ts');
    const start = src.indexOf("router.get('/reconcile'");
    // 只取这一个 handler：到下一个路由声明为止（后面紧跟着 auto-group，是写接口）
    const block = src.slice(start, src.indexOf('router.', start + 1));
    expect(block).toMatch(/requirePermission\('family:view'\)/);
    expect(block).not.toMatch(/family:manage/);
  });
});

describe('MCP 工具', () => {
  const tool = ALL_TOOLS.find((t) => t.name === 'family_reconcile');

  it('已注册且只读', () => {
    expect(tool).toBeTruthy();
    expect(tool!.scope).toBe('read');
    expect(tool!.permission).toBe('family:view');
    expect(tool!.domain).toBe('family');
  });

  it('调的是对账接口，路径带 /families 前缀', () => {
    expect(tool!.exec.toString()).toContain('/families/reconcile');
  });
});
