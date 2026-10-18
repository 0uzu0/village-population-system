/**
 * 户籍人口 / 流动人口口径的**唯一实现**。
 *
 * 定义（2026-10 v2.1.0 起）：
 * - 户籍人口 = 户籍在本村的人员
 * - 流动人口 = 户籍不在本村、暂住本村的人员
 * - 总人口 = 户籍人口 + 流动人口，两者**互斥、不存在交叉**
 *
 * 为什么要有这个文件：同一个「流动人口」在三个地方各算了一遍——
 * 工作台统计（statistics.ts）、标签管理的人数（tag.ts）、人员列表按标签筛选
 * （person.ts / excel 导出）。三处只要有一处多一个条件，用户在两个屏上看到
 * 的就是两个数，而这种「差几个人」的错最难被发现、也最伤害信任。
 *
 * 写入侧（person.ts 的 syncPersonTags / deactivateHukouFloatingCounterpart）
 * 保证新数据互斥，但**历史数据与批量导入仍可能让一人同时挂着两类标签**，
 * 所以读数侧统一采用「户籍优先」的判定：**只要该人有生效的户籍人口标签，
 * 他的流动人口标签就不计入流动人口**。
 */

export const HUKOU_POP_CODE = 'HUKOU_POP';
export const FLOATING_POP_CODE = 'FLOATING_POP';

/**
 * 「此人是户籍人口」的 SQL 存在性子查询。
 * @param personIdExpr 被判定人员 id 的 SQL 表达式，如 `p.id`、`pt.person_id`
 */
export function hukouPersonExistsSql(personIdExpr: string): string {
  return `EXISTS (
    SELECT 1 FROM person_tag pt_h
    JOIN tag_definition td_h ON td_h.id = pt_h.tag_id
    WHERE pt_h.person_id = ${personIdExpr} AND pt_h.status = 'ACTIVE'
      AND td_h.code = '${HUKOU_POP_CODE}'
  )`;
}

/**
 * 「此人不是户籍人口」的 SQL 条件——流动人口统计 / 筛选用它做户籍优先排除。
 */
export function notHukouPersonSql(personIdExpr: string): string {
  return `NOT ${hukouPersonExistsSql(personIdExpr)}`;
}

/**
 * 标签人数统计的户籍优先守卫（给 tag.ts 的 person_count 子查询追加的条件）。
 *
 * @param codeExpr 当前标签行的 code 表达式（tag.ts 里是 `td.code`）
 * @param personIdExpr 被统计人员 id 的表达式（`pt.person_id`）
 *
 * 只对「流动人口」这一枚标签生效：其它标签（党员/残疾/…）原样计数，
 * 因为它们本来就允许与户籍/流动交叉。
 */
export function tagPersonCountExclusiveGuard(codeExpr: string, personIdExpr: string): string {
  return `AND NOT (${codeExpr} = '${FLOATING_POP_CODE}' AND ${hukouPersonExistsSql(personIdExpr)})`;
}

/** mysql2 风格连接（pool / 事务 conn 均可，query 返回 [rows, fields]） */
type DbLike = { query: (sql: string, params?: any[]) => Promise<any> };

/** 把 [rows, fields] 与纯 rows 两种返回形状归一 */
function rowsOf(res: any): any[] {
  return Array.isArray(res) && Array.isArray(res[0]) ? res[0] : res;
}

/** 单批修复的人员上限（与 SQL 占位符长度对齐，避免超长语句） */
const REPAIR_CHUNK = 500;

/**
 * 按「户籍优先」修复给定人员的户籍/流动双标签（幂等，可反复调用）。
 *
 * 用途：
 * - 批量导入（重点人群名单 / 特殊人群）写入标签后统一收口——那两条路径
 *   是按文件里的标签直接 INSERT，绕过了 person.ts 的互斥逻辑；
 * - 需要一次性清理存量时由迁移脚本（V019）做同口径的 SQL 处理。
 *
 * 返回被停用的流动标签条数，便于导入结果里给出「口径修正 N 条」。
 */
export async function repairHukouFloatingExclusive(
  db: DbLike,
  personIds: number[],
  userId: number | null,
  remark: string
): Promise<number> {
  const ids = [...new Set(personIds.filter((id) => Number.isFinite(id) && id > 0))];
  if (!ids.length) return 0;

  let repaired = 0;
  for (let i = 0; i < ids.length; i += REPAIR_CHUNK) {
    const chunk = ids.slice(i, i + REPAIR_CHUNK);
    const ph = chunk.map(() => '?').join(',');

    // 先查出「同时挂着两类标签」的流动标签行，再按 id 精确停用——
    // 这样既知道该留哪些痕，也不会碰到其它标签。
    const rows = rowsOf(
      await db.query(
        `SELECT pt.id, pt.person_id, pt.tag_id
           FROM person_tag pt
           JOIN tag_definition td ON td.id = pt.tag_id
          WHERE pt.person_id IN (${ph})
            AND pt.status = 'ACTIVE'
            AND td.code = '${FLOATING_POP_CODE}'
            AND ${hukouPersonExistsSql('pt.person_id')}`,
        chunk
      )
    );
    if (!rows?.length) continue;

    const rowIds = rows.map((r: any) => Number(r.id));
    const rowPh = rowIds.map(() => '?').join(',');
    await db.query(
      `UPDATE person_tag SET status = 'INACTIVE', expire_date = CURDATE() WHERE id IN (${rowPh})`,
      rowIds
    );
    if (userId != null) {
      await db.query(
        `INSERT INTO tag_change_log (object_type, object_id, tag_id, action, operator_id, remark)
         VALUES ${rows.map(() => `('PERSON', ?, ?, 'REMOVE', ?, ?)`).join(', ')}`,
        rows.flatMap((r: any) => [Number(r.person_id), Number(r.tag_id), userId, remark])
      );
    }
    repaired += rowIds.length;
  }
  return repaired;
}
