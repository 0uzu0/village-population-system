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
      /**
       * 本次请求是用「MCP 长期令牌」认证时才有值（浏览器登录的请求没有）。
       * 用于：read 令牌强制只读、审计里区分「谁在用 AI」。
       */
      mcpToken?: { id: number; name: string; scope: 'read' | 'write' };
      /**
       * MCP 内部转发用的短命 JWT。
       * 长期令牌本身在业务接口上不认，所以认证通过后临时签一枚 5 分钟的 JWT，
       * 转发 `GET /api/persons` 这类请求时用它——权限判定仍然只有一套实现。
       */
      mcpForwardToken?: string;
    }
  }
}

export {};
