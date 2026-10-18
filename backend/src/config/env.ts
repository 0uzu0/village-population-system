import path from 'path';
import fs from 'fs';

/** 加载 .env 文件（简单实现，避免额外依赖） */
function loadEnvFile(): void {
  const envPath = path.resolve(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf-8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}
loadEnvFile();

function req(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined) throw new Error(`缺少环境变量: ${name}`);
  return v;
}

/**
 * 内置开发默认值（源码中公开可见，只能用于本地开发）。
 * 生产环境若仍在用，启动时会被 assertProductionSafety() 拒绝。
 */
export const DEV_DEFAULTS = {
  jwtSecret: 'dev-secret-change-me-please-32chars-min',
  adminPassword: 'Admin@123456',
} as const;

export const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: parseInt(req('PORT', '8080'), 10),

  dbHost: req('DB_HOST', '127.0.0.1'),
  dbPort: parseInt(req('DB_PORT', '3306'), 10),
  dbName: req('DB_NAME', 'village_population'),
  dbUser: req('DB_USER', 'village'),
  dbPassword: req('DB_PASSWORD', ''),

  jwtSecret: req('JWT_SECRET', DEV_DEFAULTS.jwtSecret),
  // 登录有效期 7 天（2026-10 起）：网格员出勤按天记，每天都要登录一次
  // 反而会让人把密码写在手机壳背面——这才是真正的安全风险。
  // 7 天覆盖「周一派任务、周末回村补录」的完整周期，过期后由 401 统一拦截。
  jwtExpiresIn: req('JWT_EXPIRES_IN', '7d'),

  adminInitUsername: req('ADMIN_INIT_USERNAME', 'admin'),
  adminInitPassword: req('ADMIN_INIT_PASSWORD', DEV_DEFAULTS.adminPassword),
  adminInitName: req('ADMIN_INIT_NAME', '系统管理员'),

  corsOrigin: req('CORS_ORIGIN', '*'),
  uploadDir: req('UPLOAD_DIR', './uploads'),
};

/**
 * 检查生产环境是否仍在用内置开发默认值。
 * 纯函数，便于单测（不依赖 process.env）。
 *
 * 为什么必须拦：JWT_SECRET 是源码里的公开常量，若生产沿用它，
 * 任何人都能自行签发 `{uid: 1}` 的 token 直接以管理员身份调用全部接口。
 */
export function checkProductionSafety(cfg: {
  nodeEnv: string;
  jwtSecret: string;
  /** 仅当本次启动会「新建管理员账号」时才需要校验初始密码 */
  adminInitPassword?: string;
  willCreateAdmin?: boolean;
}): string[] {
  if (cfg.nodeEnv !== 'production') return [];
  const problems: string[] = [];
  if (cfg.jwtSecret === DEV_DEFAULTS.jwtSecret) {
    problems.push('JWT_SECRET 仍为内置开发默认值（公开常量，可被用于伪造管理员 token）');
  }
  if (cfg.willCreateAdmin && cfg.adminInitPassword === DEV_DEFAULTS.adminPassword) {
    problems.push('ADMIN_INIT_PASSWORD 仍为内置开发默认值（弱口令，且在全网源码中可见）');
  }
  return problems;
}

/** 启动即校验：生产环境配置不合格直接拒绝启动，避免带病上线 */
export function assertProductionSafety(cfg?: { willCreateAdmin?: boolean }): void {
  const problems = checkProductionSafety({
    nodeEnv: env.nodeEnv,
    jwtSecret: env.jwtSecret,
    adminInitPassword: env.adminInitPassword,
    willCreateAdmin: cfg?.willCreateAdmin,
  });
  if (problems.length) {
    throw new Error(
      `[配置错误] 生产环境禁止使用内置默认值，请在 deploy/.env 中设置后重启：\n  - ${problems.join('\n  - ')}`
    );
  }
}
