/** 登录用户上下文（由 auth 中间件注入） */
export interface AuthUser {
  id: number;
  username: string;
  realName: string;
  isAdmin: boolean;
  /** 账号是否启用（sys_user.status）。停用后即使持有未过期的 token 也应被拒。 */
  active: boolean;
  roles: string[];
  permissions: Set<string>;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
      /** 请求 ID：由 requestLog 中间件注入，用于日志串联 */
      id?: string;
    }
  }
}

export {};
