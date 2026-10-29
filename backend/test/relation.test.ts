import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { RELATION_CODES, RELATION_LABELS, normalizeRelation, relationLabel } from '../src/utils/relation';

/**
 * 「与户主关系」归一的回归测试。
 *
 * 背景：Excel 导入只把「户主」换成 HEAD，其余中文原样入库，实测 1200 人里 56% 是中文
 *（妻 / 长女 / 儿媳 / 其他非亲属…），而网页下拉只产出枚举码。同一列两套写法带来三个后果：
 *   1. 前端按枚举渲染时中文只能原样透出；
 *   2. 「户主判定 relation === 'HEAD'」会漏掉「本人」这类写法；
 *   3. person 与 family_member 两处取值口径不一致。
 *
 * 这组测试盯住四条：
 *   A. 归一函数本身的行为（含未知值兜底）；
 *   B. 生产抽样里出现过的每种写法都能落进正确的码（防止改映射时误伤）；
 *   C. 迁移 SQL 的 CASE 分支与 TS 映射表逐条一致（两边最容易各改各的）；
 *   D. 旧的「只映射户主」写法不许复活。
 */

const BACKEND = path.resolve(__dirname, '..');
const REPO = path.resolve(BACKEND, '..');
const SRC = path.join(BACKEND, 'src');

function walk(dir: string, exts: string[], out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, exts, out);
    else if (exts.some((e) => entry.name.endsWith(e))) out.push(full);
  }
  return out;
}

describe('关系归一：通用行为', () => {
  it('枚举码原样通过，大小写与空格不敏感', () => {
    for (const code of RELATION_CODES) {
      expect(normalizeRelation(code)).toBe(code);
      expect(normalizeRelation(` ${code.toLowerCase()} `)).toBe(code);
    }
  });

  it('空值返回 null（落库默认值由调用方决定，family_member.relation 是 NOT NULL）', () => {
    expect(normalizeRelation(null)).toBeNull();
    expect(normalizeRelation(undefined)).toBeNull();
    expect(normalizeRelation('')).toBeNull();
    expect(normalizeRelation('   ')).toBeNull();
  });

  it('不认识的中文落 OTHER，不抛错也不保留原文', () => {
    // 导入要能跑完整批，单个脏值不该让整批失败
    expect(normalizeRelation('隔壁老王')).toBe('OTHER');
    expect(normalizeRelation('前夫')).toBe('OTHER');
  });

  it('展示文案覆盖全部码，且未知码原样返回', () => {
    for (const code of RELATION_CODES) {
      expect(RELATION_LABELS[code]).toBeTruthy();
      expect(relationLabel(code)).toBe(RELATION_LABELS[code]);
    }
    expect(relationLabel('FUTURE_CODE')).toBe('FUTURE_CODE');
    expect(relationLabel(null)).toBe('—');
  });
});

describe('关系归一：生产抽样里的写法都要落到正确的码', () => {
  // 2026-10-29 从线上抽样 1200 人统计到的全部写法，按出现频率排序
  const OBSERVED: [string, string][] = [
    ['妻', 'SPOUSE'],
    ['子', 'CHILD'],
    ['女', 'CHILD'],
    ['儿媳', 'CHILD_IN_LAW'],
    ['孙女', 'GRANDCHILD'],
    ['其他非亲属', 'OTHER'],
    ['二女', 'CHILD'],
    ['孙子', 'GRANDCHILD'],
    ['夫', 'SPOUSE'],
    ['长女', 'CHILD'],
    ['外孙子', 'GRANDCHILD'],
    ['外孙女', 'GRANDCHILD'],
    ['长子', 'CHILD'],
    ['母亲', 'PARENT'],
    ['次子', 'CHILD'],
    ['养女', 'CHILD'],
    ['女婿', 'CHILD_IN_LAW'],
    ['养子或继子', 'CHILD'],
    ['父亲', 'PARENT'],
    ['侄子', 'OTHER'],
    ['妹妹', 'SIBLING'],
    ['三女', 'CHILD'],
  ];

  it.each(OBSERVED)('%s → %s', (raw, code) => {
    expect(normalizeRelation(raw)).toBe(code);
  });

  it('没有一种抽样写法被落成原样（这是本次修复的核心）', () => {
    const leaked = OBSERVED.filter(([raw]) => normalizeRelation(raw) === raw);
    expect(leaked, '这些写法仍然原样返回，说明映射缺失').toEqual([]);
  });
});

describe('迁移 SQL 与 TS 映射表必须逐条一致', () => {
  const sql = fs.readFileSync(path.join(SRC, 'db/migrations/V028__relation_normalize.sql'), 'utf8');

  /**
   * 抽取 `UPDATE ... SET relation = 'CODE' WHERE TRIM(relation) IN ('中文','中文')` 的映射对。
   * 迁移刻意不写成一条大 CASE（少个逗号就是语法错，而它会在容器启动时自动跑），
   * 所以这里按「码 → 中文列表」解析。
   */
  function sqlMappings(table: 'person' | 'family_member'): [string, string][] {
    const pairs: [string, string][] = [];
    const re = new RegExp(
      `UPDATE\\s+\`${table}\`\\s+SET\\s+\`relation\`\\s+=\\s+'([A-Z_]+)'\\s+WHERE\\s+TRIM\\(\`relation\`\\)\\s+IN\\s+\\(([^)]*)\\)`,
      'g'
    );
    for (const m of sql.matchAll(re)) {
      for (const w of m[2].matchAll(/'([^']+)'/g)) pairs.push([w[1], m[1]]);
    }
    return pairs;
  }

  it('两张表的映射都覆盖全部 8 个码', () => {
    for (const table of ['person', 'family_member'] as const) {
      const codes = new Set(sqlMappings(table).map(([, c]) => c));
      expect([...codes].sort(), `${table} 缺少某些码的映射`).toEqual([...RELATION_CODES].sort());
    }
  });

  it('SQL 里的每一对映射都与 TS 的 normalizeRelation 结果相同', () => {
    const pairs = sqlMappings('person');
    expect(pairs.length).toBeGreaterThan(40); // 防止正则失效后静默全绿
    const wrong = pairs.filter(([raw, code]) => normalizeRelation(raw) !== code);
    expect(wrong, '迁移把某个写法归错码了，或 TS 改了映射没同步迁移').toEqual([]);
  });

  it('两张表的映射表完全一致（不允许只改一边）', () => {
    expect(sqlMappings('family_member').sort()).toEqual(sqlMappings('person').sort());
  });

  it('TS 认识的常见写法在迁移里都有，不会漏归', () => {
    // 反向覆盖：SQL 缺一条，存量数据就会落到兜底的 OTHER 里
    const inSql = new Set(sqlMappings('person').map(([raw]) => raw));
    expect(missingFromSql(inSql), '这些写法迁移里没有，存量数据会归错').toEqual([]);
  });

  /** 抽样集 + 若干常见写法，都应在迁移里出现 */
  function missingFromSql(inSql: Set<string>): string[] {
    const mustHave = [
      '户主',
      '本人',
      '配偶',
      '妻',
      '夫',
      '妻子',
      '丈夫',
      '子',
      '女',
      '儿子',
      '女儿',
      '长子',
      '次子',
      '长女',
      '次女',
      '二女',
      '三女',
      '养子',
      '养女',
      '继子',
      '继女',
      '养子或继子',
      '子女',
      '儿媳',
      '女婿',
      '孙子',
      '孙女',
      '外孙子',
      '外孙女',
      '父',
      '母',
      '父亲',
      '母亲',
      '父母',
      '兄',
      '弟',
      '姐',
      '妹',
      '妹妹',
      '其他',
      '其他非亲属',
      '非亲属',
    ];
    return mustHave.filter((k) => !inSql.has(k));
  }

  it('迁移是幂等的：只挑「还不是合法码」的行', () => {
    // 这条守着「部署后重复执行不会把已归一的码再改一遍」
    expect(sql).toMatch(/UPPER\(TRIM\(`relation`\)\) NOT IN \('HEAD','SPOUSE'/);
  });

  it('迁移只做 DML，不含 DDL（否则 MySQL 隐式提交，失败无法回滚）', () => {
    expect(/^\s*(ALTER|CREATE|DROP|TRUNCATE)\s/im.test(sql)).toBe(false);
  });

  it('字典补的码与 RELATION_LABELS 一致', () => {
    const inserted: [string, string][] = [];
    for (const m of sql.matchAll(/\('relation',\s*'([^']+)',\s*'([A-Z_]+)',\s*\d+\)/g)) {
      inserted.push([m[2], m[1]]); // [code, label]
    }
    expect(inserted.length).toBe(3);
    for (const [code, label] of inserted) {
      expect(RELATION_CODES).toContain(code as never);
      expect(RELATION_LABELS[code as never]).toBe(label);
    }
  });
});

describe('前端选项表与后端码表不许漂移', () => {
  it('frontend/src/utils/format.ts 的 RELATION_OPTIONS 与 RELATION_CODES 完全对应', () => {
    const src = fs.readFileSync(path.join(REPO, 'frontend/src/utils/format.ts'), 'utf8');
    const block = src.slice(src.indexOf('RELATION_OPTIONS'));
    const values: string[] = [];
    for (const m of block.matchAll(/\{\s*value:\s*'([A-Z_]+)',\s*label:\s*'([^']+)'\s*\}/g)) {
      values.push(m[1]);
    }
    expect(values, '前端选项数量或顺序与后端不一致，界面会显示英文码').toEqual([...RELATION_CODES]);
  });
});

describe('写入路径必须走归一函数', () => {
  const readSrc = (rel: string) => fs.readFileSync(path.join(SRC, rel), 'utf8');

  it('Excel 导入：不再只映射「户主」', () => {
    const src = readSrc('modules/excel/importPerson.ts');
    expect(src).toMatch(/relation:\s*normalizeRelation\(row\['与户主关系'\]\)/);
    // 旧写法：三元里只判「户主」，其余原样
    expect(src).not.toMatch(/=== '户主' \? 'HEAD'/);
  });

  it('待核查转正：中文不会顺着这条路流回人员档案', () => {
    const src = readSrc('modules/pending.ts');
    expect(src).toMatch(/normalizeRelation\(p\.relation\)/);
    expect(src).not.toMatch(/p\.relation === '户主'/);
  });

  it('人员新增/编辑：在 schema 层收口', () => {
    const src = readSrc('modules/person.ts');
    expect(src).toMatch(/transform\(\(v\) => \(v === undefined \? undefined : normalizeRelation\(v\)\)\)/);
  });

  it('家庭成员添加：在 schema 层收口，空值兜 OTHER', () => {
    const src = readSrc('modules/family.ts');
    expect(src).toMatch(/transform\(\(v\) => normalizeRelation\(v\) \?\? 'OTHER'\)/);
  });

  it('全项目扫描：没有第二处「=== 户主 ? HEAD」这种半映射', () => {
    // 这是本次 bug 的形态，防止有人在新代码里再抄一遍
    const offenders = walk(SRC, ['.ts'])
      .filter((f) => !f.endsWith('utils/relation.ts'))
      .filter((f) => /===\s*'户主'\s*\?/.test(fs.readFileSync(f, 'utf8')))
      .map((f) => path.relative(REPO, f));
    expect(offenders, '请改用 normalizeRelation，不要自己判「户主」').toEqual([]);
  });
});
