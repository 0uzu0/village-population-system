import mysql, { Pool, PoolConnection, RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import { env } from './env';
import { logger } from '../utils/logger';

/**
 * 慢 SQL 阈值（毫秒）。超过即在 stderr 打一条 warn 日志，便于排查「接口莫名变慢」。
 * 设 0 可关闭。默认 200ms——本系统数据量在万级，超过 200ms 的查询基本都有优化空间。
 */
const SLOW_SQL_MS = Number(process.env.SLOW_SQL_MS ?? 200);

/** 压成一行并截断，避免超长 SQL 把日志撑爆 */
function summarizeSql(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim().slice(0, 200);
}

/**
 * 计时执行。注意**只记录参数个数，不记录参数值**——
 * 参数里常有身份证号、手机号等敏感信息，不能落到日志。
 */
async function timed<T>(sql: string, params: any[], run: () => Promise<T>): Promise<T> {
  const start = Date.now();
  try {
    return await run();
  } finally {
    const cost = Date.now() - start;
    if (SLOW_SQL_MS > 0 && cost >= SLOW_SQL_MS) {
      logger.warn('slow-sql', { cost, paramCount: params.length, sql: summarizeSql(sql) });
    }
  }
}

/** MySQL 连接池（针对 1 万级人口规模合理配置） */
export const pool: Pool = mysql.createPool({
  host: env.dbHost,
  port: env.dbPort,
  user: env.dbUser,
  password: env.dbPassword,
  database: env.dbName,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  charset: 'utf8mb4',
  timezone: '+08:00',
  /**
   * DATE 列直接以字符串返回（'YYYY-MM-DD'），不做 Date 转换。
   *
   * 为什么必须这样：DATE 是「日历日期」，不含时刻。若转成 Date 对象，
   * mysql2 会按 timezone(+08:00) 把它解释为本地零点（1990-01-15 00:00 +08:00
   * = UTC 1990-01-14 16:00Z），此时再按 UTC 取日期就得到 1990-01-14，
   * **且换个环境时区结果就不同**（+08:00 机器上对、UTC 机器上错）。
   * 直接拿字符串没有时区歧义，也不受部署环境时区影响。
   *
   * 只对 DATE 生效；DATETIME（如 created_at）仍返回 Date，行为不变。
   */
  dateStrings: ['DATE'],
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000,
});

export interface QueryOptions {
  /** 是否在单连接事务中执行 */
  transaction?: boolean;
}

/** 便捷查询：返回行数组 */
export async function query<T = RowDataPacket[]>(
  sql: string,
  params: any[] = []
): Promise<T[]> {
  return timed(sql, params, async () => {
    const [rows] = await pool.query(sql, params);
    return rows as T[];
  });
}

/** 便捷查询：返回单行 */
export async function queryOne<T = RowDataPacket>(
  sql: string,
  params: any[] = []
): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return (rows[0] as T) ?? null;
}

/** 执行写操作，返回影响行数与 insertId */
export async function execute(
  sql: string,
  params: any[] = []
): Promise<ResultSetHeader> {
  return timed(sql, params, async () => {
    const [result] = await pool.execute(sql, params);
    return result as ResultSetHeader;
  });
}

/** 在事务中执行回调，自动提交/回滚 */
export async function withTransaction<T>(
  fn: (conn: PoolConnection) => Promise<T>
): Promise<T> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

export { RowDataPacket, ResultSetHeader };
