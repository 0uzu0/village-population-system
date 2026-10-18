import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const personSrc = fs.readFileSync(path.resolve(__dirname, '../src/modules/person.ts'), 'utf8');
// v2.2 起 toPersonVO 抽到读侧服务（modules/person.ts → services/personQuery.ts）
const querySrc = fs.readFileSync(path.resolve(__dirname, '../src/services/personQuery.ts'), 'utf8');
const keygroupSrc = fs.readFileSync(path.resolve(__dirname, '../src/modules/keygroup.ts'), 'utf8');

/**
 * 回归：残疾档案列在查询里被「漏 SELECT」导致前端显示空白。
 *
 * 事故背景：残疾数据其实已经正确写入了 person_disability 表，但两个查询接口
 * 都只 JOIN 了表却没把列选出来（或按需 JOIN），导致前端读到 undefined：
 * 1. 人员详情接口只取了 pd.person_id / pd.remark，其余 5 列全漏 → 详情页
 *    「残疾信息」显示「已建档」但类别/等级空白；
 * 2. 重点人群列表接口按「是否传了残疾筛选条件」决定要不要 JOIN，但表格的
 *    「残疾等级」「监护人」两列是无条件展示的 → 不筛时这两列永远空白。
 *
 * 本测试锁定：凡是需要把残疾档案字段返回给前端的 SELECT，都必须显式、无条件地
 * 选取全部列，防止后续删改列时再次静默回归。
 */

describe('人员详情接口残疾档案 SELECT 完整性', () => {
  it('详情 SQL 显式选取全部残疾档案列', () => {
    const m = personSrc.match(/`SELECT p\.\*,[\s\S]*?FROM person p[\s\S]*?WHERE p\.id = \?`/);
    expect(m, '未找到人员详情接口的 SELECT 语句').toBeTruthy();
    const sql = m![0];

    expect(sql).toContain('pd.person_id AS disability_person_id');
    expect(sql).toContain('pd.disability_type');
    expect(sql).toContain('pd.disability_level');
    expect(sql).toContain('pd.disability_card');
    expect(sql).toContain('pd.guardian_name');
    expect(sql).toContain('pd.guardian_phone');
    expect(sql).toContain('pd.remark AS disability_remark');
  });

  it('toPersonVO 读取的残疾字段与 SELECT 列名一一对应', () => {
    const voFields = ['disability_type', 'disability_level', 'disability_card', 'guardian_name', 'guardian_phone', 'disability_remark'];
    for (const f of voFields) {
      expect(querySrc).toContain(`row.${f}`);
    }
  });
});

describe('重点人群列表接口残疾档案列无条件返回', () => {
  it('fromSql 无条件 LEFT JOIN person_disability（不得按筛选条件省 JOIN）', () => {
    // fromSql 必须是常量字符串直接带 JOIN，不能依赖 needDisabilityJoin 之类的开关
    expect(keygroupSrc).toContain("const fromSql = 'FROM person p LEFT JOIN person_disability pd ON pd.person_id = p.id'");
    // 开关变量应已移除
    expect(keygroupSrc).not.toContain('needDisabilityJoin');
  });

  it('列表 SELECT 显式选取全部残疾档案列（含判定锚点列）', () => {
    expect(keygroupSrc).toContain('pd.person_id AS disability_person_id');
    expect(keygroupSrc).toContain('pd.disability_type');
    expect(keygroupSrc).toContain('pd.disability_level');
    expect(keygroupSrc).toContain('pd.disability_card');
    expect(keygroupSrc).toContain('pd.guardian_name');
    expect(keygroupSrc).toContain('pd.guardian_phone');
  });

  it('列表映射以 disability_person_id 锚点判断是否建档（而非依赖某字段非空）', () => {
    expect(keygroupSrc).toContain('r.disability_person_id ?');
  });
});
