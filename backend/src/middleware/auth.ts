import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { query, queryOne } from '../config/db';
import { fail } from '../utils/response';
import { AuthUser } from '../types';

interface JwtPayload {
  uid: number;
  username: string;
  /**
   * 令牌版本（token version）。
   * 老版本签发的 token 没有这个字段，按 0 处理 —— 与迁移后的默认值一致，
   * 所以升级本身不会把已登录的用户踢下线，只有改密码/停用才会。
   */
  tv?: number;
}

/**
 * 签发 JWT。
 *
 * expiresIn 可选：MCP 长期令牌换取的身份需要一枚**短命** JWT（5 分钟）
 * 才能在内部转发时被 authMiddleware 认出来，见 modules/mcp/mcpAuth.ts。
 * 不传时仍是全局默认有效期，行为与以前一致。
 */
export function signToken(
  user: { id: number; username: string; tokenVersion?: number },
  expiresIn: string | number = env.jwtExpiresIn
): string {
  const payload: JwtPayload = { uid: user.id, username: user.username, tv: user.tokenVersion ?? 0 };
  return jwt.sign(payload, env.jwtSecret, { expiresIn } as jwt.SignOptions);
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

  const user = await queryOne<any>(
    'SELECT id, username, real_name, is_admin, status, token_version FROM sys_user WHERE id = ?',
    [userId]
  );
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
    tokenVersion: Number(user.token_version ?? 0),
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

/**
 * 认一枚 JWT，返回「用户上下文」或「该拦下来的原因」。
 *
 * 抽成独立函数是为了让 MCP 的长期令牌鉴权（modules/mcp/mcpAuth.ts）复用同一套
 * 停用账号 / 令牌版本校验：令牌换算出 user_id 之后，剩下的规则与浏览器登录完全相同。
 * 若各写一遍，早晚会出现「网页上停用了账号，AI 那边还能用」这种缝。
 */
export type AuthOutcome =
  | { ok: true; user: AuthUser }
  | { ok: false; status: 401 | 403; message: string; code: string };

export async function authenticateToken(rawToken: string): Promise<AuthOutcome> {
  if (!rawToken) return { ok: false, status: 401, message: '未登录或登录已过期', code: 'UNAUTHORIZED' };

  const payload = verifyToken(rawToken);
  if (!payload) return { ok: false, status: 401, message: '未登录或登录已过期', code: 'UNAUTHORIZED' };

  try {
    const ctx = await loadAuthContext(payload.uid);
    // 账号被停用后，已签发的 token 在有效期内仍然合法，必须在每次请求时校验启用状态，
    // 否则停用只是「登录拦得住、旧 token 拦不住」。
    if (!ctx.active) return { ok: false, status: 403, message: '账号已被停用', code: 'ACCOUNT_DISABLED' };
    // 令牌版本校验：改密码 / 停用账号时库里 token_version +1，手里还没过期的
    // 旧 token 立刻作废。缺 tv 的老 token 按 0 处理，与迁移默认值一致，
    // 所以升级本身不会把正在使用的用户踢下线。
    if ((payload.tv ?? 0) !== ctx.tokenVersion) {
      return { ok: false, status: 401, message: '登录状态已失效，请重新登录', code: 'TOKEN_REVOKED' };
    }
    return { ok: true, user: ctx };
  } catch {
    // 任何解析/查询异常都统一按未认证处理，不向外泄露内部原因
    return { ok: false, status: 401, message: '认证失败', code: 'UNAUTHORIZED' };
  }
}

/** 认证中间件：解析 Bearer Token 并加载用户上下文 */
export async function authMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';

  const outcome = await authenticateToken(token);
  if (!outcome.ok) {
    fail(res, outcome.message, outcome.status, outcome.code);
    return;
  }
  req.user = outcome.user;
  next();
}
