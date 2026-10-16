import fs from 'fs';
import path from 'path';
import { pool, queryOne, execute } from '../config/db';
import { logger } from '../utils/logger';

/**
 * 数据库版本化迁移器
 * - 读取 src/db/migrations 下 Vxxx__*.sql，按版本号升序执行
 * - 通过 schema_migrations 表记录已应用版本，保证幂等
 * - 生产环境升级前请先备份数据库（见部署文档）
 */

const MIGRATIONS_DIR = path.resolve(__dirname, 'migrations');

interface MigrationFile {
  version: string;
  name: string;
  path: string;
}

function listMigrations(): MigrationFile[] {
  if (!fs.existsSync(MIGRATIONS_DIR)) return [];
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^V\d+__.+\.sql$/.test(f))
    .map((f) => {
      const version = f.match(/^V(\d+)__/)![1];
      return { version, name: f, path: path.join(MIGRATIONS_DIR, f) };
    })
    .sort((a, b) => parseInt(a.version, 10) - parseInt(b.version, 10));
}

/**
 * 按分号拆分 SQL 文件为语句数组。
 * 正确处理：'...' 字符串字面量（含 \' 与 '' 转义）、-- 行注释、块注释。
 * 旧的实现先 split(';') 再丢弃以 -- 开头的块，导致「注释 + CREATE TABLE」
 * 组合的语句块被整体静默丢弃（V001 丢 23/25 块，sys_user 根本没建）。
 */
export function splitStatements(sql: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inStr = false;
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    if (inStr) {
      if (ch === '\\') {
        cur += ch + (sql[i + 1] ?? '');
        i += 2;
        continue;
      }
      if (ch === "'") inStr = false;
      cur += ch;
      i++;
      continue;
    }
    if (ch === "'") {
      inStr = true;
      cur += ch;
      i++;
      continue;
    }
    if (ch === '-' && sql[i + 1] === '-') {
      while (i < sql.length && sql[i] !== '\n') i++; // 跳过行注释
      continue;
    }
    if (ch === '/' && sql[i + 1] === '*') {
      i += 2;
      while (i < sql.length && !(sql[i] === '*' && sql[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    if (ch === ';') {
      const s = cur.trim();
      if (s) out.push(s);
      cur = '';
      i++;
      continue;
    }
    cur += ch;
    i++;
  }
  const tail = cur.trim();
  if (tail) out.push(tail);
  return out;
}

async function ensureTable(): Promise<void> {
  await execute(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version VARCHAR(64) NOT NULL PRIMARY KEY,
    applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
}

async function appliedVersions(): Promise<Set<string>> {
  const rows = await queryOne<any>('SELECT GROUP_CONCAT(version) AS v FROM schema_migrations');
  if (!rows || !rows.v) return new Set();
  return new Set(String(rows.v).split(','));
}

export async function runMigrations(): Promise<{ applied: string[]; skipped: string[] }> {
  await ensureTable();

  const migrations = listMigrations();
  // 防护一：迁移目录缺失/为空（镜像打包问题）时必须报错，
  // 否则会静默跳过建表、把问题推迟到业务启动时才爆
  if (migrations.length === 0) {
    throw new Error(`数据库迁移失败: ${MIGRATIONS_DIR} 下没有找到任何迁移 SQL 文件`);
  }

  const applied = await appliedVersions();
  const appliedNow: string[] = [];
  const skipped: string[] = [];

  for (const mig of migrations) {
    if (applied.has(mig.version)) {
      skipped.push(mig.version);
      continue;
    }
    const sql = fs.readFileSync(mig.path, 'utf-8');
    const statements = splitStatements(sql);
    // 防护二：解析出 0 条语句说明文件内容异常，宁可失败也不能静默标记为已应用
    if (statements.length === 0) {
      throw new Error(`数据库迁移失败: ${mig.name} 解析出 0 条语句`);
    }
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      for (const stmt of statements) {
        await conn.query(stmt);
      }
      await conn.query('INSERT INTO schema_migrations (version) VALUES (?)', [mig.version]);
      await conn.commit();
      appliedNow.push(mig.version);
      logger.info('migration-applied', { name: mig.name, statements: statements.length });
    } catch (err) {
      await conn.rollback();
      logger.error('migration-failed', { name: mig.name, message: err instanceof Error ? err.message : String(err) });
      throw new Error(`数据库迁移失败: ${mig.name}`);
    } finally {
      conn.release();
    }
  }
  return { applied: appliedNow, skipped };
}

/** 作为独立脚本运行时执行迁移 */
if (require.main === module) {
  runMigrations()
    .then((r) => {
      logger.info('migration-done', { applied: r.applied, skipped: r.skipped });
      process.exit(0);
    })
    .catch((err) => {
      logger.error('migration-aborted', { message: err instanceof Error ? err.message : String(err) });
      process.exit(1);
    });
}
