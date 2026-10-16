import { describe, it, expect, vi, afterEach } from 'vitest';
import { formatLogLine, shouldLog, logger, newRequestId } from '../src/utils/logger';

afterEach(() => vi.restoreAllMocks());

describe('结构化日志', () => {
  it('formatLogLine 输出单行 JSON，含 ts/level/msg 与自定义字段', () => {
    const line = formatLogLine('info', 'http', { status: 200, cost: 12 });
    expect(line.includes('\n')).toBe(false);

    const obj = JSON.parse(line);
    expect(obj.level).toBe('info');
    expect(obj.msg).toBe('http');
    expect(obj.status).toBe(200);
    expect(obj.cost).toBe(12);
    expect(typeof obj.ts).toBe('string');
    expect(Number.isNaN(Date.parse(obj.ts))).toBe(false);
  });

  it('shouldLog 按级别高低过滤', () => {
    expect(shouldLog('error', 'warn')).toBe(true);
    expect(shouldLog('warn', 'warn')).toBe(true);
    expect(shouldLog('info', 'warn')).toBe(false);
    expect(shouldLog('debug', 'debug')).toBe(true);
  });

  it('info/debug 走 stdout，warn/error 走 stderr（容器日志天然分流）', () => {
    const out = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const err = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    logger.info('hello');
    expect(out).toHaveBeenCalledTimes(1);
    expect(err).not.toHaveBeenCalled();

    logger.error('boom', { requestId: 'abc' });
    expect(err).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(String(err.mock.calls[0][0]));
    expect(payload.msg).toBe('boom');
    expect(payload.requestId).toBe('abc');
  });

  it('newRequestId 生成 8 位十六进制短 ID', () => {
    const id = newRequestId();
    expect(id).toMatch(/^[0-9a-f]{8}$/);
  });
});
