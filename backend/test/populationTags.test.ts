import { describe, it, expect } from 'vitest';
import {
  POPULATION_TAG_CODES,
  STATUS_SYNC_PREFIX,
  isPopulationTagCode,
  parsePopulationTagCode,
  assertPopulationTagsAllowed,
  clearPopulationTags,
  restorePopulationTag,
  syncPopulationTagsOnStatusChange,
} from '../src/utils/populationTags';
import { HUKOU_POP_CODE, FLOATING_POP_CODE } from '../src/config/tagCodes';

/**
 * 人口归属标签 × 人员状态 的联动规则。
 *
 * 锁的是三条不变式（改动 utils/populationTags.ts 前先读）：
 *   1. 非在册 → 两枚人口标签都不得生效；
 *   2. 改回在册 → 恢复最近一次被状态联动停用的那一枚，不猜；
 *   3. 所有停用/恢复都留痕，remark 以固定前缀开头（恢复逻辑靠它倒查）。
 *
 * 这些用例用假 db 断言「发了哪些 SQL」，不是真库测试 ——
 * 规则本身是纯逻辑，真库留给 CI 的迁移/启动检查。
 */

interface Call {
  sql: string;
  params: any[];
}

interface Script {
  status?: string;
  /** tag_definition 里的两枚人口标签 */
  defs?: { id: number; code: string; name: string }[];
  /** 当前生效的人口标签关联 */
  activeLinks?: { id: number; tag_id: number; name: string }[];
  /** tag_change_log 里最近一条状态联动 REMOVE 记录 */
  lastRemovedTagId?: number | null;
  /** 那条 REMOVE 的备注；默认是状态联动写的，传普通文案表示「手工移除」 */
  lastRemovedRemark?: string;
  /** person_tag 里该标签最近一条关联行 */
  linkRow?: { id: number } | null;
}

function makeDb(script: Script) {
  const calls: Call[] = [];
  const db = {
    query: async (sql: string, params: any[] = []) => {
      calls.push({ sql, params });
      const s = sql.replace(/\s+/g, ' ').trim();

      if (s.startsWith('SELECT status FROM person')) {
        return [script.status ? [{ status: script.status }] : []];
      }
      if (s.startsWith('SELECT id, code, name FROM tag_definition WHERE code IN')) {
        return [script.defs ?? []];
      }
      if (s.startsWith('SELECT id, code, name FROM tag_definition WHERE id IN')) {
        const ids = (params.slice(0, -POPULATION_TAG_CODES.length) as number[]).map(Number);
        const defs = (script.defs ?? []).filter((d) => ids.includes(d.id));
        return [defs];
      }
      if (s.startsWith('SELECT id, code, name FROM tag_definition WHERE id =')) {
        return [(script.defs ?? []).filter((d) => d.id === Number(params[0]))];
      }
      if (s.startsWith('SELECT pt.id, pt.tag_id, td.name')) {
        return [script.activeLinks ?? []];
      }
      if (s.startsWith('SELECT tcl.tag_id, tcl.remark')) {
        if (!script.lastRemovedTagId) return [[]];
        return [
          [
            {
              tag_id: script.lastRemovedTagId,
              remark: script.lastRemovedRemark ?? `${STATUS_SYNC_PREFIX}变更为「迁出」，停用「户籍人口」`,
            },
          ],
        ];
      }
      if (s.startsWith('SELECT id FROM person_tag WHERE person_id = ? AND tag_id = ?')) {
        return [script.linkRow ? [script.linkRow] : []];
      }
      return [[]];
    },
  };
  return { db, calls };
}

const HUKOU = { id: 15, code: HUKOU_POP_CODE, name: '户籍人口' };
const FLOATING = { id: 14, code: FLOATING_POP_CODE, name: '流动人口' };

const updateCall = (calls: Call[]) => calls.find((c) => /^UPDATE person_tag/.test(c.sql));
const logCalls = (calls: Call[]) => calls.filter((c) => /^INSERT INTO tag_change_log/.test(c.sql));

describe('人口标签编码解析', () => {
  it('认两枚系统编码', () => {
    expect(POPULATION_TAG_CODES).toEqual([HUKOU_POP_CODE, FLOATING_POP_CODE]);
    expect(isPopulationTagCode(HUKOU_POP_CODE)).toBe(true);
    expect(isPopulationTagCode(FLOATING_POP_CODE)).toBe(true);
    expect(isPopulationTagCode('PARTY_MEMBER')).toBe(false);
  });

  it('认台账里的中文写法与简称', () => {
    expect(parsePopulationTagCode('户籍人口')).toBe(HUKOU_POP_CODE);
    expect(parsePopulationTagCode(' 户籍 ')).toBe(HUKOU_POP_CODE);
    expect(parsePopulationTagCode('流动人口')).toBe(FLOATING_POP_CODE);
    expect(parsePopulationTagCode('暂住人口')).toBe(FLOATING_POP_CODE);
    expect(parsePopulationTagCode('外来人口')).toBe(FLOATING_POP_CODE);
    expect(parsePopulationTagCode(HUKOU_POP_CODE.toLowerCase())).toBe(HUKOU_POP_CODE);
  });

  it('空值与认不出的写法返回 null，不猜', () => {
    expect(parsePopulationTagCode('')).toBeNull();
    expect(parsePopulationTagCode('   ')).toBeNull();
    expect(parsePopulationTagCode(null)).toBeNull();
    expect(parsePopulationTagCode('常住人口')).toBeNull();
  });
});

describe('写入守卫：非在册人员不得持有人口标签', () => {
  it('在册人员正常放行', async () => {
    const { db, calls } = makeDb({ status: 'NORMAL', defs: [HUKOU, FLOATING] });
    await expect(assertPopulationTagsAllowed(db, 1, [HUKOU.id])).resolves.toBeUndefined();
    // 只查了一次状态，没再查标签定义（在册无需判断是哪枚标签）
    expect(calls).toHaveLength(1);
    expect(calls[0].sql).toContain('SELECT status FROM person');
  });

  it('调用方已给出状态时不重复查库', async () => {
    const { db, calls } = makeDb({ defs: [HUKOU, FLOATING] });
    await expect(assertPopulationTagsAllowed(db, 1, [HUKOU.id], 'NORMAL')).resolves.toBeUndefined();
    expect(calls).toHaveLength(0);
  });

  it('迁出人员打「户籍人口」→ 抛错并说清原因', async () => {
    const { db } = makeDb({ status: 'MOVED_OUT', defs: [HUKOU, FLOATING] });
    await expect(assertPopulationTagsAllowed(db, 1, [HUKOU.id])).rejects.toThrow(/迁出/);
    await expect(assertPopulationTagsAllowed(db, 1, [HUKOU.id])).rejects.toThrow(/户籍人口/);
  });

  it('死亡人员同理，且提示里带上状态名', async () => {
    const { db } = makeDb({ status: 'DEAD', defs: [HUKOU, FLOATING] });
    await expect(assertPopulationTagsAllowed(db, 1, [FLOATING.id])).rejects.toThrow(/死亡/);
  });

  it('非人口标签不受状态限制（党员、低保这类历史身份要保留）', async () => {
    const { db } = makeDb({ status: 'DEAD', defs: [HUKOU, FLOATING] });
    await expect(assertPopulationTagsAllowed(db, 1, [99])).resolves.toBeUndefined();
  });

  it('空标签列表直接返回，不查库', async () => {
    const { db, calls } = makeDb({ status: 'DEAD' });
    await expect(assertPopulationTagsAllowed(db, 1, [])).resolves.toBeUndefined();
    expect(calls).toHaveLength(0);
  });
});

describe('状态变更联动', () => {
  it('迁出 → 停用生效中的人口标签，并逐条留痕', async () => {
    const { db, calls } = makeDb({
      activeLinks: [
        { id: 101, tag_id: HUKOU.id, name: '户籍人口' },
        { id: 102, tag_id: FLOATING.id, name: '流动人口' },
      ],
      defs: [HUKOU, FLOATING],
    });

    const res = await syncPopulationTagsOnStatusChange(db, 7, 'MOVED_OUT', 1);

    expect(res).toEqual({ cleared: 2, restored: 0 });
    const upd = updateCall(calls)!;
    expect(upd.sql).toContain("status = 'INACTIVE'");
    expect(upd.params).toEqual([101, 102]);

    const logs = logCalls(calls);
    expect(logs).toHaveLength(1);
    expect(logs[0].sql).toContain("'REMOVE'");
    // 两行日志：户籍、流动各一条
    expect(logs[0].params).toHaveLength(8);
    for (const p of logs[0].params.filter((x) => typeof x === 'string')) {
      expect(String(p).startsWith(STATUS_SYNC_PREFIX)).toBe(true);
    }
  });

  it('死亡 → 同样停用（户口注销后也不属于任何一类人口）', async () => {
    const { db } = makeDb({ activeLinks: [{ id: 101, tag_id: HUKOU.id, name: '户籍人口' }] });
    const res = await syncPopulationTagsOnStatusChange(db, 7, 'DEAD', 1);
    expect(res.cleared).toBe(1);
  });

  it('本来就没有人口标签 → 不动任何数据（重复迁出幂等）', async () => {
    const { db, calls } = makeDb({ activeLinks: [] });
    const res = await syncPopulationTagsOnStatusChange(db, 7, 'MOVED_OUT', 1);
    expect(res).toEqual({ cleared: 0, restored: 0 });
    expect(updateCall(calls)).toBeUndefined();
    expect(logCalls(calls)).toHaveLength(0);
  });

  it('改回在册 → 恢复被联动停用的那一枚，并留痕', async () => {
    const { db, calls } = makeDb({
      defs: [HUKOU, FLOATING],
      lastRemovedTagId: HUKOU.id,
      linkRow: { id: 101 },
      activeLinks: [],
    });

    const res = await restorePopulationTag(db, 7, 1);
    expect(res).toBe(1);

    const upd = updateCall(calls)!;
    expect(upd.sql).toContain("status = 'ACTIVE'");
    expect(upd.sql).toContain('expire_date = NULL');
    expect(upd.params).toEqual([101]);

    const logs = logCalls(calls);
    expect(logs).toHaveLength(1);
    expect(logs[0].sql).toContain("'ADD'");
    // 恢复的必须是当初那枚，不是「默认户籍人口」
    expect(logs[0].params[1]).toBe(HUKOU.id);
  });

  it('从没被联动停用过 → 不恢复（不凭空造标签）', async () => {
    const { db, calls } = makeDb({ lastRemovedTagId: null });
    const res = await restorePopulationTag(db, 7, 1);
    expect(res).toBe(0);
    expect(updateCall(calls)).toBeUndefined();
  });

  it('最新一次是手工移除 → 不恢复（不能把用户主动摘掉的标签翻出来）', async () => {
    const { db, calls } = makeDb({
      lastRemovedTagId: HUKOU.id,
      // 普通移除没有联动前缀
      lastRemovedRemark: '移除标签',
      defs: [HUKOU, FLOATING],
      linkRow: { id: 101 },
      activeLinks: [],
    });
    const res = await restorePopulationTag(db, 7, 1);
    expect(res).toBe(0);
    expect(updateCall(calls)).toBeUndefined();
  });

  it('已经有一枚生效人口标签 → 不再恢复（否则同组两枚）', async () => {
    const { db, calls } = makeDb({
      lastRemovedTagId: HUKOU.id,
      defs: [HUKOU, FLOATING],
      activeLinks: [{ id: 200, tag_id: FLOATING.id, name: '流动人口' }],
      linkRow: { id: 101 },
    });
    const res = await restorePopulationTag(db, 7, 1);
    expect(res).toBe(0);
    expect(updateCall(calls)).toBeUndefined();
  });

  it('那枚标签已被删除或改编码 → 不恢复', async () => {
    const { db, calls } = makeDb({ lastRemovedTagId: HUKOU.id, defs: [] });
    const res = await restorePopulationTag(db, 7, 1);
    expect(res).toBe(0);
    expect(updateCall(calls)).toBeUndefined();
  });

  it('清空时找不到关联行 → 返回 0，不写日志', async () => {
    const { db, calls } = makeDb({ activeLinks: [] });
    expect(await clearPopulationTags(db, 7, 1, '测试')).toBe(0);
    expect(logCalls(calls)).toHaveLength(0);
  });
});
