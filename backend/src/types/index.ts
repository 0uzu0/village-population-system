import { Request } from 'express';

/** 登录用户上下文（由 auth 中间件注入） */
export interface AuthUser {
  id: number;
  username: string;
  realName: string;
  isAdmin: boolean;
  roles: string[];
  permissions: Set<string>;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export {};
