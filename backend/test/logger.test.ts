import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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

  it('src 下不允许再出现 console.*（日志必须走 logger，否则容器日志无法按 JSON 解析）', () => {
    const src = fileURLToPath(new URL('../src', import.meta.url));
    const offenders: string[] = [];

    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.ts')) {
          const text = fs.readFileSync(full, 'utf-8');
          // 去掉注释，避免「注释里提到 console.log」被误判
          const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
          if (/\bconsole\s*\./.test(code)) offenders.push(path.relative(src, full));
        }
      }
    };
    walk(src);

    expect(offenders, '这些文件仍在直接使用 console.*，请改用 src/utils/logger.ts').toEqual([]);
  });
});
