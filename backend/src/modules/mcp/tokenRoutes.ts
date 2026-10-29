/**
 * MCP 长期令牌的管理接口：`/api/mcp/tokens`。
 *
 * 三条边界，都是刻意的：
 * 1. **只认 JWT**（authMiddleware），不认长期令牌 —— 否则一枚泄露的令牌可以
 *    自己续命、自己再签发，吊销就形同虚设。
 * 2. **只能管自己的令牌**：创建时 user_id 强制取当前登录用户，不接受指定他人，
 *    避免「管理员替别人发一枚权限令牌」这种无法追责的操作。管理员额外可以
 *    查看全部、吊销任意一枚（应急止血），但同样不能替别人创建。
 * 3. **明文只返回一次**：之后所有接口最多返回 `vpm_xxxxxx…` 前缀。
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../../middleware/auth';
import { writeAudit } from '../../middleware/audit';
import { fail, ok, AppError } from '../../utils/response';
import { createToken, listTokens, revokeAllTokens, revokeToken, type McpTokenRow } from './tokens';
import { piiMode, writeLevel } from './config';

const router = Router();

// 令牌管理永远只认网页登录的 JWT
router.use(authMiddleware);

const createSchema = z.object({
  name: z.string().trim().min(1, '请填写用途，例如 Claude Desktop').max(64, '名称最多 64 个字'),
  scope: z.enum(['read', 'write']).default('read'),
  /** 0 或不传 = 长期有效。上限 10 年，纯粹为了拦住手滑输入 */
  expiresInDays: z.number().int().min(0).max(3650).optional(),
});

/**
 * 列表用的视图对象。
 *
 * 显式映射而不是把 SQL 行原样吐出去：`token_hash` 不出库、字段统一驼峰，
 * 前端不必记住哪张表返回下划线。
 */
function toVO(row: McpTokenRow) {
  const now = Date.now();
  const expired = !!row.expires_at && new Date(row.expires_at).getTime() <= now;
  return {
    id: row.id,
    name: row.name,
    prefix: `${row.token_prefix}…`,
    scope: row.scope,
    username: row.username,
    expiresAt: row.expires_at,
    lastUsedAt: row.last_used_at,
    lastUsedIp: row.last_used_ip,
    revokedAt: row.revoked_at,
    createdAt: row.created_at,
    status: row.revoked_at ? 'REVOKED' : expired ? 'EXPIRED' : 'ACTIVE',
  };
}

/** 列表。管理员加 ?all=1 看全员的令牌（排查「这台机器上还有谁开了 AI」时用） */
router.get('/', async (req: Request, res: Response) => {
  const all = req.query.all === '1' && req.user!.isAdmin;
  const rows = await listTokens(req.user!.id, all);
  const items = rows.map(toVO);

  return ok(res, {
    items,
    total: items.length,
    // 开关状态随列表返回：用户看到「只读」时才明白为什么写了没生效
    writeLevel: writeLevel(),
    piiMode: piiMode(),
    scopedToAll: all,
    maxPerUser: 20,
  });
});

/** 创建。响应里的 token 是全系统唯一一次能看到明文的地方 */
router.post('/', async (req: Request, res: Response) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, parsed.error.errors[0].message);

  const user = req.user!;
  let created;
  try {
    created = await createToken({
      userId: user.id,
      name: parsed.data.name,
      scope: parsed.data.scope,
      expiresInDays: parsed.data.expiresInDays,
      tokenVersion: user.tokenVersion,
    });
  } catch (err) {
    // 只有「数量超上限」会走到这里，是给用户看的提示而不是 500
    throw new AppError(err instanceof Error ? err.message : '令牌创建失败');
  }

  // 审计里**绝不记录明文**：这条日志会被很多人看到，而令牌能直接读全库人员数据
  await writeAudit({
    userId: user.id,
    username: user.username,
    action: 'mcp:token_create',
    module: 'mcp',
    method: 'POST',
    path: '/api/mcp/tokens',
    request: { id: created.id, name: created.name, scope: created.scope, expiresAt: created.expiresAt },
    result: 'SUCCESS',
    ip: req.ip,
  });

  return ok(
    res,
    {
      id: created.id,
      token: created.token,
      name: created.name,
      scope: created.scope,
      expiresAt: created.expiresAt,
    },
    '令牌已创建，请立即复制：关闭后无法再次查看'
  );
});

/** 全部吊销：令牌疑似泄露时的止血手段（改密码也会让它们失效，但不要指望用户记得改密码） */
router.post('/revoke-all', async (req: Request, res: Response) => {
  const count = await revokeAllTokens(req.user!.id);

  await writeAudit({
    userId: req.user!.id,
    username: req.user!.username,
    action: 'mcp:token_revoke_all',
    module: 'mcp',
    method: 'POST',
    path: '/api/mcp/tokens/revoke-all',
    request: { count },
    result: 'SUCCESS',
    ip: req.ip,
  });

  return ok(res, { count }, count ? `已吊销 ${count} 枚令牌` : '没有生效中的令牌');
});

/** 吊销单枚。管理员可以吊销别人的，普通人只能吊销自己的 */
router.delete('/:id', async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw new AppError('令牌 id 不合法');

  const done = await revokeToken(id, req.user!.id, req.user!.isAdmin);
  if (!done) {
    // 已吊销、不存在、或不属于自己 —— 统一话术，不区分（避免探测他人令牌 id 是否存在）
    return fail(res, '令牌不存在或已吊销', 404, 'NOT_FOUND');
  }

  await writeAudit({
    userId: req.user!.id,
    username: req.user!.username,
    action: 'mcp:token_revoke',
    module: 'mcp',
    method: 'DELETE',
    path: `/api/mcp/tokens/${id}`,
    request: { id },
    result: 'SUCCESS',
    ip: req.ip,
  });

  return ok(res, null, '令牌已吊销');
});

export default router;
