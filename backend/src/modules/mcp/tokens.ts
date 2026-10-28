/**
 * MCP 长期令牌的存取。
 *
 * 这里只做四件事：生成、按明文查、列出、吊销。**不含任何请求/响应逻辑**，
 * 所以既被测得了（单元测试直接调用），也能被 CLI/脚本复用。
 *
 * 安全边界（改动前务必先读）：
 * 1. 明文只在 createToken 的返回值里出现一次，库里只有 sha256。
 * 2. 令牌只能用于 `/api/mcp`，不能拿去调 `/api/persons` 等业务接口——
 *    识别与放行都写在 mcpAuth 里，全局 authMiddleware 完全不知道这种令牌存在。
 * 3. 吊销是软删（revoked_at），保留行以便回答「这枚令牌什么时候被谁停掉的」。
 *
 * 生成位置：**必须且只在服务端**。前端只负责把后端返回的明文展示一次并让用户复制；
 * 浏览器里的 Math.random 不是密码学安全的，而且前端生成意味着明文要先经过请求体
 * （会进日志、进代理、进审计），一旦页面被 XSS 就等于直接把凭证送出去。
 * 随机数取 Node crypto.randomBytes(32)（256 位），比 JWT 的 HS256 密钥强度还高。
 */

import crypto from 'crypto';
import { execute, query, queryOne } from '../../config/db';

/** 明文前缀。故意做成可识别字符串：日志脱敏、扫描泄露、区分 JWT（JWT 是 eyJ 开头）都靠它 */
export const TOKEN_PREFIX = 'vpm_';

/** 每个用户未吊销令牌上限。纯保险：正常人有两三枚（家里 / 办公室 / 手机）就够 */
export const MAX_TOKENS_PER_USER = 20;

/** 令牌用途等级。read 只能看到 read 工具；write 还受 MCP_WRITE_LEVEL 全局开关约束 */
export type TokenScope = 'read' | 'write';

export interface McpTokenRow {
  id: number;
  user_id: number;
  name: string;
  token_hash: string;
  token_prefix: string;
  scope: TokenScope;
  token_version: number;
  expires_at: string | null;
  last_used_at: string | null;
  last_used_ip: string | null;
  revoked_at: string | null;
  created_at: string;
  /** 仅 listTokens 带出（列表要显示是谁的令牌，管理员视图用） */
  username?: string;
}

export interface CreatedToken {
  id: number;
  /** 明文。调用方必须立刻返回给用户，之后再也取不回来 */
  token: string;
  prefix: string;
  name: string;
  scope: TokenScope;
  expiresAt: string | null;
}

export function hashToken(plain: string): string {
  return crypto.createHash('sha256').update(plain, 'utf8').digest('hex');
}

/**
 * 生成一枚令牌。
 *
 * 32 字节随机（256 位）比 JWT 的 HS256 密钥强度还高，暴力枚举没有意义；
 * 用 base64url 而不是 hex，是为了让用户手动复制时短一些（43 字符 vs 64）。
 */
export function generateToken(): { token: string; hash: string; prefix: string } {
  const token = TOKEN_PREFIX + crypto.randomBytes(32).toString('base64url');
  return { token, hash: hashToken(token), prefix: token.slice(0, 12) };
}

/** 看起来像不像本系统的长期令牌。mcpAuth 靠它决定走哪条鉴权分支 */
export function looksLikeToken(value: string): boolean {
  return typeof value === 'string' && value.startsWith(TOKEN_PREFIX);
}

export function normalizeScope(raw: unknown): TokenScope {
  return raw === 'write' ? 'write' : 'read';
}

/** 名字必须可读：列表里全是「令牌 1、令牌 2」就等于没有备注 */
export function normalizeName(raw: unknown): string {
  const name = typeof raw === 'string' ? raw.trim() : '';
  return name ? name.slice(0, 64) : '未命名令牌';
}

/**
 * 创建令牌。
 *
 * tokenVersion 存的是**签发那一刻**用户的版本号：之后用户改密码（+1）时，
 * 这枚令牌自动失效，与 JWT 的失效语义保持一致。
 */
export async function createToken(input: {
  userId: number;
  name: unknown;
  scope: unknown;
  expiresInDays?: unknown;
  tokenVersion: number;
}): Promise<CreatedToken> {
  const active = await queryOne<{ n: number }>(
    'SELECT COUNT(*) AS n FROM mcp_token WHERE user_id = ? AND revoked_at IS NULL',
    [input.userId]
  );
  if (Number(active?.n ?? 0) >= MAX_TOKENS_PER_USER) {
    throw new Error(`每人最多 ${MAX_TOKENS_PER_USER} 枚有效令牌，请先吊销不再使用的`);
  }

  const { token, hash, prefix } = generateToken();
  const name = normalizeName(input.name);
  const scope = normalizeScope(input.scope);

  // 天数留空 = 长期有效（这是「长期专用令牌」的本意，也是默认值）
  const days = Number(input.expiresInDays);
  const validDays = Number.isFinite(days) && days > 0 ? Math.floor(days) : 0;

  const result = await execute(
    `INSERT INTO mcp_token (user_id, name, token_hash, token_prefix, scope, token_version, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ${validDays ? 'DATE_ADD(NOW(), INTERVAL ? DAY)' : 'NULL'})`,
    validDays
      ? [input.userId, name, hash, prefix, scope, input.tokenVersion, validDays]
      : [input.userId, name, hash, prefix, scope, input.tokenVersion]
  );

  const row = await queryOne<{ expires_at: string | null }>(
    'SELECT expires_at FROM mcp_token WHERE id = ?',
    [result.insertId]
  );

  return { id: result.insertId, token, prefix, name, scope, expiresAt: row?.expires_at ?? null };
}

/**
 * 按明文查有效令牌。
 *
 * 查不到、已吊销、已过期、或签发后用户改过密码，一律返回 null——
 * 调用方不需要区分这些情况（对外都是 401），但内部日志会记录原因。
 * 返回的 reason 只用于本地排障，不返回给客户端。
 */
export async function findValidToken(
  plain: string
): Promise<{ row: McpTokenRow } | { row: McpTokenRow; reason: 'REVOKED' | 'EXPIRED' } | null> {
  const row = await queryOne<McpTokenRow>('SELECT * FROM mcp_token WHERE token_hash = ?', [hashToken(plain)]);
  if (!row) return null;
  if (row.revoked_at) return { row, reason: 'REVOKED' };
  if (row.expires_at && new Date(row.expires_at).getTime() <= Date.now()) return { row, reason: 'EXPIRED' };
  return { row };
}

/** 列表：默认只看自己的；isAdmin 传 true 时看全部（应急排查「这台机器上还有谁开了 AI」） */
export async function listTokens(userId: number, all = false): Promise<McpTokenRow[]> {
  const sql = all
    ? `SELECT t.*, u.username FROM mcp_token t
       LEFT JOIN sys_user u ON u.id = t.user_id
       ORDER BY t.revoked_at IS NOT NULL, t.id DESC`
    : `SELECT * FROM mcp_token WHERE user_id = ? ORDER BY revoked_at IS NOT NULL, id DESC`;
  return query<McpTokenRow>(sql, all ? [] : [userId]);
}

/**
 * 吊销。
 *
 * 只能吊销自己的；管理员可以吊销任何人的（那是应急手段，不给自己发令牌）。
 * 返回是否真的改动了一行——前端据此区分「已吊销过」与「不存在/无权」。
 */
export async function revokeToken(id: number, userId: number, isAdmin: boolean): Promise<boolean> {
  const result = await execute(
    `UPDATE mcp_token SET revoked_at = NOW()
     WHERE id = ? AND revoked_at IS NULL ${isAdmin ? '' : 'AND user_id = ?'}`,
    isAdmin ? [id] : [id, userId]
  );
  return result.affectedRows > 0;
}

/** 一键全部吊销：令牌疑似泄露时的止血手段，也是「改密码之后仍然不放心」的兜底 */
export async function revokeAllTokens(userId: number): Promise<number> {
  const result = await execute(
    'UPDATE mcp_token SET revoked_at = NOW() WHERE user_id = ? AND revoked_at IS NULL',
    [userId]
  );
  return result.affectedRows;
}

/**
 * 记录最近使用时间。
 *
 * 每次调用都 UPDATE 会让「读一次数」变成一次写盘，而 last_used_at 只用于排查，
 * 精度到分钟就够。所以按进程内节流：同一枚令牌 60 秒内只写一次。
 * 多实例部署时最坏情况是每实例每分钟各写一次，无害。
 */
const TOUCH_INTERVAL_MS = 60_000;
const touchedAt = new Map<number, number>();

export function touchToken(id: number, ip: string): void {
  const now = Date.now();
  const last = touchedAt.get(id) ?? 0;
  if (now - last < TOUCH_INTERVAL_MS) return;
  touchedAt.set(id, now);
  // 不 await：失败只影响一个展示字段，不能拖慢或中断工具调用
  void execute('UPDATE mcp_token SET last_used_at = NOW(), last_used_ip = ? WHERE id = ?', [ip, id]).catch(
    () => undefined
  );
}

/** 仅测试用：清空节流缓存，让 touchToken 可被断言 */
export function resetTouchCache(): void {
  touchedAt.clear();
}
