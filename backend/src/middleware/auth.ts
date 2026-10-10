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

/** 加载用户完整权限上下文 */
export async function loadAuthContext(userId: number): Promise<AuthUser> {
  const user = await queryOne<any>('SELECT id, username, real_name, is_admin FROM sys_user WHERE id = ?', [userId]);
  if (!user) throw new Error('用户不存在');

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

  return {
    id: user.id,
    username: user.username,
    realName: user.real_name,
    isAdmin: !!user.is_admin,
    roles: roles.map((r: any) => r.code),
    permissions: new Set<string>(perms.map((p: any) => p.code)),
  };
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
    req.user = ctx;
    next();
  } catch (err) {
    fail(res, '认证失败', 401, 'UNAUTHORIZED');
  }
}
