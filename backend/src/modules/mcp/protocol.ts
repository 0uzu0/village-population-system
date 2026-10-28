/**
 * MCP 协议层（JSON-RPC 2.0 over Streamable HTTP，无状态）。
 *
 * 为什么手写而不引 @modelcontextprotocol/sdk：
 * 本项目只需要 tools/* 这一条能力线，消息格式是稳定的三十来行 JSON-RPC；
 * 引 SDK 会带来一个较大的依赖树与版本耦合，而收益只有「省几十行」。
 * 这与项目里 rateLimit、loadEnvFile 的取舍一致（见各自注释）。
 * 将来若要接 resources 订阅、sampling 等高级能力，再换 SDK 也不影响工具层。
 */

import { ToolDef, ToolCtx, ToolInputError, ToolRunError } from './types';
import { toJsonSchema, coerceArgs } from './params';

/** 协议版本。2025-03-26 是 Streamable HTTP 正式版；更早的 SSE 双端点方案已弃用 */
export const PROTOCOL_VERSION = '2025-03-26';
export const SERVER_INFO = { name: 'village-population-mcp', version: '1.0.0' };

export interface RpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: any;
}

export function rpcResult(id: string | number | null | undefined, result: unknown): Record<string, unknown> {
  return { jsonrpc: '2.0', id: id ?? null, result };
}

export function rpcError(
  id: string | number | null | undefined,
  code: number,
  message: string,
  data?: unknown
): Record<string, unknown> {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message, ...(data === undefined ? {} : { data }) } };
}

/** 工具 → MCP tools/list 条目 */
export function toMcpTool(t: ToolDef): Record<string, unknown> {
  return {
    name: t.name,
    title: t.title,
    description: t.description,
    inputSchema: toJsonSchema(t.params || []),
    annotations: {
      // 客户端据此决定要不要弹二次确认。它不是权限，只是提示；
      // 真正的防线在 RBAC 与 MCP_WRITE_LEVEL。
      readOnlyHint: t.scope === 'read',
      destructiveHint: t.scope === 'danger',
      idempotentHint: t.scope === 'read',
      openWorldHint: false,
    },
    _meta: { domain: t.domain, scope: t.scope, permission: t.permission },
  };
}

/**
 * 处理一条 JSON-RPC 消息。
 *
 * 返回值约定：`null` 表示这是通知（notification），不需要响应体。
 * 调用方据此决定回 200 还是 202。
 */
export async function handleRpc(
  msg: RpcRequest,
  ctx: ToolCtx,
  tools: ToolDef[],
  onCall?: (tool: string, args: Record<string, any>, ok: boolean, ms: number) => void
): Promise<Record<string, unknown> | null> {
  const isNotification = msg.id === undefined || msg.id === null;

  switch (msg.method) {
    case 'initialize':
      return rpcResult(msg.id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {
          tools: { listChanged: false },
          // 明确声明不支持资源与提示词：客户端就不会去调 resources/list，
          // 少一次必然失败的往返。
          resources: {},
          prompts: {},
        },
        serverInfo: SERVER_INFO,
        instructions:
          '本服务提供村庄人口管理系统的只读查询与（可选）写入能力。' +
          '所有结果与网页端同源同口径；人数类问题请优先用 stats_* 与 keygroup_*，不要用分页 total 相加。',
      });

    case 'notifications/initialized':
    case 'notifications/cancelled':
      return null;

    case 'ping':
      return rpcResult(msg.id, {});

    case 'tools/list':
      return rpcResult(msg.id, { tools: tools.map(toMcpTool) });

    case 'resources/list':
      return rpcResult(msg.id, { resources: [] });

    case 'prompts/list':
      return rpcResult(msg.id, { prompts: [] });

    case 'tools/call': {
      if (isNotification) return null;
      const name = msg.params?.name;
      const rawArgs = msg.params?.arguments;

      const tool = tools.find((t) => t.name === name);
      if (!tool) {
        // 区分「不存在」与「存在但没开」，模型才能给出正确建议：
        // 前者说工具名错了，后者说需要管理员开启写入。
        return rpcError(msg.id, -32602, `未知工具：${name}。可调用 tools/list 查看当前可用工具`);
      }

      let args: Record<string, any>;
      try {
        args = coerceArgs(tool.params || [], rawArgs);
      } catch (err) {
        if (err instanceof ToolInputError) return rpcError(msg.id, -32602, err.message);
        throw err;
      }

      const started = Date.now();
      try {
        const data = await tool.exec(ctx, args);
        const ms = Date.now() - started;
        onCall?.(tool.name, args, true, ms);

        // 统一外壳：data 平铺 + _meta 携带口径与耗时。
        // 口径必须随结果走——模型读不到文档，只读得到这次返回。
        const body = data && typeof data === 'object' && !Array.isArray(data) ? data : { data };
        const payload = {
          ...body,
          _meta: {
            tool: tool.name,
            serverTime: new Date().toISOString(),
            durationMs: ms,
            ...(tool.note ? { caliber: tool.note } : {}),
          },
        };
        return rpcResult(msg.id, {
          content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
        });
      } catch (err) {
        const ms = Date.now() - started;
        onCall?.(tool.name, args, false, ms);

        // 业务错误（403/404/校验失败）走 isError 内容，而不是 JSON-RPC error：
        // 协议错误意味着「调用方式不对」，业务错误意味着「这次查询没有结果」，
        // 模型对两者的处理方式完全不同，混在一起会让它反复重试。
        if (err instanceof ToolRunError) {
          return rpcResult(msg.id, {
            isError: true,
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    error: err.message,
                    code: err.bizCode,
                    hint: hintFor(err.bizCode, err.message),
                  },
                  null,
                  2
                ),
              },
            ],
          });
        }
        throw err;
      }
    }

    default:
      return rpcError(msg.id, -32601, `不支持的方法：${msg.method}`);
  }
}

/**
 * 把常见业务错误码翻译成「下一步该做什么」，避免模型原地重试。
 *
 * 需要原始 message，因为 NOT_FOUND 有歧义：可能是「这条记录没了」，
 * 也可能是「MCP 工具指向的后端接口根本不存在」（部署版本与工具定义不匹配）。
 * 前者该换个 id 再试，后者让模型换 id 是白费功夫，得提示人去看部署版本——
 * 线上曾真实出现：内部转发漏了 /api 前缀，全部工具都在报「记录不存在」。
 */
function hintFor(code: string, message = ''): string | undefined {
  switch (code) {
    case 'FORBIDDEN':
      return '当前账号没有该数据的查看权限，请让用户用有权限的账号登录，或不要继续尝试。';
    case 'UNAUTHORIZED':
    case 'TOKEN_REVOKED':
      return '登录状态已失效，请用户在网页端重新登录后更新客户端里的 token。';
    case 'NOT_FOUND':
      if (message.includes('接口不存在')) {
        return '这不是数据问题：MCP 工具指向的后端接口不存在，通常是后端版本与工具定义不匹配。请让管理员确认服务已升级到包含 MCP 的版本。';
      }
      return '记录不存在，可能已被删除或 id 填错；可先用列表类工具确认 id。';
    case 'DUPLICATE_ID_CARD':
      return '该身份证已在人员档案中，请改用 person_search 查找已有人员。';
    case 'EXCLUSIVE_TAG_CONFLICT':
      return '标签互斥：该人已属于同组中优先级更高的类别，需先移除原标签。';
    case 'ALREADY_RESOLVED':
      return '该待核查记录已入库，不能重复操作。';
    case 'UPSTREAM_ERROR':
      return '后端服务异常或超时，稍后重试；持续失败请让管理员查看服务日志。';
    default:
      return undefined;
  }
}
