import { activeSql } from './personStatus';

/**
 * 「在册家庭」的**唯一口径**：家庭未停用，且至少有一名在册成员。
 *
 * 为什么要有这个文件：
 * 家庭数原本只写 `family.status = 1`，而 status 从来没有代码去置 0 —— 于是
 * 独居老人登记死亡后，人已经从所有人口统计里退出，他那一户却仍被算作一户家庭，
 * 工作台的「家庭总数」只增不减。反过来，如果改成「人员状态变更时去写
 * family.status = 0」，就等于让 5 条写入路径（单条状态、批量状态、导入建档、
 * 待核查确认、手工移出成员）各自维护同一份事实，漏一条就再次对不上。
 *
 * 所以这里改成**派生**：家庭有没有人，由 family_member × person 现算，
 * 不落任何冗余状态。人员改回在册时家庭自动复活，不需要「恢复」代码。
 *
 * `family.status = 1` 仍然参与判断（保留「手工停用某户」的能力），
 * 但不再是充分条件。
 *
 * ⚠️ 新增任何「数家庭」的地方都必须用 activeFamilySql()，不要手写 status = 1。
 * 回归见 test/familySql.test.ts。
 */

/** 子查询内部固定别名，避免与外层 f / p 冲突（外层会传自己的家庭表别名） */
const MEMBER_ALIAS = 'fm_chk';
const PERSON_ALIAS = 'p_chk';

/**
 * 「该家庭至少有一名在册成员」的相关子查询。
 * @param familyAlias 外层 family 表的别名
 */
export function familyHasActiveMemberSql(familyAlias = 'f'): string {
  return `EXISTS (
            SELECT 1 FROM family_member ${MEMBER_ALIAS}
              JOIN person ${PERSON_ALIAS} ON ${PERSON_ALIAS}.id = ${MEMBER_ALIAS}.person_id
             WHERE ${MEMBER_ALIAS}.family_id = ${familyAlias}.id
               AND ${MEMBER_ALIAS}.status = 1
               AND ${activeSql(PERSON_ALIAS)}
          )`;
}

/** 在册家庭条件：未停用 + 至少一名在册成员 */
export function activeFamilySql(familyAlias = 'f'): string {
  return `${familyAlias}.status = 1 AND ${familyHasActiveMemberSql(familyAlias)}`;
}

/**
 * 家庭成员计数（只数在册成员）。
 * 与 activeFamilySql 同源：家庭列表「人数」列不能把已故/已迁出的人算进去，
 * 否则列表里会出现「1 人」但该户不计入家庭总数的自相矛盾。
 */
export function activeMemberCountSql(familyAlias = 'f'): string {
  return `(SELECT COUNT(*) FROM family_member ${MEMBER_ALIAS}
             JOIN person ${PERSON_ALIAS} ON ${PERSON_ALIAS}.id = ${MEMBER_ALIAS}.person_id
            WHERE ${MEMBER_ALIAS}.family_id = ${familyAlias}.id
              AND ${MEMBER_ALIAS}.status = 1
              AND ${activeSql(PERSON_ALIAS)})`;
}
