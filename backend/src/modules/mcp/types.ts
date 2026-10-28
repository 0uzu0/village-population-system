/**
 * MCP 工具的类型契约。
 *
 * 设计要点：**工具是「声明」，不是「路由」**。
 * 一个工具只描述四件事——叫什么、需要什么权限、接受什么参数、怎么取数；
 * 协议层（protocol.ts）、鉴权（index.ts）、脱敏与归一化（invoke.ts）都是共用的，
 * 新增一个工具不需要碰这三处任何一行代码。这是「可拓展」的落点。
 */

/** 工具的危险等级。决定默认是否注册，见 registry.ts 的 isEnabledByEnv */
export type ToolScope =
  /** 只读：默认全部开放 */
  | 'read'
  /** 普通写入：受 MCP_WRITE_LEVEL=basic|full 控制 */
  | 'write'
  /** 高危（删除、批量、账号管理）：除 full 外还需 MCP_ALLOW_DESTRUCTIVE=true */
  | 'danger';

/** 参数类型。刻意不用 zod 反射：zod v3 没有内置 toJSONSchema，引第三方包违背本项目「不轻易加依赖」的约定 */
export type ParamType = 'string' | 'integer' | 'number' | 'boolean' | 'enum' | 'object';

/**
 * 一个工具参数。
 *
 * `desc` 会原样进入 JSON Schema 的 description，模型据此决定怎么传参，
 * 因此必须写清「口径」而不只是字段名——例如 activeOnly 要说明默认值，
 * 否则模型会以为能查到已死亡档案却发现查不到。
 */
export interface ParamDef {
  key: string;
  type: ParamType;
  desc: string;
  required?: boolean;
  /** type=enum 时的候选值 */
  values?: readonly string[];
  default?: string | number | boolean;
  min?: number;
  max?: number;
}

/**
 * 工具执行上下文。
 *
 * 关键点：`call` 携带的是**调用者本人的 token**，不是服务账号。
 * 因此工具内发起的 REST 请求会完整走一遍 authMiddleware + requirePermission，
 * 权限判断只有一套实现，不会出现「MCP 能看、网页不能看」的缝隙。
 */
export interface ToolCtx {
  token: string;
  userId: number;
  username: string;
  isAdmin: boolean;
  permissions: Set<string>;
  ip: string;
  /** 只读请求（GET）。query 中 undefined/空串会被丢弃 */
  call(path: string, query?: Record<string, unknown>): Promise<any>;
  /** 写请求 */
  send(method: 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown): Promise<any>;
  /** 当前账号可见的工具清单，供 system_capabilities 自描述（避免 registry ↔ tools 循环依赖） */
  catalog: Array<{ name: string; title: string; domain: string; scope: ToolScope }>;
}

export interface ToolDef {
  /** 对外名称，snake_case，如 person_search。发布后不可改名（客户端会缓存） */
  name: string;
  /** 人类可读短标题，显示在客户端工具面板 */
  title: string;
  /** 给模型看的说明：能回答什么问题、口径是什么、什么时候该用别的工具 */
  description: string;
  /** 所属数据域，用于文档分组与覆盖度统计 */
  domain: string;
  scope: ToolScope;
  /** 调用所需权限码，与 REST 接口保持一致 */
  permission: string;
  params?: ParamDef[];
  /** 口径提示：会作为 meta.caliber 随结果返回，提醒模型不要误用数字 */
  note?: string;
  exec(ctx: ToolCtx, args: Record<string, any>): Promise<unknown>;
}

/** 参数校验失败（映射为 JSON-RPC -32602） */
export class ToolInputError extends Error {
  code = -32602;
  constructor(message: string) {
    super(message);
    this.name = 'ToolInputError';
  }
}

/** 工具执行失败（以 isError 内容返回，不算协议错误） */
export class ToolRunError extends Error {
  /** 业务错误码，如 FORBIDDEN / NOT_FOUND */
  bizCode: string;
  constructor(message: string, bizCode = 'TOOL_ERROR') {
    super(message);
    this.name = 'ToolRunError';
    this.bizCode = bizCode;
  }
}
