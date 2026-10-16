import { describe, it, expect, vi } from 'vitest';

/**
 * 「按小村庄查询很慢」的回归防线。
 *
 * 背景：/grids/villages 原先是**一条**大 SQL —— 人口数来自 `person ⋈ person_tag`
 * 的连接（行数被标签放大，只能 COUNT(DISTINCT)），6 类重点人群是 6 个
 * `COUNT(DISTINCT CASE WHEN ...)`，家庭数与网格名还是 SELECT 列表里的**相关子查询**
 * （每个村庄各执行一次）。合计「一个 GROUP BY 里 7 个 COUNT(DISTINCT) + 每村两遍子查询」，
 * 万级数据下要等好几秒。
 *
 * 现在拆成 5 条各扫一遍的平铺查询再在内存里合并。这里不比对源码字符串，
 * 而是**真的调用路由处理器**、把执行到的 SQL 拦下来检查，并喂假数据验证合并结果 ——
 * 以后有人图省事把标签连接并回主查询、或把子查询加回来，这组用例会直接红。
 */
const h = vi.hoisted(() => {
  const executed: { sql: string; params: any[] }[] = [];

  const personRows = [
    { name: '艾园村', person_count: 120 },
    { name: '仓门口村', person_count: 80 },
    { name: '小岗村', person_count: 80 },
  ];
  const familyRows = [
    { name: '艾园村', family_count: 42 },
    { name: '仓门口村', family_count: 30 },
  ];
  const gridNameRows = [{ name: '艾园村', grid_names: '第一网格、第二网格' }];
  const contactRows = [{ village_name: '艾园村', manager: '张三', phone: '13800000000' }];
  // 重点人群：艾园村党员 5 人（正式 3 + 预备 2，SQL 里已按人去重）、低保 2 人
  const focusRows = [
    { grp: '艾园村', count_key: 'party_count', cnt: 5 },
    { grp: '艾园村', count_key: 'low_income_count', cnt: 2 },
  ];

  return { executed, personRows, familyRows, gridNameRows, contactRows, focusRows };
});

vi.mock('../src/config/db', () => ({
  pool: {},
  query: async (sql: string, params: any[] = []) => {
    h.executed.push({ sql, params });
    if (sql.includes('AS person_count')) return h.personRows;
    if (sql.includes('AS family_count')) return h.familyRows;
    if (sql.includes('AS grid_names')) return h.gridNameRows;
    if (sql.includes('AS count_key')) return h.focusRows;
    if (sql.includes('FROM village_contact')) return h.contactRows;
    return [];
  },
  queryOne: async () => null,
  execute: async () => ({}),
  withTransaction: async (fn: any) => fn({}),
}));

import gridRouter from '../src/modules/grid';

/** 从路由器里取出 GET /villages 的处理器（route.stack 末尾那个才是业务处理器） */
function villagesHandler(): any {
  const layer: any = (gridRouter as any).stack.find(
    (l: any) => l.route && l.route.path === '/villages' && l.route.methods.get
  );
  if (!layer) throw new Error('未找到 GET /villages 路由');
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

async function callVillages(query: Record<string, any> = {}) {
  const req: any = {
    query,
    user: { id: 1, username: 'tester', isAdmin: true, permissions: new Set<string>() },
    ip: '127.0.0.1',
  };
  let body: any;
  const res: any = {
    json: (b: any) => {
      body = b;
      return res;
    },
    status: () => res,
  };
  h.executed.length = 0;
  await villagesHandler()(req, res, () => {});
  return body;
}

const sqlOf = (needle: string) => {
  const hit = h.executed.find((e) => e.sql.includes(needle));
  expect(hit, `没有执行到包含「${needle}」的 SQL`).toBeTruthy();
  return hit!;
};

describe('GET /grids/villages 的查询形状', () => {
  it('拆成 5 条平铺查询（人口 / 家庭 / 网格名 / 重点人群 / 村庄联系人）', async () => {
    await callVillages();
    expect(h.executed.length).toBe(5);
  });

  it('人口数不与标签相连：普通 COUNT(*)，不是 COUNT(DISTINCT)', async () => {
    await callVillages();
    const person = sqlOf('AS person_count');
    expect(person.sql).toContain('COUNT(*) AS person_count');
    expect(person.sql).not.toContain('person_tag');
    expect(person.sql).not.toContain('COUNT(DISTINCT');
  });

  it('家庭数 / 网格名不再是「每村跑一次」的相关子查询', async () => {
    await callVillages();
    for (const { sql } of h.executed) {
      expect(sql).not.toMatch(/\(\s*SELECT\s+COUNT\(/i);
      expect(sql).not.toMatch(/\(\s*SELECT\s+GROUP_CONCAT/i);
    }
    // 两条都应是平铺 GROUP BY，各扫一遍
    expect(sqlOf('AS family_count').sql).toContain('GROUP BY p.village');
    expect(sqlOf('AS grid_names').sql).toContain('GROUP BY p.village');
  });

  it('重点人群只留 1 个 COUNT(DISTINCT)，按「村庄 × 人群」两列分组', async () => {
    await callVillages();
    const focus = h.executed.filter((e) => e.sql.includes('AS count_key'));
    expect(focus.length).toBe(1);
    const sql = focus[0].sql;
    expect((sql.match(/COUNT\(DISTINCT/g) || []).length).toBe(1);
    expect(sql).toContain('GROUP BY p.village,');
    expect(sql).toContain('JOIN person_tag pt');
    // 标签扫描范围要收窄到重点标签，别把整张 person_tag 拖进来
    expect(sql).toContain("AND td.code IN (");
  });

  it('关键词过滤同时作用在人口数与重点人群上，参数顺序一致', async () => {
    await callVillages({ keyword: '艾园' });
    expect(sqlOf('AS person_count').params).toEqual(['%艾园%']);
    expect(sqlOf('AS count_key').params).toEqual(['%艾园%']);
  });
});

describe('GET /grids/villages 的合并结果', () => {
  it('按村庄名把 5 份数据合成一行，缺项补 0 / null 而不是 undefined', async () => {
    const body = await callVillages();
    expect(body.code).toBe(0);
    expect(body.data.total).toBe(3);

    const ai = body.data.list.find((r: any) => r.name === '艾园村');
    expect(ai).toEqual({
      name: '艾园村',
      manager: '张三',
      phone: '13800000000',
      person_count: 120,
      family_count: 42,
      grid_names: '第一网格、第二网格',
      party_count: 5,
      veteran_count: 0,
      preferential_count: 0,
      low_income_count: 2,
      extreme_poverty_count: 0,
      disabled_count: 0,
    });

    // 没有联系人 / 没有家庭 / 没有网格 / 没有重点人群的村庄：补 null 与 0，不能是 undefined
    const xiao = body.data.list.find((r: any) => r.name === '小岗村');
    expect(xiao).toEqual({
      name: '小岗村',
      manager: null,
      phone: null,
      person_count: 80,
      family_count: 0,
      grid_names: null,
      party_count: 0,
      veteran_count: 0,
      preferential_count: 0,
      low_income_count: 0,
      extreme_poverty_count: 0,
      disabled_count: 0,
    });
  });

  it('先按人口数倒序，人口相同时按村名升序（与原 SQL 的 ORDER BY 同序）', async () => {
    const body = await callVillages();
    expect(body.data.list.map((r: any) => r.name)).toEqual(['艾园村', '仓门口村', '小岗村']);
  });
});
