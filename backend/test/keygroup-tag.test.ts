import { describe, it, expect } from 'vitest';
import { resolveTagEntries, loadKeyGroupTagDictFromRows } from '../src/modules/excel';

/**
 * 类别词典的构建与解析。曾有缺陷：类别 → 标签编码写死在代码里，
 * 导致在「人口标签」中新增的标签名单导入时无法识别（报「无法识别的人员类别」）。
 */
describe('重点人群名单：人员类别解析', () => {
  const rows = [
    { id: 1, code: 'PARTY_MEMBER', name: '党员', alias: '', enabled: 1, need_audit: 0 },
    { id: 2, code: 'VETERAN', name: '退役军人', alias: '退伍军人', enabled: 1, need_audit: 0 },
    // 系统上新增的标签（不在内置别名表中），必须同样能命中
    { id: 99, code: 'LEFT_BEHIND_WOMEN', name: '留守妇女', alias: '留守妇女、留守妇女儿童', enabled: 1, need_audit: 0 },
  ];
  const dict = loadKeyGroupTagDictFromRows(rows);

  it('内置标签可按名称与编码命中', () => {
    expect(resolveTagEntries('党员', dict).defs.map((d) => d.code)).toEqual(['PARTY_MEMBER']);
    expect(resolveTagEntries('PARTY_MEMBER', dict).defs.map((d) => d.code)).toEqual(['PARTY_MEMBER']);
    expect(resolveTagEntries('party_member', dict).defs.map((d) => d.code)).toEqual(['PARTY_MEMBER']);
  });

  it('新增的标签按名称 / 别名 / 编码都能命中', () => {
    expect(resolveTagEntries('留守妇女', dict).defs.map((d) => d.id)).toEqual([99]);
    expect(resolveTagEntries('LEFT_BEHIND_WOMEN', dict).defs.map((d) => d.id)).toEqual([99]);
    expect(resolveTagEntries('留守妇女儿童', dict).defs.map((d) => d.id)).toEqual([99]);
  });

  it('内置别名仍然可用（如「退伍军人」「五保户」类叫法）', () => {
    expect(resolveTagEntries('退伍军人', dict).defs.map((d) => d.code)).toEqual(['VETERAN']);
  });

  it('多类别去重，且无法识别的项原样返回', () => {
    const r = resolveTagEntries('退役军人,党员，退役', dict);
    expect(r.defs.map((d) => d.code)).toEqual(['VETERAN', 'PARTY_MEMBER']);
    const bad = resolveTagEntries('党员，临时救助', dict);
    expect(bad.defs.map((d) => d.code)).toEqual(['PARTY_MEMBER']);
    expect(bad.unknown).toEqual(['临时救助']);
  });

  it('停用标签仍进入词典（由导入流程给出明确提示，而非「无法识别」）', () => {
    const offDict = loadKeyGroupTagDictFromRows([
      { id: 5, code: 'DISABLED_PERSON', name: '残疾人', alias: '', enabled: 0, need_audit: 1 },
    ]);
    const r = resolveTagEntries('残疾人', offDict);
    expect(r.unknown).toEqual([]);
    expect(r.defs[0]).toMatchObject({ id: 5, enabled: false, needAudit: true });
  });
});
