import { activeSql } from './personStatus';
import { FLOATING_POP_CODE, HUKOU_POP_CODE } from '../config/tagCodes';
import { notSupersededByCodeSql } from './tagExclusive';

/**
 * 工作台「户籍人口 / 流动人口」两个计数的 SQL。
 *
 * 单独抽成纯函数的原因（不是为了好看）：互斥守卫必须写在 COUNT 子查询**内部**。
 * 一旦写成
 *
 *     (SELECT COUNT(*) FROM person p WHERE ... AND EXISTS (...))
 *       AND NOT EXISTS (...)               <-- 落到子查询外面
 *
 * 外层 SELECT 里并没有 person 表的别名 p，MySQL 会直接报
 * `Unknown column 'p.id' in 'where clause'`，整个 /statistics/dashboard 500，
 * 工作台所有卡片一起变 0，图表也一起空白 —— 而从「占位符数 === 参数数」这类
 * 形态检查上完全看不出来（括号是配平的，参数也确实对得上）。
 * 所以这里给单测留一个可以真正断言括号内外的入口。
 *
 * @param code 标签编码（HUKOU_POP / FLOATING_POP）
 * @returns 形如 `(SELECT COUNT(*) ... AND NOT EXISTS (...))` 的标量子查询
 */
export function buildTaggedActiveCountSql(code: string): string {
  // 先调一次取守卫片段：它内部对编码做白名单校验（非 [A-Z0-9_] 直接抛错），
  // 这样拼进 td.code = '...' 的字面量也一定是安全的。
  const guard = notSupersededByCodeSql(code, 'p.id');
  return `(SELECT COUNT(*) FROM person p
          WHERE ${activeSql('p')}
            AND EXISTS (SELECT 1 FROM person_tag pt
              JOIN tag_definition td ON td.id = pt.tag_id
              WHERE pt.person_id = p.id AND pt.status = 'ACTIVE' AND td.code = '${code}')
            AND ${guard})`;
}

/**
 * /statistics/dashboard 里 person 表的两个计数列。
 * 户籍与流动两侧**对称**都加守卫：只给一侧加，等于把「谁压制谁」写成了不对称的代码。
 */
export function buildHukouFloatingCountSql(): string {
  return `${buildTaggedActiveCountSql(HUKOU_POP_CODE)} AS hukou_count,
        ${buildTaggedActiveCountSql(FLOATING_POP_CODE)} AS floating_count`;
}
