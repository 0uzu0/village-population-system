import { createApp } from './app';
import { env, assertProductionSafety } from './config/env';
import { runMigrations } from './db/migrate';
import { pool, queryOne, execute, withTransaction } from './config/db';
import { hashPassword } from './utils/crypto';
import { markStaleImportTasks } from './services/importTask';
import { logger } from './utils/logger';

// 双保险：即使有未被路由层捕获的 Promise 拒绝，也只记录日志而不打崩进程
process.on('unhandledRejection', (reason) => {
  logger.error('unhandled-rejection', { message: reason instanceof Error ? reason.message : String(reason) });
});
process.on('uncaughtException', (err) => {
  logger.error('uncaught-exception', { message: err.message, stack: err.stack });
});

/** 首次启动：创建初始管理员并绑定系统管理员角色 */
async function bootstrapAdmin(): Promise<void> {
  const admin = await queryOne<any>('SELECT id FROM sys_user WHERE username = ?', [env.adminInitUsername]);
  if (admin) return;

  // 确实要新建管理员时，才校验初始口令不能是内置默认弱口令
  assertProductionSafety({ willCreateAdmin: true });

  await withTransaction(async (conn) => {
    const r: any = await conn.query(
      'INSERT INTO sys_user (username, password_hash, real_name, status, is_admin) VALUES (?,?,?,1,1)',
      [env.adminInitUsername, hashPassword(env.adminInitPassword), env.adminInitName]
    );
    const uid = r[0].insertId;
    const role = await conn.query('SELECT id FROM sys_role WHERE code = ?', ['SYSTEM_ADMIN']);
    const roleRows = (role as any)[0];
    if (roleRows.length) {
      await conn.query('INSERT IGNORE INTO sys_user_role (user_id, role_id) VALUES (?,?)', [uid, roleRows[0].id]);
    }
  });
  logger.info('bootstrap-admin-created', { username: env.adminInitUsername });
}

async function main(): Promise<void> {
  // 生产环境配置自检：仍在用内置默认密钥/弱口令则直接拒绝启动（避免带病上线）
  assertProductionSafety();

  // 数据库迁移（幂等）
  await runMigrations();

  // 初始化管理员
  await bootstrapAdmin();

  // 启动时收敛上次崩溃残留、状态卡在「处理中」的导入任务（force：跳过节流）
  await markStaleImportTasks(10, true);

  const app = createApp();
  const server = app.listen(env.port, () => {
    logger.info('server-started', { port: env.port, nodeEnv: env.nodeEnv });
  });

  // 优雅关闭：正确处理容器终止信号
  const shutdown = (signal: string) => {
    logger.info('shutdown-start', { signal });
    server.close(async () => {
      await pool.end();
      logger.info('server-closed');
      process.exit(0);
    });
    // 超时强制退出
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  logger.error('startup-failed', { message: err instanceof Error ? err.message : String(err), stack: err instanceof Error ? err.stack : undefined });
  process.exit(1);
});
