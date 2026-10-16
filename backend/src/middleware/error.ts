import { Request, Response, NextFunction } from 'express';
import { AppError } from '../utils/response';
import { logger } from '../utils/logger';
import { ZodError } from 'zod';

/** 统一错误处理中间件 */
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof AppError) {
    res.status(err.status).json({ code: err.status, message: err.message, data: null, errorCode: err.code });
    return;
  }
  if (err instanceof ZodError) {
    const first = err.errors[0];
    res.status(400).json({ code: 400, message: `参数校验失败：${first?.message || '格式错误'}`, data: null });
    return;
  }
  if (err instanceof SyntaxError) {
    res.status(400).json({ code: 400, message: '请求体 JSON 格式错误', data: null });
    return;
  }
  // multer 文件过大等错误
  const anyErr = err as any;
  if (anyErr && anyErr.code === 'LIMIT_FILE_SIZE') {
    res.status(400).json({ code: 400, message: '文件大小超出限制', data: null });
    return;
  }
  logger.error('unhandled-error', {
    requestId: req.id,
    method: req.method,
    path: req.path,
    message: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
  });
  res.status(500).json({ code: 500, message: '服务器内部错误', data: null });
}

/** 404 处理 */
export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({ code: 404, message: `接口不存在: ${req.method} ${req.path}`, data: null });
}
