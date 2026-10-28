/**
 * MCP 接入端点：`POST /api/mcp`（Streamable HTTP，无状态）。
 *
 * 三条必须在接入层守住的事：
 * 1. **先鉴权再谈协议**：未登录直接 401，不返回任何工具信息。
 * 2. **工具清单按权限过滤**：看不见的工具就调不到，避免模型反复尝试注定失败的调用。
 * 3. **每次调用落审计**：AI 查了谁的数据，与人工在网页上点开是同一种行为，必须留痕。
 *
 * 两条鉴权通道见 mcpAuth.ts：网页登录的 JWT（7 天）与长期令牌（可单独吊销、可限只读）。
 * 令牌的管理接口挂在 `/api/mcp/tokens`，**只认 JWT**，且必须早于 mcpAuth 注册。
 */

import { Router, Request, Response } from 'express';
import { rateLimit } from '../../middleware/rateLimit';
import { writeAudit } from '../../middleware/audit';
import { ok } from '../../utils/response';
import { logger } from '../../utils/logger';
import { groupByDomain, visibleTools, writeLevel } from './registry';
import { PROTOCOL_VERSION, SERVER_INFO, handleRpc, rpcError } from './protocol';
import { request } from './invoke';
import { mcpAuth, tokenWriteCeiling } from './mcpAuth';
import tokenRoutes from './tokenRoutes';
import { ToolCtx, ToolDef } from './types';

const router = Router();

/**
 * 令牌管理接口先挂载。
 *
 * 必须在下面的 mcpAuth 之前：它自带 authMiddleware（只认 JWT），
 * 如果先过 mcpAuth，一枚长期令牌就能给自己签发新令牌——吊销会立刻失去意义。
 */
router.use('/tokens', tokenRoutes);

// 两条通道的鉴权：JWT 或 MCP 长期令牌
router.use(mcpAuth);

/**
 * 限流按**账号**而不是 IP。
 * 村里往往是全村共用一个出口 IP，按 IP 限流会让一个人跑批处理把所有人卡住。
 * 放在 mcpAuth 之后是因为需要 req.user.id；未鉴权的请求在此之前已被 401 挡住，
 * 不构成爆破面（JWT 验签是纯计算，长期令牌是一次带唯一索引的查询）。
 */
router.use(
  rateLimit({
    windowMs: 60_000,
    max: 120,
    keyGenerator: (req: Request) => `mcp:${req.user?.id ?? req.ip}`,
    message: 'MCP 调用过于频繁，请 {retryAfter} 秒后重试',
  })
);

/**
 * 本次请求可见的工具。
 *
 * 只读令牌把写入等级压到 off：于是 `person_create` 这类工具**根本不出现在清单里**，
 * 而不是调用了才报没权限——模型看到不存在的工具就不会反复尝试。
 * 全局 MCP_WRITE_LEVEL 与令牌 scope 取更严的那个。
 */
function toolsFor(req: Request): ToolDef[] {
  const ceiling = tokenWriteCeiling(req);
  return visibleTools(req.user!, ceiling ?? writeLevel());
}

/** 组装工具执行上下文：把 Express 的请求身份转成工具层需要的最小信息 */
function makeCtx(req: Request, tools: ToolDef[]): ToolCtx {
  const user = req.user!;
  // 长期令牌换来的 5 分钟 JWT 优先：业务接口只认 JWT，直接拿令牌去转发会被 401
  const token = req.mcpForwardToken || (req.headers.authorization || '').slice('Bearer '.length);
  const toolName: string | undefined = req.body?.params?.name;

  return {
    token,
    userId: user.id,
    username: user.username,
    isAdmin: user.isAdmin,
    permissions: user.permissions,
    ip: req.ip || '',
    call: (path, query) => request(token, 'GET', path, { query, tool: toolName }),
    send: (method, path, body) => request(token, method, path, { body, tool: toolName }),
    catalog: tools.map((t) => ({ name: t.name, title: t.title, domain: t.domain, scope: t.scope })),
  };
}

/**
 * 能力清单（普通 HTTP，不是 MCP 协议）。
 * 给「系统设置」页与运维排障用：一眼看出这台机器开了哪些工具、写入是否开启。
 */
router.get('/manifest', (req: Request, res: Response) => {
  const tools = toolsFor(req);
  return ok(res, {
    server: SERVER_INFO,
    protocol: PROTOCOL_VERSION,
    endpoint: '/api/mcp',
    writeLevel: writeLevel(),
    // 令牌自身的上限比全局更低时，实际生效的是令牌的
    effectiveWriteLevel: tokenWriteCeiling(req) ?? writeLevel(),
    piiMode: process.env.MCP_PII_MODE === 'full' ? 'full' : 'mask',
    // 用长期令牌访问时告诉调用方「你是哪枚令牌、什么等级」，便于自检
    token: req.mcpToken ? { id: req.mcpToken.id, name: req.mcpToken.name, scope: req.mcpToken.scope } : null,
    total: tools.length,
    byDomain: groupByDomain(tools),
    tools: tools.map((t) => ({
      name: t.name,
      title: t.title,
      description: t.description,
      domain: t.domain,
      scope: t.scope,
      permission: t.permission,
      params: t.params || [],
    })),
  });
});

/** Streamable HTTP 要求 POST。GET 用于 SSE 的旧方案，本服务不支持，明确回 405 而不是 404 */
router.get('/', (_req: Request, res: Response) => {
  res.setHeader('Allow', 'POST');
  res.status(405).json(rpcError(null, -32600, '本端点只接受 POST（Streamable HTTP）。不支持 SSE 长连接'));
});

router.post('/', async (req: Request, res: Response) => {
  const body = req.body;

  // 2025-03-26 版协议已移除批量请求；明确拒绝比静默只处理第一条更不容易踩坑
  if (Array.isArray(body)) {
    res.status(400).json(rpcError(null, -32600, '不支持 JSON-RPC 批量请求，请逐条发送'));
    return;
  }
  if (!body || body.jsonrpc !== '2.0' || typeof body.method !== 'string') {
    res.status(400).json(rpcError(body?.id ?? null, -32600, '非法请求：需要 JSON-RPC 2.0 消息'));
    return;
  }

  const tools = toolsFor(req);
  const ctx = makeCtx(req, tools);

  try {
    const result = await handleRpc(body, ctx, tools, (tool, args, success, ms) => {
      // 不 await：审计失败不能影响工具返回（writeAudit 内部已 try/catch）。
      void writeAudit({
        userId: ctx.userId,
        username: ctx.username,
        action: `mcp.${tool}`,
        module: 'mcp',
        method: 'TOOL',
        path: '/api/mcp',
        // 参数原样记录（writeAudit 会过滤 password/token 一类字段）。
        // 这是「AI 查过谁」的唯一凭证，脱敏掉就没法追责了。
        request: args,
        result: success ? 'SUCCESS' : 'FAIL',
        ip: ctx.ip,
        durationMs: ms,
      });
    });

    // 通知（notifications/initialized 等）没有 id，按 Streamable HTTP 规范回 202 无响应体
    if (result === null) {
      res.status(202).end();
      return;
    }
    res.json(result);
  } catch (err) {
    logger.error('mcp-call-failed', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    // 兜底必须是合法的 JSON-RPC 响应：客户端拿到 HTML 错误页会直接判定连接不可用
    res.status(500).json(rpcError(body.id, -32603, '服务内部错误'));
  }
});

export default router;
