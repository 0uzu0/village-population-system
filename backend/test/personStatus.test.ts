import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  PERSON_STATUSES,
  ACTIVE_STATUSES,
  PERSON_ACTIVE_SQL,
  STATUS_LABELS,
  isActiveStatus,
  isInactiveStatus,
} from '../src/utils/personStatus';

const SRC_DIR = path.resolve(__dirname, '../src');

describe('人员状态口径（V007）', () => {
  it('状态枚举含「死亡」、不含已取消的「注销」', () => {
    expect(PERSON_STATUSES).toContain('DEAD');
    expect(PERSON_STATUSES).not.toContain('CANCELLED');
    expect(PERSON_STATUSES).toEqual(['NORMAL', 'MOVED_IN', 'MOVED_OUT', 'DEAD']);
  });

  it('在册口径只有正常与迁入', () => {
    expect(ACTIVE_STATUSES).toEqual(['NORMAL', 'MOVED_IN']);
    expect(isActiveStatus('NORMAL')).toBe(true);
    expect(isActiveStatus('MOVED_IN')).toBe(true);
    expect(isActiveStatus('MOVED_OUT')).toBe(false);
    expect(isActiveStatus('DEAD')).toBe(false);
    expect(isInactiveStatus('DEAD')).toBe(true);
    expect(isInactiveStatus('NORMAL')).toBe(false);
  });

  it('每个状态都有中文标签', () => {
    for (const s of PERSON_STATUSES) {
      expect(STATUS_LABELS[s], `缺少 ${s} 的中文标签`).toBeTruthy();
    }
    expect(STATUS_LABELS.DEAD).toBe('死亡');
  });

  it('在册过滤片段使用列表别名 p', () => {
    expect(PERSON_ACTIVE_SQL).toBe("p.status IN ('NORMAL','MOVED_IN')");
  });

  it('业务代码里不再出现 CANCELLED（迁移脚本的历史数据处理除外）', () => {
    const files = ['modules/person.ts', 'modules/keygroup.ts', 'modules/excel.ts', 'modules/statistics.ts'];
    for (const f of files) {
      const src = fs.readFileSync(path.join(SRC_DIR, f), 'utf8');
      expect(src.includes('CANCELLED'), `${f} 仍引用了已取消的 CANCELLED 状态`).toBe(false);
    }
  });

  it('统计模块在册口径统一走常量，不再内联状态列表', () => {
    const src = fs.readFileSync(path.join(SRC_DIR, 'modules/statistics.ts'), 'utf8');
    expect(src).toContain('PERSON_ACTIVE_SQL');
    // 源码里常量以 ${PERSON_ACTIVE_SQL} 形式拼进 SQL；手写列表说明有人绕开了常量
    expect(src).not.toContain("p.status IN ('NORMAL','MOVED_IN')");
  });
});

describe('工作台统计口径（/dashboard）', () => {
  const src = fs.readFileSync(path.join(SRC_DIR, 'modules/statistics.ts'), 'utf8');
  const start = src.indexOf("router.get('/dashboard'");
  const end = src.indexOf("router.get('/distributions'");
  const dash = src.slice(start, end);

  it('能定位到 /dashboard 路由体', () => {
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
  });

  it('个人标签计数只统计在册人员（死亡/迁出不计入服务名单）', () => {
    // person_tag 的每个计数都必须经过 person 在册过滤
    expect(dash).toContain('p.id = pt.person_id AND ${PERSON_ACTIVE_SQL}');
    // 不允许出现没有在册过滤的裸计数
    expect(dash).not.toMatch(/person_tag pt\s+WHERE pt\.tag_id = td\.id AND pt\.status='ACTIVE'\)/);
    // 六类重点人群 + 户籍/常住口径都要覆盖
    for (const code of ['PARTY_MEMBER', 'VETERAN', 'PREFERENTIAL_OBJECT', 'LOW_INCOME_PERSON', 'EXTREME_POVERTY_PERSON', 'DISABLED_PERSON']) {
      expect(dash, `工作台缺少 ${code} 的计数`).toContain(code);
    }
  });

  it('低保家庭是 FAMILY 类型，必须从 family_tag 统计', () => {
    // 历史 bug：LOW_INCOME_FAMILY 的 object_type 是 FAMILY，数据在 family_tag，
    // 却从 person_tag 统计，导致「低保家庭」卡片恒为 0
    const ftIdx = dash.indexOf('family_tag');
    expect(ftIdx).toBeGreaterThan(-1);
    expect(dash.slice(ftIdx, ftIdx + 400), 'family_tag 查询必须统计 LOW_INCOME_FAMILY').toContain("'LOW_INCOME_FAMILY'");
    // 个人类标签列表里不应再包含它
    const personTagIdx = dash.indexOf("FROM tag_definition td WHERE td.code IN");
    expect(dash.slice(personTagIdx, dash.indexOf(')', personTagIdx)), '个人标签列表不应包含家庭标签').not.toContain('LOW_INCOME_FAMILY');
  });

  it('标签定义页关联人数只统计在册人员（与重点人群/工作台同口径）', () => {
    const src = fs.readFileSync(path.join(SRC_DIR, 'modules/tag.ts'), 'utf8');
    const idx = src.indexOf('AS person_count');
    expect(idx).toBeGreaterThan(-1);
    // person_count 子查询必须经过 person 在册过滤
    expect(src.slice(Math.max(0, idx - 400), idx)).toContain('${PERSON_ACTIVE_SQL}');
    // 删除前的引用计数不过滤状态：有人引用过（哪怕已故）就不能删标签
    expect(src).toContain('TAG_IN_USE');
  });
});
