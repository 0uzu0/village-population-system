import fs from 'fs';
import path from 'path';
import { pool, queryOne, execute } from '../config/db';

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
  const applied = await appliedVersions();
  const migrations = listMigrations();
  const appliedNow: string[] = [];
  const skipped: string[] = [];

  for (const mig of migrations) {
    if (applied.has(mig.version)) {
      skipped.push(mig.version);
      continue;
    }
    const sql = fs.readFileSync(mig.path, 'utf-8');
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      // 逐条执行语句（简单按分号拆分；本项目的迁移 SQL 不含存储过程中的分号）
      const statements = sql
        .split(';')
        .map((s) => s.trim())
        .filter((s) => s.length > 0 && !s.startsWith('--'));
      for (const stmt of statements) {
        await conn.query(stmt);
      }
      await conn.query('INSERT INTO schema_migrations (version) VALUES (?)', [mig.version]);
      await conn.commit();
      appliedNow.push(mig.version);
      console.log(`[migrate] 已应用 ${mig.name}`);
    } catch (err) {
      await conn.rollback();
      console.error(`[migrate] 迁移失败: ${mig.name}`, err);
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
      console.log('[migrate] 完成，本次应用:', r.applied, '跳过:', r.skipped);
      process.exit(0);
    })
    .catch((err) => {
      console.error('[migrate] 失败', err);
      process.exit(1);
    });
}
