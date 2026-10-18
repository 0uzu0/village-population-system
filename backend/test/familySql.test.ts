import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  activeFamilySql,
  familyHasActiveMemberSql,
  activeMemberCountSql,
} from '../src/utils/familySql';

const SRC_DIR = path.resolve(__dirname, '../src');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

describe('在册家庭口径（utils/familySql.ts）', () => {
  it('在册家庭 = 未停用 + 至少一名在册成员', () => {
    const sql = activeFamilySql();
    expect(sql).toContain('f.status = 1');
    expect(sql).toContain('EXISTS');
  });

  it('成员判定同时要求「在户」与「人员在册」，两个条件缺一不可', () => {
    const sub = familyHasActiveMemberSql('f');
    // 在户
    expect(sub).toMatch(/fm_chk\.status = 1/);
    // 在册：必须走 activeSql，不能手写状态列表
    expect(sub).toContain("p_chk.status IN ('NORMAL','MOVED_IN')");
    // 关联到外层家庭
    expect(sub).toContain('fm_chk.family_id = f.id');
  });

  it('别名可换，子查询内部别名固定不与外层冲突', () => {
    const a = activeFamilySql('fam');
    expect(a).toContain('fam.status = 1');
    expect(a).toContain('fm_chk.family_id = fam.id');
    // 内部别名不能跟着外层变，否则自连接时会互相遮蔽
    expect(a).toContain('fm_chk');
  });

  it('成员计数与在册口径同源（列表人数不能把已故算进去）', () => {
    const sql = activeMemberCountSql('f');
    expect(sql).toContain('fm_chk.status = 1');
    expect(sql).toContain("p_chk.status IN ('NORMAL','MOVED_IN')");
  });

  it('全项目数家庭的地方都走 activeFamilySql，不再手写 f.status = 1', () => {
    // 反例：`WHERE f.status = 1` 出现在数家庭的地方，就等于这一户没人了还照样算。
    // 这正是「独居老人死亡后家庭总数不减」的原始 bug。
    const offenders: string[] = [];
    for (const file of walk(SRC_DIR)) {
      const rel = path.relative(SRC_DIR, file);
      if (rel === path.join('utils', 'familySql.ts')) continue;
      const code = fs.readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
      // 只看「数/查家庭」而不是别的表：COUNT(*) FROM family ... status = 1
      if (/COUNT\([^)]*\)[^;]*FROM\s+family\s+\w*\s*WHERE[^`;]*status\s*=\s*1/i.test(code) && !code.includes('activeFamilySql')) {
        offenders.push(rel);
      }
    }
    expect(offenders, '请改用 activeFamilySql(alias)，否则家庭数会把已灭户算进去').toEqual([]);
  });

  it('工作台、网格的家庭计数已切换到统一口径', () => {
    // modules/tag.ts 曾统计家庭标签数（family_count），V026 下线家庭标签后不再查 family 表，故移出清单
    for (const f of ['modules/statistics.ts', 'modules/grid.ts']) {
      const src = fs.readFileSync(path.join(SRC_DIR, f), 'utf8');
      expect(src, `${f} 未使用 activeFamilySql`).toContain('activeFamilySql(');
    }
  });
});

describe('写入侧：所有会改变家庭归属的入口都同步了 family_member', () => {
  const read = (rel: string) => fs.readFileSync(path.join(SRC_DIR, rel), 'utf8');

  it('人员建档 / 编辑 / 状态变更（单条与批量）都走 utils/familyMembership', () => {
    const src = read('modules/person.ts');
    expect(src, '建档时要按人员状态决定关联是否在户').toContain('isInactiveStatus(body.status');
    expect(src, '编辑改家庭归属时要同步关联').toContain('syncPersonFamilyOnEdit');
    expect(src, '状态变更（单条）').toContain('syncFamilyMemberOnStatusChange');
    expect(src, '状态变更（批量）').toContain('markFamilyMemberOnStatusChange');
    // 模块里自己写 UPDATE family_member 就等于绕开了口径
    expect(src).not.toContain('UPDATE family_member');
  });

  it('导入与待核查确认按人员状态写入关联（不能一律挂在户）', () => {
    const imp = read('modules/excel/importPerson.ts');
    expect(imp).toContain('isActiveStatus(p.status');
    expect(imp).toMatch(/INSERT IGNORE INTO family_member \([^)]*status\)/);

    const pending = read('modules/pending.ts');
    expect(pending).toContain('isActiveStatus(personStatus) ? 1 : 0');
    expect(pending).toMatch(/INSERT IGNORE INTO family_member \([^)]*status\)/);
  });

  it('家庭模块拒绝把已故/迁出人员当作在户成员或户主', () => {
    const src = read('modules/family.ts');
    expect(src).toContain('assertActivePerson');
    // 新增成员与变更户主两个入口都要校验
    expect((src.match(/assertActivePerson\(/g) || []).length).toBeGreaterThanOrEqual(4);
    expect(src).toContain('PERSON_INACTIVE');
  });
});
