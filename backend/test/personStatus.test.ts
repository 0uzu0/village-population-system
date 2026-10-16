import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  PERSON_STATUSES,
  ACTIVE_STATUSES,
  activeSql,
  STATUS_LABELS,
  isActiveStatus,
  isInactiveStatus,
} from '../src/utils/personStatus';

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

  it('activeSql 按别名生成在册过滤片段', () => {
    expect(activeSql()).toBe("p.status IN ('NORMAL','MOVED_IN')");
    expect(activeSql('p')).toBe("p.status IN ('NORMAL','MOVED_IN')");
    expect(activeSql('pf')).toBe("pf.status IN ('NORMAL','MOVED_IN')");
    expect(activeSql('person')).toBe("person.status IN ('NORMAL','MOVED_IN')");
  });

  it('全项目只有在册口径工具一处写死了状态列表（防再次各写一份）', () => {
    // 历史上这段字符串在 8 个地方各抄了一遍，随后反复出现「新统计忘加在册过滤」。
    // 现在只允许 utils/personStatus.ts 里出现字面量。
    const offenders: string[] = [];
    for (const file of walk(SRC_DIR)) {
      if (file.endsWith(path.join('utils', 'personStatus.ts'))) continue;
      const src = fs.readFileSync(file, 'utf8');
      // 允许注释里说明口径，只查代码行
      const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      if (/'NORMAL'\s*,\s*'MOVED_IN'/.test(code) || /status IN \('NORMAL'/.test(code)) {
        offenders.push(path.relative(SRC_DIR, file));
      }
    }
    expect(offenders, '请改用 activeSql(alias)，不要手写状态列表').toEqual([]);
  });

  it('业务代码里不再出现 CANCELLED（迁移脚本的历史数据处理除外）', () => {
    const files = ['modules/person.ts', 'modules/keygroup.ts', 'modules/excel/importPerson.ts', 'modules/statistics.ts'];
    for (const f of files) {
      const src = fs.readFileSync(path.join(SRC_DIR, f), 'utf8');
      // 注释里可以说明「为什么不能用CANCELLED」，但代码中不能真的引用它
      const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      expect(code.includes('CANCELLED'), `${f} 的代码中仍引用了已取消的 CANCELLED 状态`).toBe(false);
    }
  });

  it('创建人员时 status 必须是合法枚举（防止写入脏值静默脱离统计）', () => {
    const src = fs.readFileSync(path.join(SRC_DIR, 'modules/person.ts'), 'utf8');
    // personSchema 里的 status 用 z.string() 的话，任意脏值都能落库
    expect(src, 'personSchema 的 status 应改用 z.enum(PERSON_STATUSES)').toMatch(
      /status:\s*z\.enum\(PERSON_STATUSES\)\.optional\(\)/
    );
  });

  it('状态变更双向维护家庭成员关联（转非在册标记离开，改回在册需恢复）', () => {
    const src = fs.readFileSync(path.join(SRC_DIR, 'modules/person.ts'), 'utf8');
    // 单条与批量两处都要有反向恢复：'SET status = 1, leave_date = NULL'
    const restore = src.match(/family_member SET status = 1, leave_date = NULL/g) || [];
    expect(
      restore.length,
      '改回在册时应恢复 family_member（status=1, leave_date=NULL），单条与批量两处都要处理'
    ).toBeGreaterThanOrEqual(2);
  });

  it('统计模块在册口径统一走 activeSql，不再内联状态列表', () => {
    const src = fs.readFileSync(path.join(SRC_DIR, 'modules/statistics.ts'), 'utf8');
    expect(src).toContain("activeSql('p')");
    // 手写列表说明有人绕开了工具函数
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
    expect(dash).toContain("p.id = pt.person_id AND ${activeSql('p')}");
    // 不允许出现没有在册过滤的裸计数
    expect(dash).not.toMatch(/person_tag pt\s+WHERE pt\.tag_id = td\.id AND pt\.status='ACTIVE'\)/);
  });

  it('重点人群编码来自 focusGroups 单一来源，不散落在各模块', () => {
    // 原先同一批编码在 keygroup / grid / statistics / excel 四处各写一遍，
    // 现在统一来自 utils/focusGroups.ts：statistics 只引用工具函数。
    expect(dash).toContain('allFocusTagCodes()');
    const focusSrc = fs.readFileSync(path.join(SRC_DIR, 'utils/focusGroups.ts'), 'utf8');
    for (const code of ['PARTY_MEMBER', 'VETERAN', 'PREFERENTIAL_OBJECT', 'LOW_INCOME_PERSON', 'EXTREME_POVERTY_PERSON', 'DISABLED_PERSON']) {
      expect(focusSrc, `focusGroups 缺少 ${code} 的定义`).toContain(code);
    }
    // 五个身份类人群都要映射到工作台卡片字段。
    // 「低保对象」(lowIncomePersonCount) 已按需求从工作台移除，故不在列表内——
    // 但标签定义本身（LOW_INCOME_PERSON）保留，重点人群筛查与导出仍在用。
    for (const field of ['partyCount', 'veteranCount', 'preferentialCount', 'extremePovertyCount', 'disabledCount']) {
      expect(focusSrc, `focusGroups 缺少 ${field} 的映射`).toContain(field);
    }
    expect(focusSrc, '工作台不应再下发低保卡片字段').not.toContain('lowIncomePersonCount');
  });

  it('工作台已移除低保统计：不再查 family_tag，也不再下发 lowIncomeFamilyCount', () => {
    // 需求变更：工作台删除所有低保相关统计（低保家庭 + 低保对象）。
    // 原先这里要断言「低保家庭走 family_tag 统计」，现在反过来——
    // dashboard 不再查 family_tag，也不再返回 lowIncomeFamilyCount 字段。
    expect(dash, 'dashboard 不应再查询 family_tag').not.toContain('family_tag');
    expect(dash, 'dashboard 不应再返回 lowIncomeFamilyCount').not.toContain('lowIncomeFamilyCount');
    // 低保标签本身仍保留在 focusGroups 中（重点人群筛查要用到）
    const focusSrc = fs.readFileSync(path.join(SRC_DIR, 'utils/focusGroups.ts'), 'utf8');
    expect(focusSrc, 'LOW_INCOME_PERSON 标签定义应保留').toContain('LOW_INCOME_PERSON');
  });

  it('标签定义页关联人数只统计在册人员（与重点人群/工作台同口径）', () => {
    const src = fs.readFileSync(path.join(SRC_DIR, 'modules/tag.ts'), 'utf8');
    const idx = src.indexOf('AS person_count');
    expect(idx).toBeGreaterThan(-1);
    // person_count 子查询必须经过 person 在册过滤
    expect(src.slice(Math.max(0, idx - 400), idx)).toContain("${activeSql('p')}");
    // 删除前的引用计数不过滤状态：有人引用过（哪怕已故）就不能删标签
    expect(src).toContain('TAG_IN_USE');
  });
});
