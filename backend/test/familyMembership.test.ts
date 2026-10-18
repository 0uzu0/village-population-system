import { describe, it, expect } from 'vitest';
import {
  memberLeaveReason,
  markFamilyMemberOnStatusChange,
  findPersonFamilyId,
  isFamilyEmptied,
  countEmptiedFamilies,
  findFamiliesOfPersons,
  syncFamilyMemberOnStatusChange,
  syncPersonFamilyOnEdit,
  updateMemberRelation,
} from '../src/utils/familyMembership';

interface Call {
  sql: string;
  params: any[];
}

/**
 * 假的 mysql2 连接：按 SQL 前缀返回预设结果，并记录每次调用。
 * 返回形状统一成 [rows, fields]，与真实连接一致（代码里有 rowsOf 归一）。
 */
function makeDb(script: {
  familyId?: number | null;
  familyNo?: string | null;
  activeFamilies?: number; // countEmptiedFamilies 返回的「仍在册户数」
  familiesOfPersons?: number[];
} = {}) {
  const calls: Call[] = [];
  const db = {
    query: async (sql: string, params: any[] = []) => {
      calls.push({ sql, params });
      const s = sql.trim();
      if (/^UPDATE family_member/.test(s)) return [{ affectedRows: 1 }, []];
      if (s.startsWith('SELECT family_id FROM family_member')) {
        return [script.familyId ? [{ family_id: script.familyId }] : [], []];
      }
      if (s.startsWith('SELECT family_no FROM family')) {
        return [script.familyNo ? [{ family_no: script.familyNo }] : [], []];
      }
      if (/^SELECT COUNT\(\*\) AS cnt FROM family f WHERE f\.id = \?/.test(s)) {
        const activeCnt = script.activeFamilies ?? 0;
        return [[{ cnt: activeCnt }], []];
      }
      if (/^SELECT COUNT\(\*\) AS cnt FROM family f\s+WHERE f\.id IN/.test(s)) {
        return [[{ cnt: script.activeFamilies ?? 0 }], []];
      }
      if (s.startsWith('SELECT DISTINCT family_id FROM family_member')) {
        return [(script.familiesOfPersons || []).map((id) => ({ family_id: id })), []];
      }
      return [[], []];
    },
  };
  return { db, calls };
}

describe('家庭成员去向（由人员状态反推）', () => {
  it('死亡 / 迁出 / 手工移出 三种去向', () => {
    expect(memberLeaveReason('DEAD')).toBe('DEAD');
    expect(memberLeaveReason('MOVED_OUT')).toBe('MOVED_OUT');
    // 人员仍在册 → 说明只是被移出了家庭
    expect(memberLeaveReason('NORMAL')).toBe('REMOVED');
    expect(memberLeaveReason('MOVED_IN')).toBe('REMOVED');
    expect(memberLeaveReason(null)).toBe('REMOVED');
  });
});

describe('人员状态 × 家庭成员关联', () => {
  it('死亡：关联标记离开，离户日期用状态生效日期（不是今天）', async () => {
    const { db, calls } = makeDb();
    await markFamilyMemberOnStatusChange(db, 7, 'DEAD', '2019-04-02');
    const upd = calls.find((c) => c.sql.startsWith('UPDATE family_member'))!;
    expect(upd.sql).toContain('SET status = 0');
    // 补登往年死亡时记成今天是最典型的错账：家属一眼就看出来
    expect(upd.params[0]).toBe('2019-04-02');
    expect(upd.sql).toContain('COALESCE(?, CURDATE())');
    expect(upd.params[1]).toBe(7);
    // 只动仍在户的那一行，重复执行不会改写已离开的旧日期
    expect(upd.sql).toContain('AND status = 1');
  });

  it('生效日期为空时退回当天（走 SQL 的 CURDATE，不受进程时区影响）', async () => {
    const { db, calls } = makeDb();
    await markFamilyMemberOnStatusChange(db, 7, 'MOVED_OUT', null);
    const upd = calls.find((c) => c.sql.startsWith('UPDATE family_member'))!;
    expect(upd.params[0]).toBeNull();
    expect(upd.sql).toContain('CURDATE()');
  });

  it('改回在册：恢复关联并清空离户日期', async () => {
    const { db, calls } = makeDb();
    await markFamilyMemberOnStatusChange(db, 9, 'NORMAL', null);
    const upd = calls.find((c) => c.sql.startsWith('UPDATE family_member'))!;
    expect(upd.sql).toContain('SET status = 1, leave_date = NULL');
    expect(upd.params).toEqual([9]);
  });

  it('找不到家庭时不报灭户（无家庭不算「灭户」）', async () => {
    const { db } = makeDb({ familyId: null });
    const res = await syncFamilyMemberOnStatusChange(db, 7, 'DEAD', '2020-01-01');
    expect(res).toEqual({ familyId: null, familyNo: null, familyEmptied: false });
  });

  it('独居老人死亡 → 这一户报灭户，并带回家庭编号', async () => {
    const { db } = makeDb({ familyId: 12, familyNo: 'F0012', activeFamilies: 0 });
    const res = await syncFamilyMemberOnStatusChange(db, 7, 'DEAD', '2026-10-01');
    expect(res).toEqual({ familyId: 12, familyNo: 'F0012', familyEmptied: true });
  });

  it('家里还有在册成员 → 不算灭户', async () => {
    const { db } = makeDb({ familyId: 12, familyNo: 'F0012', activeFamilies: 1 });
    const res = await syncFamilyMemberOnStatusChange(db, 7, 'DEAD', '2026-10-01');
    expect(res.familyEmptied).toBe(false);
    expect(res.familyNo).toBe('F0012');
  });

  it('家庭成员关系以关联表为准，优先取生效中的那一行', async () => {
    const { db, calls } = makeDb({ familyId: 3 });
    await findPersonFamilyId(db, 7);
    const sel = calls.find((c) => c.sql.startsWith('SELECT family_id FROM family_member'))!;
    // person.family_id 可能过期（手工移出会清空它），association 表才是事实
    expect(sel.sql).toContain('ORDER BY status DESC, id DESC');
  });
});

describe('批量统计灭户数', () => {
  it('在册户数少于传入户数时，差额就是灭户数', async () => {
    const { db, calls } = makeDb({ activeFamilies: 3 });
    const emptied = await countEmptiedFamilies(db, [1, 2, 3, 4, 5]);
    expect(emptied).toBe(2);
    // 一条 IN 查询解决，不能逐户 COUNT（500 人批次会退化成 500 次查询）
    expect(calls).toHaveLength(1);
    expect(calls[0].params).toEqual([1, 2, 3, 4, 5]);
  });

  it('去重后只用一次 IN，空输入不发查询', async () => {
    const a = makeDb({ activeFamilies: 1 });
    expect(await countEmptiedFamilies(a.db, [5, 5, 5])).toBe(0);
    expect(a.calls[0].params).toEqual([5]);

    const b = makeDb();
    expect(await countEmptiedFamilies(b.db, [])).toBe(0);
    expect(b.calls).toHaveLength(0);
  });

  it('按人员反查家庭：去重、过滤非法值', async () => {
    const { db } = makeDb({ familiesOfPersons: [4, 4, 0] });
    expect(await findFamiliesOfPersons(db, [1, 2])).toEqual([4]);
    const empty = makeDb();
    expect(await findFamiliesOfPersons(empty.db, [])).toEqual([]);
    expect(empty.calls).toHaveLength(0);
  });
});

describe('家庭是否灭户（isFamilyEmptied）', () => {
  it('家庭不存在也算无在册成员', async () => {
    const { db } = makeDb({ activeFamilies: 0 });
    expect(await isFamilyEmptied(db, 99)).toBe(true);
  });

  it('查询走统一口径片段（未停用 + 有在册成员）', async () => {
    const { db, calls } = makeDb({ activeFamilies: 1 });
    expect(await isFamilyEmptied(db, 5)).toBe(false);
    expect(calls[0].sql).toContain('f.status = 1');
    expect(calls[0].sql).toContain('EXISTS');
  });
});

describe('编辑人员时的家庭归属同步', () => {
  it('换户：旧家庭关联标记离开，新家庭写一条在户关联', async () => {
    const { db, calls } = makeDb();
    await syncPersonFamilyOnEdit(db, 7, 9, 'SPOUSE', 'NORMAL');

    const leave = calls.find((c) => c.sql.startsWith('UPDATE family_member') && c.sql.includes('family_id <> ?'))!;
    expect(leave).toBeTruthy();
    expect(leave.sql).toContain('SET status = 0');
    expect(leave.params).toEqual([7, 9]);

    const ins = calls.find((c) => c.sql.startsWith('INSERT INTO family_member'))!;
    expect(ins).toBeTruthy();
    // familyId, personId, relation, isHouseholder, status, 再三个用于 ON DUPLICATE
    expect(ins.params.slice(0, 5)).toEqual([9, 7, 'SPOUSE', 0, 1]);
    // 不能用 VALUES() 函数写法：会被 test/sql-shape 的「列数=值数」扫描误判成值清单
    expect(ins.sql).not.toMatch(/VALUES\s*\(\s*relation/i);
  });

  it('解除归属：只标记离开，不新建关联', async () => {
    const { db, calls } = makeDb();
    await syncPersonFamilyOnEdit(db, 7, null, null, 'NORMAL');
    expect(calls).toHaveLength(1);
    expect(calls[0].sql).toContain('SET status = 0');
    expect(calls[0].params).toEqual([7]);
    expect(calls.some((c) => c.sql.startsWith('INSERT'))).toBe(false);
  });

  it('已故/迁出的人被挂进家庭时，关联只能是「离开」', async () => {
    const { db, calls } = makeDb();
    await syncPersonFamilyOnEdit(db, 7, 9, 'CHILD', 'DEAD');
    const ins = calls.find((c) => c.sql.startsWith('INSERT INTO family_member'))!;
    expect(ins.params[4]).toBe(0);
    // 已故的人不能顶着 head_person_id
    expect(calls.some((c) => c.sql.includes('UPDATE family SET head_person_id'))).toBe(false);
  });

  it('关系填「户主」且在册 → 顺带把户主指过来', async () => {
    const { db, calls } = makeDb();
    await syncPersonFamilyOnEdit(db, 7, 9, 'HEAD', 'NORMAL');
    const head = calls.find((c) => c.sql.includes('UPDATE family SET head_person_id'))!;
    expect(head.params).toEqual([7, 9]);
  });

  it('只改关系：更新在户那一行，不新增也不解除', async () => {
    const { db, calls } = makeDb();
    await updateMemberRelation(db, 7, 'SPOUSE');
    expect(calls).toHaveLength(1);
    expect(calls[0].sql).toContain('SET relation = ?');
    expect(calls[0].sql).toContain('AND status = 1');
    expect(calls[0].params).toEqual(['SPOUSE', 0, 7]);
  });

  it('改户主关系时同步 family.head_person_id', async () => {
    const { db, calls } = makeDb();
    await updateMemberRelation(db, 7, 'HEAD');
    const head = calls.find((c) => c.sql.includes('UPDATE family SET head_person_id'))!;
    expect(head).toBeTruthy();
    expect(head.params).toEqual([7, 7]);
  });
});
