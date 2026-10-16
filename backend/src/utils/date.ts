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

/** 北京时间偏移。与 config/db.ts 的 timezone '+08:00' 同一口径 */
const CN_OFFSET_MS = 8 * 60 * 60 * 1000;

/**
 * DATETIME 列格式化为北京时间文本 `YYYY-MM-DD HH:mm:ss`。
 *
 * ## 为什么不直接返回 Date（JSON 里就是 ISO 的 UTC 串）
 *
 * `dateStrings` 只对 DATE 生效，DATETIME 仍会被 mysql2 解析成 Date，`res.json()`
 * 序列化后变成 `2026-10-16T05:00:00.000Z`。客户端只要有一次「图省事」直接切字符串
 * （`String(t).replace('T',' ').slice(0,16)`），就会把 13:00 拍的现场照片显示成 05:00 ——
 * 少整整 8 小时，而且文件名字段里写的又是 13:00，两处对不上。
 * 附件的时间是取证材料的一部分，不允许出现这种偏差，所以由服务端按北京时间统一成
 * 无歧义的朴素文本，前端与手机端都只做展示、不做时区换算。
 *
 * 换算用「先加 8 小时再取 UTC 字段」的手工移位，不依赖容器时区与 ICU 数据：
 * 镜像跑在 UTC 还是 +08:00，结果都一样。
 *
 * 字符串分支**不做时区猜测**：带 `T` 的按 ISO 解析（含 Z / 偏移量），
 * 空格分隔的只认 `YYYY-MM-DD HH:mm[:ss]` 这种朴素写法（已含 DATE_FORMAT 的结果），
 * 其余一律返回 null —— 猜错的时区比没有值更糟。
 */
export function dateTimeCN(v: unknown): string | null {
  if (v == null || v === '') return null;

  if (typeof v === 'string') {
    const s = v.trim();
    // 主路径：已经是朴素写法（DATE_FORMAT 的结果、或别处生成的文本），原样沿用
    const plain = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})(?::(\d{2}))?/.exec(s);
    if (plain) return `${plain[1]} ${plain[2]}:${plain[3] ?? '00'}`;
    // 只认明确的 ISO 8601（带 T，或带 Z / ±hh:mm 偏移）。
    // '2026/10/16 13:00' 这类一律返回 null：按本机时区猜出来的时间比没有值更糟。
    if (!/[Tt]|[Zz]|[+-]\d{2}:?\d{2}$/.test(s)) return null;
    const ms = Date.parse(s);
    return Number.isFinite(ms) ? dateTimeCN(new Date(ms)) : null;
  }

  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    const t = new Date(v.getTime() + CN_OFFSET_MS);
    const p = (n: number) => String(n).padStart(2, '0');
    return (
      `${t.getUTCFullYear()}-${p(t.getUTCMonth() + 1)}-${p(t.getUTCDate())}` +
      ` ${p(t.getUTCHours())}:${p(t.getUTCMinutes())}:${p(t.getUTCSeconds())}`
    );
  }

  return null;
}