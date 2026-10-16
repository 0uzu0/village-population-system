import { z } from 'zod';

/**
 * zod 字段写法统一入口。
 *
 * 背景（已踩过的坑）：可空字符串字段原先普遍写成
 *   `z.string().max(n).nullable().optional()`
 * 这个联合类型**只接受 undefined / string / ''，不接受 null**。而编辑弹窗回显时
 * 详情接口会返回 `null`（不是 ''），一旦提交就会 zod 报 `Invalid input` → 500。
 *
 * 现在统一走下面的 helper，全部改成 `.nullable().optional()`（null 合法），
 * 并由 test/schema.test.ts 静态断言「源码中不得再出现 .or(z.literal(空串)) 联合写法」防止回退。
 */

/** 可空字符串：接受 undefined / null / ''（'' 本身是合法字符串，行为与旧写法一致） */
export function nullableStr(max?: number, message?: string): z.ZodTypeAny {
  const base = max === undefined ? z.string() : z.string().max(max, message);
  return base.nullable().optional();
}

/**
 * 查询参数里的可选枚举：允许缺省，也允许空串。
 * 前端「未选择」可能传 ''（否则 zod 会 400），这里把 '' 归一化成 undefined 再套默认值。
 */
export function queryEnum<T extends [string, ...string[]]>(
  values: T,
  fallback: T[number]
): z.ZodType<T[number]> {
  return z.preprocess(
    (v) => (v === '' || v === null ? undefined : v),
    z.enum(values).default(fallback)
  ) as unknown as z.ZodType<T[number]>;
}
