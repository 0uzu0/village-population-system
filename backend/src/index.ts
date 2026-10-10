import { createApp } from './app';
import { env } from './config/env';
import { runMigrations } from './db/migrate';
import { pool, queryOne, execute, withTransaction } from './config/db';
import { hashPassword } from './utils/crypto';

// 双保险：即使有未被路由层捕获的 Promise 拒绝，也只记录日志而不打崩进程
process.on('unhandledRejection', (reason) => {
  console.error('[server] 未处理的 Promise 拒绝:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[server] 未捕获的同步异常:', err);
});

/** 首次启动：创建初始管理员并绑定系统管理员角色 */
async function bootstrapAdmin(): Promise<void> {
  const admin = await queryOne<any>('SELECT id FROM sys_user WHERE username = ?', [env.adminInitUsername]);
  if (admin) return;

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
  console.log(`[bootstrap] 已创建初始管理员账号: ${env.adminInitUsername}`);
}

async function main(): Promise<void> {
  // 数据库迁移（幂等）
  await runMigrations();

  // 初始化管理员
  await bootstrapAdmin();

  const app = createApp();
  const server = app.listen(env.port, () => {
    console.log(`[server] 村级人口管理系统后端已启动: http://localhost:${env.port}`);
  });

  // 优雅关闭：正确处理容器终止信号
  const shutdown = (signal: string) => {
    console.log(`[server] 收到 ${signal}，正在优雅关闭...`);
    server.close(async () => {
      await pool.end();
      console.log('[server] 已关闭');
      process.exit(0);
    });
    // 超时强制退出
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('[server] 启动失败', err);
  process.exit(1);
});
