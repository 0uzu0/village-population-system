/**
 * 内部 REST 调用、字段归一化、敏感信息脱敏。
 *
 * 为什么走「自己请求自己」而不是直接调 service：
 * 本项目的在册口径、互斥标签、残疾等级、家庭在册判定等规则都写在路由的 SQL 里，
 * 且权限与审计都挂在路由层。再实现一遍必然与网页漂移——那时 AI 报的人数和页面
 * 对不上，用户只会认为系统坏了。多一次 loopback 往返（约 2~5ms）换零重复，值得。
 */

import { env } from '../../config/env';
import { piiMode } from './config';
import { ToolRunError } from './types';

/**
 * 内部调用地址。
 * 默认打本进程监听端口；容器里同进程，一定通。
 * 允许用 MCP_INTERNAL_BASE 覆盖，是为了将来把 MCP 拆成独立进程时不必改代码。
 */
/**
 * 所有业务路由都挂在 `/api` 下，内部转发也必须带，否则一定 404。
 * 这里写成常量而不是散落在各工具里，是因为漏一次就是「所有工具全废」。
 */
const API_PREFIX = '/api';

function baseUrl(): string {
  const raw = (process.env.MCP_INTERNAL_BASE || `http://127.0.0.1:${env.port}`).replace(/\/+$/, '');
  // 允许覆盖值自带 /api（http://host:port/api 也认），避免拼成 /api/api
  return raw.endsWith(API_PREFIX) ? raw : raw + API_PREFIX;
}

/**
 * 拼出内部请求 URL。
 *
 * 必须手工拼接，**不能**用 `new URL(path, baseUrl())`：
 * 工具传入的 path 以 `/` 开头属于「绝对路径」，会连同 base 的路径段一起替换掉，
 * `/api` 就这样被静默吃掉——所有工具统一 404，而单测里 mock 掉 request 完全发现不了。
 * 曾真实发生过：线上 tools/call 全报「接口不存在: GET /persons」。
 */
export function internalUrl(path: string, query?: Record<string, unknown>): URL {
  const p = path.startsWith('/') ? path : `/${path}`;
  const url = new URL(baseUrl() + p);
  for (const [k, v] of Object.entries(query || {})) {
    if (v === undefined || v === null || v === '') continue;
    url.searchParams.set(k, String(v));
  }
  return url;
}

const TIMEOUT_MS = 15_000;

export interface RawResult {
  code: number;
  message: string;
  data: any;
  errorCode?: string;
}

/**
 * 发起一次内部请求。
 *
 * 两个必须带上的头：
 * - Authorization：调用者本人 token。少了它，requirePermission 就形同虚设。
 * - X-MCP-Call：给 auditMiddleware 认的标记。MCP 自己在协议层写一条更完整的审计
 *   （含工具名与参数），这里再记一条 POST /api/mcp 只会产生噪声。
 */
export async function request(
  token: string,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  options: { query?: Record<string, unknown>; body?: unknown; tool?: string } = {}
): Promise<any> {
  const url = internalUrl(path, options.query);

  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-MCP-Call': '1',
        ...(options.tool ? { 'X-MCP-Tool': options.tool } : {}),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new ToolRunError(`内部请求失败：${msg}`, 'UPSTREAM_ERROR');
  }

  // 先按 JSON 解析：本系统所有接口统一 {code,message,data} 信封，
  // 即便是 401/403 也带 message，能直接转成模型看得懂的话术。
  let payload: RawResult | null = null;
  try {
    payload = (await res.json()) as RawResult;
  } catch {
    payload = null;
  }

  if (!res.ok || !payload || payload.code !== 0) {
    const message = payload?.message || `请求失败（HTTP ${res.status}）`;
    const bizCode = payload?.errorCode || statusToCode(res.status);
    throw new ToolRunError(message, bizCode);
  }

  return payload.data;
}

function statusToCode(status: number): string {
  if (status === 401) return 'UNAUTHORIZED';
  if (status === 403) return 'FORBIDDEN';
  if (status === 404) return 'NOT_FOUND';
  if (status === 429) return 'TOO_MANY_REQUESTS';
  if (status >= 500) return 'UPSTREAM_ERROR';
  return 'BAD_REQUEST';
}

/** 下划线段检测：只转真正的 snake_case 键，避免误伤 `_x` 这类内部键 */
const SNAKE = /^[a-z][a-z0-9]*(_[a-z0-9]+)+$/;

function toCamel(key: string): string {
  return key.replace(/_([a-z0-9])/g, (_m, c: string) => c.toUpperCase());
}

/**
 * 字段风格归一化。
 *
 * 现状是两套：人员类接口经 toPersonVO 输出驼峰，而 /grids、/grids/villages、
 * /pending 直接返回 SQL 原始行（下划线）。同一次对话里混着两种命名，
 * 模型极易把 grid_id 和 gridId 当成两个东西，或干脆取不到值。
 * MCP 出口统一成驼峰——这也是本层存在的核心价值之一。
 */
export function normalizeKeys(value: any): any {
  if (Array.isArray(value)) return value.map(normalizeKeys);
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(value)) {
      out[SNAKE.test(k) ? toCamel(k) : k] = normalizeKeys(v);
    }
    return out;
  }
  return value;
}

/**
 * 脱敏模式由 config.ts 统一解析（会容忍 .env 里的引号、空格、\r 与大小写），
 * 这里不再自己比较环境变量——写法稍有出入就会静默退回 mask，排查成本极高。
 */

/** 身份证：保留前 6 位（地区码）与后 4 位，中间打码。既可用于核对，又不泄露完整号 */
function maskIdCard(v: string): string {
  if (v.length < 10) return '****';
  return `${v.slice(0, 6)}${'*'.repeat(v.length - 10)}${v.slice(-4)}`;
}

/** 手机号：保留前 3 后 4 */
function maskPhone(v: string): string {
  if (v.length <= 7) return '****';
  return `${v.slice(0, 3)}${'*'.repeat(v.length - 7)}${v.slice(-4)}`;
}

/** 银行账号 / 证件号：只留后 4 位 */
function maskTail(v: string): string {
  if (v.length <= 4) return '****';
  return `${'*'.repeat(v.length - 4)}${v.slice(-4)}`;
}

const ID_CARD_KEYS = new Set(['idCard']);
const PHONE_KEYS = new Set(['phone', 'phoneBackup', 'guardianPhone', 'managerPhone', 'contactPhone']);
const TAIL_KEYS = new Set(['bankAccount', 'disabilityCard']);

/**
 * 递归脱敏。
 *
 * 默认开启而不是默认关闭，是因为 MCP 的另一端通常是大模型服务，
 * 身份证与银行账号一旦进了上下文就无法撤回。默认打码、需要时由部署方
 * 显式改成 full，比反过来安全得多。
 */
export function maskPii(value: any): any {
  if (piiMode() === 'full') return value;
  if (Array.isArray(value)) return value.map(maskPii);
  if (value && typeof value === 'object') {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(value)) {
      if (typeof v === 'string') {
        if (ID_CARD_KEYS.has(k)) out[k] = maskIdCard(v);
        else if (PHONE_KEYS.has(k)) out[k] = maskPhone(v);
        else if (TAIL_KEYS.has(k)) out[k] = maskTail(v);
        else out[k] = v;
      } else {
        out[k] = maskPii(v);
      }
    }
    return out;
  }
  return value;
}

/** 归一化 + 脱敏，工具里统一走这一个入口 */
export function shape<T = any>(data: T): T {
  return maskPii(normalizeKeys(data)) as T;
}

/**
 * 分页结果整形。
 * REST 已统一 {list,total,page,pageSize}，这里统一成 items + 显式 hasMore，
 * 让模型不必自己算「还有没有下一页」。
 */
export function paged(data: any): Record<string, any> {
  const d = shape(data || {});
  const total = Number(d.total || 0);
  const page = Number(d.page || 1);
  const pageSize = Number(d.pageSize || 20);
  return {
    items: d.list || [],
    total,
    page,
    pageSize,
    hasMore: page * pageSize < total,
  };
}
