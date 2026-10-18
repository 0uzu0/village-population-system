import { describe, it, expect } from 'vitest';
import { buildHukouFloatingCountSql, buildTaggedActiveCountSql } from '../src/utils/statisticsSql';

/**
 * 这组用例锁的是一件很容易写错、而且**其他检查都抓不到**的事：
 * 互斥守卫（NOT EXISTS）必须写在 COUNT 子查询**内部**。
 *
 * v2.2.0 首发就栽在这里：守卫被写到了子查询外面，
 * SQL 变成 `SELECT (SELECT COUNT(*) ...) AND NOT EXISTS (...)`，
 * 外层 SELECT 里没有 person 别名 p，MySQL 报
 * `Unknown column 'p.id' in 'where clause'`，/statistics/dashboard 整体 500，
 * 工作台所有卡片一起显示 0。
 *
 * 当时的检查为什么没发现：
 * - 括号总数是配平的（`)` 从子查询末尾挪到了守卫后面，一进一出），
 * - 占位符数与参数数也仍然相等（守卫片段不含占位符），
 * - node-sql-parser 也解析通过（这个写法语法合法，只是作用域错）。
 *
 * 所以判据不能是「括号配平」，也不能是「p.id 的括号深度」——守卫自身的
 * `NOT EXISTS (` 也会把深度抬到 1，两种写法都通不过区分。
 * 真正的判据是：计数表达式必须是一个**单一配平的括号组**，
 * 即括号余额只在表达式的最后一个字符处回到 0，中途绝不归零。
 * 守卫被挪到外面时，余额会在守卫之前先归零一次，这条断言就会失败。
 */

/** 返回括号余额归零处的下标列表（末尾那个是「表达式结束」） */
function zeroCrossings(segment: string): number[] {
  const zeros: number[] = [];
  let bal = 0;
  for (let i = 0; i < segment.length; i++) {
    const ch = segment[i];
    if (ch === '(') bal++;
    else if (ch === ')') {
      bal--;
      if (bal === 0) zeros.push(i);
    }
  }
  return zeros;
}

describe('工作台户籍/流动计数的 SQL', () => {
  it('每个计数表达式都是单一配平的括号组（守卫必须在子查询内部）', () => {
    // 逐个编码单独构造，避免把「上一列的括号」也算进来
    for (const code of ['HUKOU_POP', 'FLOATING_POP']) {
      const expr = buildTaggedActiveCountSql(code).trim();
      expect(expr.startsWith('(')).toBe(true);
      expect(expr.endsWith(')')).toBe(true);
      const zeros = zeroCrossings(expr);
      // 只在最后一个字符处归零；中途归零 = 守卫落到了子查询外面
      expect(zeros).toEqual([expr.length - 1]);
    }
  });

  it('两列都带别名，拼进同一条 SELECT', () => {
    const sql = buildHukouFloatingCountSql();
    expect(sql).toMatch(/\)\s*AS hukou_count/);
    expect(sql).toMatch(/\)\s*AS floating_count/);
  });

  it('两侧对称都加互斥守卫，且判定来自互斥列而非硬编码编码', () => {
    const sql = buildHukouFloatingCountSql();
    expect((sql.match(/NOT EXISTS/g) || []).length).toBe(2);
    expect(sql).toContain('td_g.exclusive_group');
    expect(sql).toContain('td_g.exclusive_priority < td_self.exclusive_priority');
  });

  it('COUNT 子查询与守卫引用的是同一个 person 别名', () => {
    const expr = buildTaggedActiveCountSql('HUKOU_POP');
    // FROM person p 只有一处，守卫里的人必须也是 p.id，不能是别的别名
    expect((expr.match(/FROM person p\b/g) || []).length).toBe(1);
    expect(expr).toContain('pt_g.person_id = p.id');
  });

  it('只数在册人员（activeSql 生效）', () => {
    // activeSql 的口径是「状态在册」，具体取值由 utils/personStatus 决定，
    // 这里只断言它确实被拼进去了，不锁具体枚举值（口径改过一次，别再写死）。
    const sql = buildTaggedActiveCountSql('HUKOU_POP');
    expect(sql).toMatch(/p\.status\s+IN\s*\(/);
  });

  it('编码字面量走白名单校验，注入字符串直接抛错', () => {
    expect(() => buildTaggedActiveCountSql("X' OR 1=1 --")).toThrow();
  });
});
