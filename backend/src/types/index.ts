/** 登录用户上下文（由 auth 中间件注入） */
export interface AuthUser {
  id: number;
  username: string;
  realName: string;
  isAdmin: boolean;
  /** 账号是否启用（sys_user.status）。停用后即使持有未过期的 token 也应被拒。 */
  active: boolean;
  /**
   * 令牌版本（sys_user.token_version）。
   * 签发时写进 payload，每次请求比对；改密码 / 停用账号时 +1，
   * 已签发的旧 token 立即失效。
   */
  tokenVersion: number;
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
