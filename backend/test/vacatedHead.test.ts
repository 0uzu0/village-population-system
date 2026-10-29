/**
 * 「户主离户提示」的守卫。
 *
 * 这件事的失败方式很安静：死亡登记照常成功，页面上什么都不说，
 * 那一户从此「有人住、没在册户主」，家庭列表与导出仍挂着已故者的姓名。
 * 直到下次对账报「户主数量不是 1」，或者家属来核对名单，才发现。
 * 线上实测的 5 个异常户里 4 个就是这么攒下来的。
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { findVacatedHeads } from '../src/utils/familyMembership';
import { activeSql } from '../src/utils/personStatus';

const ROOT = path.resolve(__dirname, '..');
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const norm = (s: string) => s.replace(/`/g, '').replace(/\s+/g, ' ').trim();

/** 按 SQL 特征返回预置行；未命中返回空数组（模拟 mysql2 的 rows 形状） */
function fakeDb(cases: { match: RegExp; rows: any[] }[]) {
  const seen: string[] = [];
  return {
    seen,
    async query(sql: string) {
      seen.push(sql);
      const hit = cases.find((c) => c.match.test(sql));
      return hit ? hit.rows : [];
    },
  };
}

describe('findVacatedHeads', () => {
  it('返回每户的在册人数与建议继任者', async () => {
    const db = fakeDb([
      {
        match: /FROM family f/,
        rows: [
          { familyId: 133, familyNo: 'FMV36151RAP0', address: '叶家村16号', headName: '叶宗才' },
          { familyId: 801, familyNo: 'FMV3616YT357', address: '艾园二队158号', headName: '谢英顺' },
        ],
      },
      {
        match: /FROM family_member fm/,
        rows: [
          { familyId: 133, personId: 341, relation: 'SPOUSE', name: '乐守琴' },
          { familyId: 133, personId: 342, relation: 'CHILD', name: '叶敬' },
          { familyId: 801, personId: 2088, relation: 'SPOUSE', name: '邓六珍' },
        ],
      },
    ]) as any;

    const rows = await findVacatedHeads(db, [340, 2089]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ familyId: 133, remaining: 2, headName: '叶宗才' });
    // 候选取 SQL 排好序的第一个（关系优先级 + 年龄），这里只验证“取第一个”
    expect(rows[0].candidate).toEqual({ personId: 341, name: '乐守琴', relation: 'SPOUSE' });
    expect(rows[1].remaining).toBe(1);
  });

  it('户里已无在册成员时 candidate 为 null —— 那是灭户，不是改选', async () => {
    const db = fakeDb([
      { match: /FROM family f/, rows: [{ familyId: 900, familyNo: 'F900', address: null, headName: '某甲' }] },
      { match: /FROM family_member fm/, rows: [] },
    ]) as any;
    const rows = await findVacatedHeads(db, [1]);
    expect(rows[0].remaining).toBe(0);
    expect(rows[0].candidate).toBeNull();
  });

  it('没有人是户主时返回空数组，且不多发一次成员查询', async () => {
    const db = fakeDb([{ match: /FROM family f/, rows: [] }]) as any;
    expect(await findVacatedHeads(db, [7])).toEqual([]);
    expect(db.seen).toHaveLength(1);
  });

  it('过滤非法 id 并去重（批量接口可能把同一个 id 传两遍）', async () => {
    const db = fakeDb([{ match: /FROM family f/, rows: [] }]) as any;
    expect(await findVacatedHeads(db, [])).toEqual([]);
    expect(db.seen).toHaveLength(0);
    await findVacatedHeads(db, [0, -1, 1.5] as any);
    expect(db.seen).toHaveLength(0);
  });

  it('候选只在在册成员里挑，且判据是 family.head_person_id', async () => {
    const db = fakeDb([{ match: /FROM family f/, rows: [] }]) as any;
    await findVacatedHeads(db, [5]);
    const sql = db.seen[0];
    // 判据：家庭表上的 head_person_id（家庭列表/导出取户主姓名的唯一来源）
    expect(norm(sql)).toContain('f.head_person_id IN');
    // 候选查询必须带在册过滤：已故的配偶不能成为“建议继任者”
    const db2 = fakeDb([
      { match: /FROM family f/, rows: [{ familyId: 1, familyNo: 'F1', address: null, headName: '甲' }] },
      { match: /FROM family_member fm/, rows: [] },
    ]) as any;
    await findVacatedHeads(db2, [5]);
    const memberSql = db2.seen.find((s) => /FROM family_member fm/.test(s))!;
    expect(norm(memberSql)).toContain(norm(activeSql('p')));
  });
});

describe('状态变更接口接线', () => {
  const src = read('src/modules/person.ts');

  it('单条与批量都调用 findVacatedHeads，并且只在转为非在册时查', () => {
    const calls = src.match(/findVacatedHeads\(/g) || [];
    // 一次 import 不算调用（import 里不带括号）
    expect(calls.length).toBe(2);
    expect(src).toMatch(/isInactiveStatus\(status\) \? await findVacatedHeads\(conn, \[id\]\)/);
    expect(src).toMatch(/if \(inactive\) \{[\s\S]{0,400}findVacatedHeads\(conn, personIds\)/);
  });

  it('灭户的户不提示改选（remaining = 0 已被滤掉）', () => {
    // 单条与批量各一处，漏一处就会在「独居老人去世」的常见场景里提示改选一个空户
    expect((src.match(/remaining > 0/g) || []).length).toBe(2);
    expect(src).toContain('headVacated.filter((h) => h.remaining > 0)');
  });

  it('提示语带建议继任者，但改选仍由人确认', () => {
    expect(src).toContain('请到家庭页改选户主');
    expect(src).toContain('建议由');
  });
});

describe('前端入口', () => {
  const dialog = read('../frontend/src/components/StatusChangeDialog.vue');
  const familyPage = read('../frontend/src/views/family/index.vue');

  it('状态变更成功后处理 headVacated 并给出改选入口', () => {
    expect(dialog).toContain('headVacated');
    expect(dialog).toContain('去改选户主');
    // 拼 HTML 必须转义库里的姓名/地址
    expect(dialog).toContain('dangerouslyUseHTMLString');
    expect(dialog).toMatch(/function esc\(/);
  });

  it('家庭页支持 ?familyId= 直达，并提供改选户主对话框', () => {
    expect(familyPage).toContain('route.query.familyId');
    expect(familyPage).toContain('familyApi.changeHead');
    expect(familyPage).toContain('headVacant');
  });
});
