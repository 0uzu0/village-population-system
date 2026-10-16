import { describe, it, expect } from 'vitest';
import { rateLimit } from '../src/middleware/rateLimit';
import { checkProductionSafety, DEV_DEFAULTS } from '../src/config/env';

/** ---------- 限流中间件 ---------- */

function makeReq(ip = '1.1.1.1'): any {
  return { ip };
}

function makeRes(): any {
  const res: any = { headers: {} as Record<string, string>, statusCode: 200, body: null };
  res.setHeader = (k: string, v: string) => {
    res.headers[k] = v;
  };
  res.status = (c: number) => {
    res.statusCode = c;
    return res;
  };
  res.json = (b: any) => {
    res.body = b;
    return res;
  };
  return res;
}

/** 跑一次中间件，返回是否放行（next 被调用） */
function touch(mw: any, req: any, res: any): boolean {
  let passed = false;
  mw(req, res, () => {
    passed = true;
  });
  return passed;
}

describe('登录限流中间件', () => {
  it('窗口内未超限时放行', () => {
    const mw = rateLimit({ windowMs: 60_000, max: 2 });
    const req = makeReq();
    expect(touch(mw, req, makeRes())).toBe(true);
    expect(touch(mw, req, makeRes())).toBe(true);
  });

  it('超过上限返回 429 并带 Retry-After', () => {
    const now = 1_000_000;
    const mw = rateLimit({ windowMs: 60_000, max: 2, now: () => now });
    const req = makeReq();
    touch(mw, req, makeRes());
    touch(mw, req, makeRes());

    const res = makeRes();
    expect(touch(mw, req, res)).toBe(false);
    expect(res.statusCode).toBe(429);
    expect(res.body.errorCode).toBe('TOO_MANY_REQUESTS');
    expect(res.headers['Retry-After']).toBe('60');
  });

  it('不同 IP 各自计数（互不牵连）', () => {
    const mw = rateLimit({ windowMs: 60_000, max: 1 });
    expect(touch(mw, makeReq('1.1.1.1'), makeRes())).toBe(true);
    expect(touch(mw, makeReq('2.2.2.2'), makeRes())).toBe(true);
    expect(touch(mw, makeReq('1.1.1.1'), makeRes())).toBe(false);
  });

  it('窗口过期后重新计数', () => {
    let t = 1_000_000;
    const mw = rateLimit({ windowMs: 1_000, max: 1, now: () => t });
    const req = makeReq();
    expect(touch(mw, req, makeRes())).toBe(true);
    expect(touch(mw, req, makeRes())).toBe(false);

    t += 1_001; // 跨过窗口
    expect(touch(mw, req, makeRes())).toBe(true);
  });
});

/** ---------- 生产环境配置自检 ---------- */

describe('生产环境弱默认值校验', () => {
  it('开发环境不拦截（允许用默认值本地跑）', () => {
    expect(
      checkProductionSafety({ nodeEnv: 'development', jwtSecret: DEV_DEFAULTS.jwtSecret })
    ).toEqual([]);
  });

  it('生产环境沿用内置 JWT_SECRET 时报问题', () => {
    const problems = checkProductionSafety({
      nodeEnv: 'production',
      jwtSecret: DEV_DEFAULTS.jwtSecret,
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('JWT_SECRET');
  });

  it('生产环境自定义 JWT_SECRET 且不新建管理员时通过', () => {
    expect(
      checkProductionSafety({ nodeEnv: 'production', jwtSecret: 'a-strong-random-secret-value' })
    ).toEqual([]);
  });

  it('仅当本次会新建管理员时才校验初始口令', () => {
    const base = { nodeEnv: 'production', jwtSecret: 'a-strong-random-secret-value' };
    // 不新建管理员：即使口令是默认值也不拦（存量部署不受影响）
    expect(checkProductionSafety({ ...base, willCreateAdmin: false })).toEqual([]);
    // 要新建管理员：弱口令拦下
    const problems = checkProductionSafety({
      ...base,
      willCreateAdmin: true,
      adminInitPassword: DEV_DEFAULTS.adminPassword,
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('ADMIN_INIT_PASSWORD');
  });
});
