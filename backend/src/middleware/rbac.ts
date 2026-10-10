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

/**
 * 网格数据范围过滤。
 * 已简化为「管理员/普通用户均可查看全部数据」，恒返回不过滤。
 * 保留该函数以兼容各模块调用点。
 */
export function buildGridFilter(_req: Request, _alias = 'grid_id'): { where: string; params: number[] } {
  return { where: '', params: [] };
}
