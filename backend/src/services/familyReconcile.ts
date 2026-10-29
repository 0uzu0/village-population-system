/**
 * 「人员档案 ↔ 家庭成员」两表对账。
 *
 * 为什么需要它：
 * `person.relation` 与 `family_member.relation` 是同一个事实的两份存储。
 * 写入路径（新建人员、编辑人员、建户、并户、导入归户、移出成员）现在都会
 * 同时维护两张表，但那是**近两年才收口**的；更早的导入批次只写了 person，
 * 家庭成员表是后来批量归户补出来的。于是库里会存在三类历史错位：
 *
 * 1. 关系值不同（person 说「妻」，家庭说「CHILD」）；
 * 2. 人在某户在户，但 `person.family_id` 是空的（家庭页能看见他，人员列表
 *    却按「未归户」统计）；
 * 3. 同一个人在两户都算在户、一户里没有户主或有两个户主。
 *
 * 这些错位不会抛异常，只会让「家庭人数」「按户筛选」「导出名单」三者对不上，
 * 而错的那一方永远是随机的——取决于那次写入走的是哪条路径。
 *
 * 判定口径：
 * - 这里的「在户」只取 `family_member.status = 1`（关联层在户）。人员本身是否在册
 *   **不混进其他分类**，而是单独列为 status_drift —— 否则「关系值不一致」会连带
 *   报出一堆早已过世的人，把真正需要处理的错位淹没掉。
 * - 反过来，除 status_drift 以外的六类**都必须加在册过滤**（`activeSql`）：
 *   死亡/迁出的人只改状态不删档案，`person.family_id` 会一直留着，而关联行已在
 *   迁出/死亡时关闭。少了这层过滤，「有归属却无在户记录」会把**全部死者**报成错位
 *   （线上实测 72 条全是 DEAD），「户主数不是 1」也会把只剩死者的空壳户全算进来。
 *   一句话：**非在册人员不是错位，是历史**。
 * - **`family_member` 是权威**，`person.relation` 是它的冗余副本。这与
 *   family.ts / person.ts 现有的写同步方向一致（先写关联表再回写人员表）。
 *   所以能自动修的只有「人员表跟不上关联表」这一类，反向不做。
 *
 * 不能自动修的一律只报告：多户在户、户主不唯一、归属冲突这三种无论怎么改
 * 都是「猜」，猜错会造出更难看的数据，必须人来定。
 */

import { query } from '../config/db';
import { activeSql } from '../utils/personStatus';

/** 一条对账项 */
export interface ReconcileCategory {
  key: string;
  title: string;
  /** 为什么这是问题：直接展示给运维/AI，避免只看到数字不知道要不要管 */
  why: string;
  /** 是否可由迁移 V029 自动修复 */
  autoFixable: boolean;
  count: number;
  /** 前 N 条明细，够判断性质即可，不追求全量导出 */
  samples: Record<string, any>[];
}

interface DiffQuery {
  key: string;
  title: string;
  why: string;
  autoFixable: boolean;
  /** 判定 SQL：不带 ORDER BY / LIMIT，计数与样本都从它派生，保证两者永远同一口径 */
  sql: string;
  orderBy: string;
}

/**
 * 七个判定。SQL 与 V029 迁移里的修复条件必须对应，改动时两边一起改（见测试）
 */
const DIFFS: DiffQuery[] = [
  {
    key: 'relation_diff',
    title: '关系值两表不一致',
    why: '在册人员在户，但人员档案上的「与户主关系」与家庭成员表不同。人员列表、导出用的是 person，家庭页用的是 family_member，于是同一个人两处显示不同。',
    autoFixable: true,
    sql: `SELECT p.id AS personId, p.name, p.relation AS personRelation,
                 fm.relation AS memberRelation, fm.family_id AS familyId, f.family_no AS familyNo
            FROM person p
            JOIN family_member fm ON fm.person_id = p.id AND fm.status = 1
            JOIN family f ON f.id = fm.family_id
           WHERE p.family_id = fm.family_id
             AND ${activeSql('p')}
             AND NOT (p.relation <=> fm.relation)`,
    orderBy: 'p.id',
  },
  {
    key: 'member_without_family',
    title: '在户却没有家庭归属',
    why: '家庭成员表说他在这一户，但人员档案的 family_id 是空的。表现是家庭页能看见他、人员列表按「未归户」筛却能筛出他。只统计在册人员。',
    autoFixable: true,
    sql: `SELECT p.id AS personId, p.name, p.relation, fm.family_id AS memberFamilyId,
                 f.family_no AS familyNo
            FROM person p
            JOIN family_member fm ON fm.person_id = p.id AND fm.status = 1
            JOIN family f ON f.id = fm.family_id
           WHERE p.family_id IS NULL AND ${activeSql('p')}`,
    orderBy: 'p.id',
  },
  {
    key: 'family_without_member',
    title: '有家庭归属却无在户记录',
    why: '在册人员档案挂在这一户，但家庭成员表里没有他的在户行。家庭详情里看不到他，家庭人数少算，导出却算上了。已死亡/迁出的人不属于此类（他们本来就该关闭关联）。',
    autoFixable: false,
    sql: `SELECT p.id AS personId, p.name, p.family_id AS familyId, p.relation, f.family_no AS familyNo
            FROM person p
            LEFT JOIN family_member fm ON fm.person_id = p.id AND fm.status = 1
            LEFT JOIN family f ON f.id = p.family_id
           WHERE p.family_id IS NOT NULL AND fm.id IS NULL AND ${activeSql('p')}`,
    orderBy: 'p.id',
  },
  {
    key: 'family_conflict',
    title: '两表指向不同家庭',
    why: '在册人员在户于 A 户，档案却挂在 B 户。无论按哪一边统计，另一边都是错的，必须人工确认他到底在哪一户。',
    autoFixable: false,
    sql: `SELECT p.id AS personId, p.name, p.family_id AS personFamilyId,
                 fm.family_id AS memberFamilyId, f2.family_no AS memberFamilyNo
            FROM person p
            JOIN family_member fm ON fm.person_id = p.id AND fm.status = 1
            JOIN family f2 ON f2.id = fm.family_id
           WHERE p.family_id IS NOT NULL AND fm.family_id <> p.family_id AND ${activeSql('p')}`,
    orderBy: 'p.id',
  },
  {
    key: 'multi_family',
    title: '一人在多户在户',
    why: '同一在册人员在两个及以上家庭里都在户，家庭人数会重复计算。多半是并户/拆分时漏了关闭旧关联。',
    autoFixable: false,
    sql: `SELECT p.id AS personId, p.name, COUNT(*) AS familyCount,
                 GROUP_CONCAT(DISTINCT fm.family_id) AS familyIds
            FROM family_member fm
            JOIN person p ON p.id = fm.person_id
           WHERE fm.status = 1 AND ${activeSql('p')}
           GROUP BY p.id, p.name
          HAVING COUNT(*) > 1`,
    orderBy: 'familyCount DESC, p.id',
  },
  {
    key: 'head_anomaly',
    title: '户主数量不是 1',
    why: '有在册成员的户里，户主数量不是 1：没有户主（家庭页显示「—」，导出名单缺户主行）或有两个以上户主（谁是户主取决于查询顺序）。只剩已死亡/迁出人员的空壳户不计入——那种户本就无人在册，不该有人催补户主。',
    autoFixable: false,
    sql: `SELECT f.id AS familyId, f.family_no AS familyNo,
                 COALESCE(SUM(fm.is_householder = 1), 0) AS headCount,
                 COUNT(fm.id) AS memberCount
            FROM family f
            JOIN family_member fm ON fm.family_id = f.id AND fm.status = 1
            JOIN person p ON p.id = fm.person_id AND ${activeSql('p')}
           WHERE f.status = 1
           GROUP BY f.id, f.family_no
          HAVING COALESCE(SUM(fm.is_householder = 1), 0) <> 1`,
    orderBy: 'headCount DESC, f.id',
  },
  {
    key: 'status_drift',
    title: '已迁出/死亡却仍标记在户',
    why: '人员已不在册，家庭成员关联还留着在户标记。这类户会让 activeFamilySql 之外的旧查询把家庭算多，也是「家庭数只增不减」的老病根。',
    autoFixable: false,
    sql: `SELECT p.id AS personId, p.name, p.status AS personStatus,
                 fm.id AS memberId, fm.family_id AS familyId
            FROM family_member fm
            JOIN person p ON p.id = fm.person_id
           WHERE fm.status = 1 AND NOT (${activeSql('p')})`,
    orderBy: 'p.id',
  },
];

export interface ReconcileResult {
  generatedAt: string;
  /** 规模参考：对账结论要能一眼看出分母 */
  scale: {
    person: number;
    activePerson: number;
    family: number;
    familyMember: number;
  };
  /** 有问题的人次合计（各分类可能重叠，不能相加当人数用） */
  issueCategories: number;
  categories: ReconcileCategory[];
}

/** 计数与样本都从同一段 SQL 派生——分两次写条件，迟早会漂 */
async function measure(diff: DiffQuery, limit: number): Promise<ReconcileCategory> {
  const [countRow] = await query<{ c: number }>(`SELECT COUNT(*) AS c FROM (${diff.sql}) t`);
  const count = Number(countRow?.c ?? 0);
  const samples = count ? await query(diff.sql + ` ORDER BY ${diff.orderBy} LIMIT ${limit}`) : [];
  return {
    key: diff.key,
    title: diff.title,
    why: diff.why,
    autoFixable: diff.autoFixable,
    count,
    samples: samples as Record<string, any>[],
  };
}

/**
 * 执行一次对账。
 * @param limit 每类返回多少条明细（1~200），只为判断性质，不做全量导出
 */
export async function reconcileFamily(limit = 20): Promise<ReconcileResult> {
  const n = Math.min(Math.max(Math.trunc(limit) || 20, 1), 200);

  const [scale] = await query<any>(`SELECT
      (SELECT COUNT(*) FROM person) AS person,
      (SELECT COUNT(*) FROM person p WHERE ${activeSql('p')}) AS activePerson,
      (SELECT COUNT(*) FROM family WHERE status = 1) AS family,
      (SELECT COUNT(*) FROM family_member WHERE status = 1) AS familyMember`);

  const categories: ReconcileCategory[] = [];
  for (const diff of DIFFS) {
    categories.push(await measure(diff, n));
  }

  return {
    generatedAt: new Date().toISOString(),
    scale: {
      person: Number(scale?.person ?? 0),
      activePerson: Number(scale?.activePerson ?? 0),
      family: Number(scale?.family ?? 0),
      familyMember: Number(scale?.familyMember ?? 0),
    },
    issueCategories: categories.filter((c) => c.count > 0).length,
    categories,
  };
}

/** 供测试检查判定条件是否与迁移同步，不在业务里调用 */
export const __diffSpecs = DIFFS;
