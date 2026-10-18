import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  SYSTEM_TAG_CODES,
  aliasedSystemCode,
  checkNewTagCode,
  checkTagCodeChange,
  isSystemTagCode,
} from '../src/utils/systemTags';

/**
 * 这组用例锁的是「标签编码是统计口径的对外契约」这条不变量。
 *
 * 2026-10-18 线上问题：用户在标签管理页建了一枚「流动人口」，编码手填成
 * `FLOATING_PERSON`（规范编码是 `FLOATING_POP`），然后给人员打上。结果
 * 标签页显示 N 人、工作台流动人口恒为 0 —— 因为工作台按 code 取数。
 * 整个过程没有任何报错。
 */
describe('系统标签编码', () => {
  it('户籍/流动与重点人群都在系统编码清单里', () => {
    for (const code of ['HUKOU_POP', 'FLOATING_POP', 'PARTY_MEMBER', 'VETERAN', 'DISABLED_PERSON']) {
      expect(isSystemTagCode(code)).toBe(true);
    }
  });

  it('自定义编码不算系统编码（否则防呆会误拦）', () => {
    expect(isSystemTagCode('FLOATING_PERSON')).toBe(false);
    expect(isSystemTagCode('MY_CUSTOM_TAG')).toBe(false);
  });

  it('常见误写能归一到规范编码', () => {
    expect(aliasedSystemCode('FLOATING_PERSON')).toBe('FLOATING_POP');
    expect(aliasedSystemCode('RESIDENT_POP')).toBe('FLOATING_POP');
    expect(aliasedSystemCode('HUKOU_PERSON')).toBe('HUKOU_POP');
    expect(aliasedSystemCode('FLOATING_POP')).toBeNull();
  });
});

describe('新建标签的编码校验', () => {
  it('别名编码直接拒绝，并告知正确的编码', () => {
    const r = checkNewTagCode('FLOATING_PERSON');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errorCode).toBe('TAG_CODE_ALIAS');
      expect(r.message).toContain('FLOATING_POP');
    }
  });

  it('规范编码与全新自定义编码都放行', () => {
    expect(checkNewTagCode('FLOATING_POP').ok).toBe(true);
    // 允许重建「被物理删掉」的系统标签：编码仍是规范编码
    expect(checkNewTagCode('MY_OWN_TAG').ok).toBe(true);
  });
});

describe('编辑标签的编码校验', () => {
  it('系统标签的编码不可修改', () => {
    const r = checkTagCodeChange('FLOATING_POP', 'FLOATING_PERSON', '流动人口');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errorCode).toBe('SYSTEM_TAG_CODE_IMMUTABLE');
      // 提示里要说清后果，否则用户只会以为前端坏了
      expect(r.message).toContain('FLOATING_POP');
      expect(r.message).toContain('0');
    }
  });

  it('系统标签改名称/颜色（编码不变）不受影响', () => {
    expect(checkTagCodeChange('FLOATING_POP', 'FLOATING_POP', '流动人口').ok).toBe(true);
  });

  it('普通标签可以正常改编码', () => {
    expect(checkTagCodeChange('MY_OLD_CODE', 'MY_NEW_CODE', '自定义').ok).toBe(true);
  });

  it('普通标签也不能改成系统标签的别名', () => {
    const r = checkTagCodeChange('MY_CODE', 'FLOATING_PERSON', '自定义');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errorCode).toBe('TAG_CODE_ALIAS');
  });
});

describe('V023 合并迁移与代码里的系统编码清单保持一致', () => {
  /**
   * 迁移是静态 SQL，没法 import 常量，所以编码清单在迁移里抄了一份。
   * 这条用例防止「代码里新增了系统标签，迁移忘了同步」——那种漂移
   * 会让新标签的同名副本继续漏网。
   *
   * 断言是**超集**而非全等：V023 抄的是当时的系统编码清单，其中
   * 家庭维度两个编码（LOW_INCOME_FAMILY / EXTREME_POVERTY_FAMILY）随
   * V026 下线家庭标签功能从代码清单移除了，但 V023 是已执行的历史迁移，
   * 不回改。此后代码里新增系统编码时，仍必须回到 V023 语义的保护范围
   * ——若新增的编码也不在 V023 里，需要在这里同步补白名单。
   */
  it('V023 的 IN 列表覆盖全部 SYSTEM_TAG_CODES（超集）', () => {
    const file = path.join(__dirname, '../src/db/migrations/V023__merge_duplicate_system_tags.sql');
    const sql = fs.readFileSync(file, 'utf-8');
    const lists = [...sql.matchAll(/\bIN\s*\(([^)]*)\)/gi)].map((m) => m[1]);
    expect(lists.length).toBeGreaterThan(0);

    const fromSql = new Set<string>();
    for (const list of lists) {
      for (const m of list.matchAll(/'([A-Z0-9_]+)'/g)) fromSql.add(m[1]);
    }

    const missing = [...SYSTEM_TAG_CODES].filter((c) => !fromSql.has(c));
    expect(missing, `V023 迁移缺这些系统编码，合并去重会漏掉它们: ${missing.join(',')}`).toEqual([]);
  });

  it('迁移必须可重跑：不使用 ADD COLUMN 之类不可重复的 DDL', () => {
    const file = path.join(__dirname, '../src/db/migrations/V023__merge_duplicate_system_tags.sql');
    const sql = fs.readFileSync(file, 'utf-8');
    expect(sql).not.toMatch(/\bADD\s+COLUMN\b/i);
    expect(sql).not.toMatch(/\bDROP\s+(COLUMN|TABLE)\b/i);
  });
});
