/**
 * 参数声明 → JSON Schema，以及运行时校验。
 *
 * 为什么不直接用 zod 的 schema 当工具入参：
 * MCP 协议要求 tools/list 返回标准 JSON Schema，而 zod v3 没有内置转换；
 * 引 zod-to-json-schema 会多一个依赖与一处版本耦合。参数总量可控，
 * 用一份显式的 ParamDef 同时产出 schema 与校验，反而更直观、更不容易和实现走样。
 */

import { ParamDef, ToolInputError } from './types';

/** 单个参数 → JSON Schema 片段 */
function propertyOf(p: ParamDef): Record<string, unknown> {
  const base: Record<string, unknown> =
    p.type === 'enum'
      ? { type: 'string', enum: [...(p.values || [])] }
      : p.type === 'object'
        ? // 自由结构体（如残疾档案）。字段约束由后端 zod 兜底，
          // 这里只声明类型，避免把 20 个字段的 schema 抄两遍。
          { type: 'object', additionalProperties: true }
        : { type: p.type === 'integer' ? 'integer' : p.type };

  const out: Record<string, unknown> = { ...base, description: p.desc };
  if (p.default !== undefined) out.default = p.default;
  if (p.min !== undefined) out.minimum = p.min;
  if (p.max !== undefined) out.maximum = p.max;
  return out;
}

/** 整个工具 → 对象型 JSON Schema */
export function toJsonSchema(params: ParamDef[] = []): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const p of params) {
    properties[p.key] = propertyOf(p);
    if (p.required) required.push(p.key);
  }
  const schema: Record<string, unknown> = { type: 'object', properties };
  if (required.length) schema.required = required;
  // 明确声明不接受未定义字段：模型偶发的多余键会被多数客户端提前拦掉，
  // 省一次无意义的调用。注意服务端仍然宽松处理（见 coerceArgs），
  // 因为部分客户端并不校验 schema。
  schema.additionalProperties = false;
  return schema;
}

/**
 * 校验并归一化入参。
 *
 * 三件必须做的事：
 * 1. **类型收敛**：模型经常把整数写成字符串（"20"），把布尔写成 "true"。
 *    这里统一转成真类型，否则下游 query 拼装会拿到字符串，SQL 参数绑定报错或语义错。
 * 2. **补默认值**：让工具描述里写的 default 真正生效，而不是只写在 schema 里好看。
 * 3. **丢弃空串**：空串在筛选语义里等于「不过滤」，原样传给 REST 会被当成筛选条件。
 */
export function coerceArgs(params: ParamDef[] = [], raw: unknown): Record<string, any> {
  if (raw !== undefined && raw !== null && (typeof raw !== 'object' || Array.isArray(raw))) {
    throw new ToolInputError('arguments 必须是对象');
  }
  const input = (raw || {}) as Record<string, unknown>;
  const out: Record<string, any> = {};

  for (const p of params) {
    const v = input[p.key];

    if (v === undefined || v === '') {
      if (p.default !== undefined) out[p.key] = p.default;
      else if (p.required) throw new ToolInputError(`缺少必填参数 ${p.key}（${p.desc}）`);
      continue;
    }

    // 显式 null 要保留：写接口的「清空该字段」语义就是 null，
    // 如果在这里当成「没传」，用户就没法用 AI 清掉一个填错的手机号。
    // 读接口不受影响——request() 拼 query 时会跳过 null。
    if (v === null) {
      if (p.required) throw new ToolInputError(`参数 ${p.key} 不能为 null`);
      out[p.key] = null;
      continue;
    }

    out[p.key] = coerceOne(p, v);
  }

  return out;
}

function coerceOne(p: ParamDef, v: unknown): any {
  switch (p.type) {
    case 'integer': {
      const n = typeof v === 'number' ? v : Number(String(v).trim());
      if (!Number.isFinite(n) || !Number.isInteger(n)) {
        throw new ToolInputError(`参数 ${p.key} 必须是整数，收到 ${JSON.stringify(v)}`);
      }
      return checkRange(p, n);
    }
    case 'number': {
      const n = typeof v === 'number' ? v : Number(String(v).trim());
      if (!Number.isFinite(n)) {
        throw new ToolInputError(`参数 ${p.key} 必须是数字，收到 ${JSON.stringify(v)}`);
      }
      return checkRange(p, n);
    }
    case 'boolean': {
      if (typeof v === 'boolean') return v;
      const s = String(v).trim().toLowerCase();
      if (s === 'true' || s === '1') return true;
      if (s === 'false' || s === '0') return false;
      throw new ToolInputError(`参数 ${p.key} 必须是布尔值，收到 ${JSON.stringify(v)}`);
    }
    case 'enum': {
      const s = String(v).trim();
      if (!(p.values || []).includes(s)) {
        throw new ToolInputError(`参数 ${p.key} 只能取 ${(p.values || []).join(' / ')}，收到 ${s}`);
      }
      return s;
    }
    case 'object': {
      if (typeof v !== 'object' || Array.isArray(v)) {
        throw new ToolInputError(`参数 ${p.key} 必须是对象`);
      }
      return v;
    }
    default: {
      if (typeof v === 'object') {
        throw new ToolInputError(`参数 ${p.key} 必须是字符串`);
      }
      return String(v);
    }
  }
}

function checkRange(p: ParamDef, n: number): number {
  if (p.min !== undefined && n < p.min) {
    throw new ToolInputError(`参数 ${p.key} 不能小于 ${p.min}`);
  }
  if (p.max !== undefined && n > p.max) {
    throw new ToolInputError(`参数 ${p.key} 不能大于 ${p.max}`);
  }
  return n;
}
