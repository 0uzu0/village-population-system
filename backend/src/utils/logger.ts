/**
 * 极简结构化日志。
 *
 * 为什么不引 pino/winston：本项目日志消费方是 `docker logs` 与运维肉眼排查，
 * 需求就是「一行一条 JSON、能按 level 过滤、带请求 ID」，几十行足够；
 * 引第三方库会带来 package-lock 变更与 CI `npm ci` 风险，收益不成正比。
 *
 * 输出格式（单行 JSON，便于 docker logs 与后续接入采集器）：
 *   {"ts":"2026-01-01T00:00:00.000Z","level":"info","msg":"http","requestId":"ab12cd34",...}
 *
 * 约定：warn/error 走 stderr，其余走 stdout（容器日志里天然分流）。
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogFields {
  [key: string]: unknown;
}

/** 低于该级别不输出（生产默认 info，排查时设 LOG_LEVEL=debug） */
const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const MIN_LEVEL = (process.env.LOG_LEVEL as LogLevel) || 'info';

export function shouldLog(level: LogLevel, minLevel: LogLevel = MIN_LEVEL): boolean {
  return LEVEL_ORDER[level] >= (LEVEL_ORDER[minLevel] ?? 20);
}

/** 序列化一行日志（纯函数，便于单测） */
export function formatLogLine(level: LogLevel, msg: string, fields: LogFields = {}): string {
  return JSON.stringify({ ts: new Date().toISOString(), level, msg, ...fields });
}

function emit(level: LogLevel, msg: string, fields?: LogFields): void {
  if (!shouldLog(level)) return;
  const line = `${formatLogLine(level, msg, fields)}\n`;
  if (level === 'warn' || level === 'error') process.stderr.write(line);
  else process.stdout.write(line);
}

export const logger = {
  debug: (msg: string, fields?: LogFields) => emit('debug', msg, fields),
  info: (msg: string, fields?: LogFields) => emit('info', msg, fields),
  warn: (msg: string, fields?: LogFields) => emit('warn', msg, fields),
  error: (msg: string, fields?: LogFields) => emit('error', msg, fields),
};

/**
 * 生成短请求 ID（8 位十六进制）。用 crypto.randomUUID 截断，
 * 只在日志里做串联用，不需要全局唯一保证。
 */
export function newRequestId(): string {
  return Math.random().toString(16).slice(2, 10);
}
