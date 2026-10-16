import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { query, queryOne } from '../config/db';
import { fail } from '../utils/response';
import { AuthUser } from '../types';

interface JwtPayload {
  uid: number;
  username: string;
}

/** 签发 JWT */
export function signToken(user: { id: number; username: string }): string {
  const payload: JwtPayload = { uid: user.id, username: user.username };
  return jwt.sign(payload, env.jwtSecret, { expiresIn: env.jwtExpiresIn } as jwt.SignOptions);
}

/** 校验 JWT 并解析 */
export function verifyToken(token: string): JwtPayload | null {
  try {
    return jwt.verify(token, env.jwtSecret) as JwtPayload;
  } catch {
    return null;
  }
}

/**
 * 权限上下文缓存。
 *
 * 为什么需要：authMiddleware 对**每个请求**都要跑 3 条 SQL（sys_user + sys_role +
 * sys_permission）才能算出权限集合，而权限在几分钟内几乎不会变。列表翻页、图表刷新
 * 这类高频请求会把这 3 次往返白付一遍。
 *
 * 失效策略：TTL 兜底 + 主动失效。凡是会改变「用户 → 角色 → 权限」的操作
 * （改角色、停用账号、改管理员开关）都必须调用 invalidateAuthCache(userId)，
 * 否则最长要等一个 TTL 才生效。
 */
const AUTH_CACHE_TTL_MS = 60_000;
/** 上限保护，避免被异常的大量 userId 撑爆内存（本项目用户数极少，纯保险） */
const AUTH_CACHE_MAX = 500;

interface AuthCacheEntry {
  ctx: AuthUser;
  expireAt: number;
}
const authCache = new Map<number, AuthCacheEntry>();

/** 主动失效：传 userId 失效单个用户，不传则清空全部 */
export function invalidateAuthCache(userId?: number): void {
  if (userId === undefined) authCache.clear();
  else authCache.delete(userId);
}

/** 加载用户完整权限上下文（带 TTL 缓存） */
export async function loadAuthContext(userId: number): Promise<AuthUser> {
  const now = Date.now();
  const hit = authCache.get(userId);
  if (hit && hit.expireAt > now) return hit.ctx;

  const user = await queryOne<any>('SELECT id, username, real_name, is_admin, status FROM sys_user WHERE id = ?', [userId]);
  if (!user) {
    // 用户已被删除：顺手清掉可能存在的脏缓存
    authCache.delete(userId);
    throw new Error('用户不存在');
  }

  const roles = await query<any>(
    `SELECT r.code FROM sys_role r
     JOIN sys_user_role ur ON ur.role_id = r.id WHERE ur.user_id = ?`,
    [userId]
  );

  const perms = await query<any>(
    `SELECT DISTINCT p.code FROM sys_permission p
     JOIN sys_role_permission rp ON rp.permission_id = p.id
     JOIN sys_user_role ur ON ur.role_id = rp.role_id
     WHERE ur.user_id = ?`,
    [userId]
  );

  const ctx: AuthUser = {
    id: user.id,
    username: user.username,
    realName: user.real_name,
    isAdmin: !!user.is_admin,
    active: user.status === 1,
    roles: roles.map((r: any) => r.code),
    permissions: new Set<string>(perms.map((p: any) => p.code)),
  };

  if (authCache.size >= AUTH_CACHE_MAX) {
    // 先清过期项；仍然满则丢弃最早插入的一条
    for (const [key, entry] of authCache) {
      if (entry.expireAt <= now) authCache.delete(key);
    }
    if (authCache.size >= AUTH_CACHE_MAX) {
      const oldest = authCache.keys().next().value;
      if (oldest !== undefined) authCache.delete(oldest);
    }
  }
  authCache.set(userId, { ctx, expireAt: now + AUTH_CACHE_TTL_MS });
  return ctx;
}

/** 认证中间件：解析 Bearer Token 并加载用户上下文 */
export async function authMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) {
      fail(res, '未登录或登录已过期', 401, 'UNAUTHORIZED');
      return;
    }
    const payload = verifyToken(token);
    if (!payload) {
      fail(res, '未登录或登录已过期', 401, 'UNAUTHORIZED');
      return;
    }
    const ctx = await loadAuthContext(payload.uid);
    // 账号被停用后，已签发的 token 在有效期内仍然合法，必须在每次请求时校验启用状态，
    // 否则停用只是「登录拦得住、旧 token 拦不住」。
    if (!ctx.active) {
      fail(res, '账号已被停用', 403, 'ACCOUNT_DISABLED');
      return;
    }
    req.user = ctx;
    next();
  } catch (err) {
    fail(res, '认证失败', 401, 'UNAUTHORIZED');
  }
}
