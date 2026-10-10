import { describe, it, expect, afterAll } from 'vitest';
import http from 'http';
import express from 'express';
// 必须先加载 shim，再注册路由
import '../src/utils/async-shim';

const app = express();
// async 路由直接抛出（旧版 Express 4 会成为 unhandledRejection 打崩进程）
app.get('/boom', async () => {
  throw new Error('async route error');
});
app.get('/ok', async (_req: express.Request, res: express.Response) => {
  res.json({ ok: true });
});
// 模拟统一错误处理（与 middleware/error.ts 行为一致）
// 注意：错误中间件必须注册在路由之后，Express 只调用错误发生位置之后注册的错误处理器
app.use((_err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  res.status(500).json({ code: 500, message: '服务器内部错误' });
});

const server = app.listen(0);
const port = (server.address() as any).port;
const base = `http://127.0.0.1:${port}`;
afterAll(() => server.close());

async function get(p: string) {
  const r = await fetch(base + p);
  return [r.status, await r.json()] as const;
}

describe('Express 异步错误兜底 shim', () => {
  it('async 路由抛错转交错误中间件返回 500，而不是打崩进程', async () => {
    const [status, body] = await get('/boom');
    expect(status).toBe(500);
    expect((body as any).code).toBe(500);
  });

  it('正常 async 路由不受影响', async () => {
    const [status, body] = await get('/ok');
    expect(status).toBe(200);
    expect((body as any).ok).toBe(true);
  });
});
