import { Request, Response, NextFunction } from 'express';
import { logger, newRequestId } from '../utils/logger';

/**
 * 请求日志中间件：分配请求 ID + 记录访问日志（方法/路径/状态码/耗时）。
 *
 * 两点刻意设计：
 *  1. **不记录 query string**——筛选条件里可能含姓名、身份证号、手机号等敏感信息。
 *  2. **不记录 /api/health**——容器健康检查每 30 秒一次，记下来会把日志刷满。
 */
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  req.id = newRequestId();
  res.setHeader('X-Request-Id', req.id);

  const start = Date.now();
  res.on('finish', () => {
    if (req.path === '/api/health') return;

    const fields = {
      requestId: req.id,
      method: req.method,
      path: req.path,
      status: res.statusCode,
      cost: Date.now() - start,
      userId: req.user?.id,
    };
    if (res.statusCode >= 500) logger.error('http', fields);
    else if (res.statusCode >= 400) logger.warn('http', fields);
    else logger.info('http', fields);
  });

  next();
}
