import { Response } from 'express';

/** 业务异常 */
export class AppError extends Error {
  status: number;
  code: string;
  constructor(message: string, status = 400, code = 'BAD_REQUEST') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** 统一成功响应 */
export function ok<T>(res: Response, data: T, message = 'success'): Response {
  return res.json({ code: 0, message, data });
}

/** 分页响应结构 */
export interface PageResult<T> {
  list: T[];
  total: number;
  page: number;
  pageSize: number;
}

export function okPage<T>(res: Response, page: PageResult<T>): Response {
  return res.json({ code: 0, message: 'success', data: page });
}

/** 统一失败响应 */
export function fail(res: Response, message: string, status = 400, code = 'BAD_REQUEST'): Response {
  return res.status(status).json({ code: status, message, data: null, errorCode: code });
}
