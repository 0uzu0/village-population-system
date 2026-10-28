/**
 * MCP 端点的鉴权：**两条通道，一套规则**。
 *
 * - 通道一 JWT：人在网页里登录拿到的，7 天有效。用来临时用 curl 调一下，
 *   或者给不支持长期令牌的客户端用。
 * - 通道二 长期令牌（`vpm_` 开头）：机器常驻用，可单独吊销、可限定只读。
 *
 * 为什么不直接改全局 authMiddleware 支持长期令牌：
 * 那样这枚长期令牌就能直接打 `/api/persons`、`/api/files` 等所有业务接口，
 * 等于给系统开了一个绕过「7 天过期」的后门。现在的边界是——长期令牌**只对
 * `/api/mcp` 有效**，进去之后再用一枚 5 分钟的 JWT 去转发，业务侧完全不知道
 * 这种令牌存在。
 *
 * 规则复用：令牌换算成 user_id 之后，停用账号 / 令牌版本 / 权限集合全部走
 * `authenticateToken` 同源的判定（loadAuthContext），不另写一遍。
 */

import { NextFunction, Request, Response } from 'express';
import { authenticateToken, loadAuthContext, signToken } from '../../middleware/auth';
import { fail } from '../../utils/response';
import { logger } from '../../utils/logger';
import { findValidToken, looksLikeToken, touchToken } from './tokens';

/**
 * 令牌换来的身份 JWT 只需要活过这一次请求链（内部转发可能串几次 REST 调用）。
 * 5 分钟足够，且即使泄露也无法长期使用——真正的长期凭证始终只有那枚令牌。
 */
const FORWARD_TOKEN_TTL = '5m';

export async function mcpAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization || '';
  const raw = header.startsWith('Bearer ') ? header.slice(7) : '';

  if (!raw) {
    fail(res, '未登录或登录已过期（MCP 需要 Authorization: Bearer）', 401, 'UNAUTHORIZED');
    return;
  }

  // ---- 通道一：普通 JWT ----
  if (!looksLikeToken(raw)) {
    const outcome = await authenticateToken(raw);
    if (!outcome.ok) {
      fail(res, outcome.message, outcome.status, outcome.code);
      return;
    }
    req.user = outcome.user;
    next();
    return;
  }

  // ---- 通道二：MCP 长期令牌 ----
  const found = await findValidToken(raw);
  if (!found) {
    // 查不到就是查不到：不告诉调用方「这枚令牌存在但吊销了」以外的任何信息，
    // 避免被用来枚举猜测（虽然概率为零，但话术上不该有区分）。
    fail(res, 'MCP 令牌无效，请在系统设置 → AI 接入 中重新创建', 401, 'UNAUTHORIZED');
    return;
  }
  if ('reason' in found) {
    const message =
      found.reason === 'REVOKED'
        ? 'MCP 令牌已被吊销，请在系统设置 → AI 接入 中重新创建'
        : 'MCP 令牌已过期，请在系统设置 → AI 接入 中重新创建';
    fail(res, message, 401, 'TOKEN_REVOKED');
    return;
  }

  const row = found.row;
  try {
    const ctx = await loadAuthContext(row.user_id);

    if (!ctx.active) {
      fail(res, '账号已被停用', 403, 'ACCOUNT_DISABLED');
      return;
    }

    // 改密码 / 停用账号会 +1。这里与 JWT 的失效语义保持一致：
    // 「长期」是指不会像 JWT 那样固定 7 天到期，而不是改密码也杀不掉。
    if (row.token_version !== ctx.tokenVersion) {
      fail(res, 'MCP 令牌已失效（账号改过密码或被停用），请重新创建', 401, 'TOKEN_REVOKED');
      return;
    }

    req.user = ctx;
    req.mcpToken = { id: row.id, name: row.name, scope: row.scope };
    req.mcpForwardToken = signToken(
      { id: ctx.id, username: ctx.username, tokenVersion: ctx.tokenVersion },
      FORWARD_TOKEN_TTL
    );

    touchToken(row.id, req.ip || '');
    next();
  } catch (err) {
    logger.warn('mcp-token-auth-failed', {
      tokenId: row.id,
      userId: row.user_id,
      message: err instanceof Error ? err.message : String(err),
    });
    fail(res, '认证失败', 401, 'UNAUTHORIZED');
  }
}

/**
 * 本次请求允许的写入等级上限。
 *
 * read 令牌直接压成 off —— 于是它连 `person_create` 这些工具都看不到（可不见即不可调），
 * 而不是调用了再报没权限。两个开关（令牌 scope 与全局 MCP_WRITE_LEVEL）取更严的那个。
 */
export function tokenWriteCeiling(req: Request): 'off' | null {
  return req.mcpToken?.scope === 'read' ? 'off' : null;
}
