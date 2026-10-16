import { Request, Response, NextFunction } from 'express';
import { fail } from '../utils/response';

/**
 * 权限校验中间件工厂
 * 用法：router.get('/', requirePermission('person:view'), handler)
 */
export function requirePermission(code: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = req.user;
    if (!user) {
      fail(res, '未登录', 401, 'UNAUTHORIZED');
      return;
    }
    if (user.isAdmin || user.permissions.has(code)) {
      next();
      return;
    }
    fail(res, '无操作权限', 403, 'FORBIDDEN');
  };
}

/** 判断是否拥有任一权限 */
export function hasAnyPermission(req: Request, codes: string[]): boolean {
  const user = req.user;
  if (!user) return false;
  if (user.isAdmin) return true;
  return codes.some((c) => user.permissions.has(c));
}
