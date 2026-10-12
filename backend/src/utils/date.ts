/**
 * 日期处理工具。
 *
 * ## DATE 列为什么不会变成"错一天"
 *
 * 连接池已配`dateStrings: ['DATE']`（见 config/db.ts），DATE 列
 * （birth_date / status_date / effect_date 等）直接以字符串返回，不经 Date 转换——
 * 日历日期本就不含时刻，转成 Date 才是不确定性的来源（同一个值换个环境时区
 * 就会差一天）。
 *
 * ## 为什么禁止 toISOString().slice(0, 10)
 *
 * 该写法按 UTC 取年月日，遇到「本地零点的时刻对象」会退回前一天：
 *   1990-01-15 00:00 +08:00 → UTC 1990-01-14 16:00Z → "1990-01-14"
 * 身份证派生的出生日期、状态生效日期都会显示错一天；
 * pending.ts 还会把错误日期写回 birth_date，**直接污染数据**。
 *
 * ## Date 分支的约定
 *
 * DATE 列已是字符串，这里保留 Date 分支用于 DATETIME（如 created_at），
 * 按本地时区取值即可（DATETIME 本身是时刻，按本地时区展示是正确语义）。
 */

/** 统一格式化为 YYYY-MM-DD */
export function formatDate(v: unknown): string | null {
  if (v == null || v === '') return null;

  if (typeof v === 'string') {
    // DATE 列的主路径：驱动已返回 'YYYY-MM-DD'，直接规范取前段
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v.trim());
    return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
  }

  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    // 按本地时区取年月日：Date 代表「时刻」，按本地时区展示是正确语义
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, '0');
    const d = String(v.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  return null;
}

/** 同 formatDate，但空值返回空字符串（导出单元格、拼接文本时用） */
export function formatDateOrEmpty(v: unknown): string {
  return formatDate(v) || '';
}

/** 今天（YYYY-MM-DD，本地时区） */
export function today(): string {
  return formatDate(new Date()) || '';
}