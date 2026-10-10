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

export const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: parseInt(req('PORT', '8080'), 10),

  dbHost: req('DB_HOST', '127.0.0.1'),
  dbPort: parseInt(req('DB_PORT', '3306'), 10),
  dbName: req('DB_NAME', 'village_population'),
  dbUser: req('DB_USER', 'village'),
  dbPassword: req('DB_PASSWORD', ''),

  jwtSecret: req('JWT_SECRET', 'dev-secret-change-me-please-32chars-min'),
  jwtExpiresIn: req('JWT_EXPIRES_IN', '12h'),

  adminInitUsername: req('ADMIN_INIT_USERNAME', 'admin'),
  adminInitPassword: req('ADMIN_INIT_PASSWORD', 'Admin@123456'),
  adminInitName: req('ADMIN_INIT_NAME', '系统管理员'),

  corsOrigin: req('CORS_ORIGIN', '*'),
  uploadDir: req('UPLOAD_DIR', './uploads'),
};
