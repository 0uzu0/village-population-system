/**
 * 日期处理工具。
 *
 * ## 为什么不能用 toISOString().slice(0, 10)
 *
 * 连接池配置了 `timezone: '+08:00'`，mysql2 会把 DATE 列（如 birth_date）
 * 解析成本地零点的时刻对象：`1990-01-15` → `1990-01-15 00:00:00 +08:00`，
 * 对应 UTC 时刻是 `1990-01-14 16:00:00Z`。此时再调 toISOString() 会转成 UTC
 * 输出，得到 `1990-01-14`——**所有 DATE 字段都会凭空少一天**。
 *
 * 身份证派生的出生日期、补贴台账的发放日期、状态变更日期都会被显示错一天，
 * 而且待核查表补录时会把错误日期写回 birth_date，直接污染数据。
 *
 * ## 正确做法
 *
 * 一律用本工具的 formatDate()，按**本地时区**取年月日，不经过 UTC 转换。
 */

/** 统一格式化为 YYYY-MM-DD（按本地时区，不做 UTC 偏移） */
export function formatDate(v: unknown): string | null {
  if (v == null || v === '') return null;
  if (typeof v === 'string') {
    // 已是字符串的（dateStrings 或驱动返回文本）直接取日期部分
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v.trim());
    return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
  }
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, '0');
    const d = String(v.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return null;
}

/** 同formatDate，但空值返回空字符串（导出单元格、拼接文本时用） */
export function formatDateOrEmpty(v: unknown): string {
  return formatDate(v) || '';
}

/** 今天（YYYY-MM-DD，按本地时区） */
export function today(): string {
  return formatDate(new Date()) || '';
}