import { Request, Response, NextFunction } from 'express';
import { execute } from '../config/db';

/** 敏感字段：审计日志中需隐藏（仅凭证类，身份证/手机号已按明文存储不再脱敏） */
const SENSITIVE_KEYS = ['password', 'password_hash', 'token', 'secret', 'oldPassword', 'newPassword'];

function sanitize(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value !== 'object') return value;
  const obj: Record<string, unknown> = { ...(value as Record<string, unknown>) };
  for (const key of Object.keys(obj)) {
    const lower = key.toLowerCase();
    const isSensitive = SENSITIVE_KEYS.some((s) => lower === s.toLowerCase() || lower.includes(s.toLowerCase()));
    if (isSensitive) {
      obj[key] = '***';
    } else if (typeof obj[key] === 'object') {
      obj[key] = sanitize(obj[key]);
    }
  }
  return obj;
}

/** 写入一条审计日志（异步，失败不影响主流程） */
export async function writeAudit(entry: {
  userId?: number;
  username?: string;
  action: string;
  module?: string;
  method?: string;
  path?: string;
  request?: unknown;
  result?: string;
  ip?: string;
  durationMs?: number;
}): Promise<void> {
  try {
    await execute(
      `INSERT INTO audit_log (user_id, username, action, module, method, path, request, result, ip, duration_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        entry.userId ?? null,
        entry.username ?? null,
        entry.action,
        entry.module ?? null,
        entry.method ?? null,
        entry.path ?? null,
        entry.request !== undefined ? JSON.stringify(sanitize(entry.request)) : null,
        entry.result ?? null,
        entry.ip ?? null,
        entry.durationMs ?? null,
      ]
    );
  } catch (err) {
    console.error('[audit] 写入审计日志失败', err);
  }
}

/** 审计中间件：记录所有写操作（POST/PUT/PATCH/DELETE） */
export function auditMiddleware(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();
  const method = req.method.toUpperCase();
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    next();
    return;
  }
  const action = `${method} ${req.baseUrl}${req.path}`;
  res.on('finish', () => {
    const user = req.user;
    writeAudit({
      userId: user?.id,
      username: user?.username,
      action,
      module: req.baseUrl?.split('/')[1] || 'common',
      method,
      path: req.originalUrl,
      request: req.body,
      result: res.statusCode < 400 ? 'SUCCESS' : 'FAIL',
      ip: req.ip,
      durationMs: Date.now() - start,
    });
  });
  next();
}
