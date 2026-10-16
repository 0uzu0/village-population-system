import { Request, Response, NextFunction, RequestHandler } from 'express';
import { fail } from '../utils/response';

/**
 * 极简内存固定窗口限流。
 *
 * 为什么不引 express-rate-limit：本项目部署形态是**单容器单进程**
 * （见 deploy/docker-compose.yml，backend 只有一个副本），内存计数即可满足
 * 登录爆破防护；引第三方包会带来 package-lock 变更与 CI `npm ci` 的额外风险，
 * 收益不成正比。若将来横向扩容多副本，需换成 Redis 等共享存储。
 *
 * 用途：登录接口。防止用固定账号字典暴力破解密码。
 */
export interface RateLimitConfig {
  /** 窗口长度（毫秒） */
  windowMs: number;
  /** 窗口内允许的最大请求数 */
  max: number;
  /** 计数键，默认按来源 IP */
  keyGenerator?: (req: Request) => string;
  /** 超限时的提示文案（可含 {retryAfter} 占位） */
  message?: string;
  /** 可注入时钟，便于单元测试，默认 Date.now */
  now?: () => number;
}

interface Bucket {
  count: number;
  resetAt: number;
}

export function rateLimit(config: RateLimitConfig): RequestHandler {
  const { windowMs, max } = config;
  const now = config.now ?? (() => Date.now());
  const keyOf = config.keyGenerator ?? ((req: Request) => req.ip || req.socket.remoteAddress || 'unknown');
  const buckets = new Map<string, Bucket>();
  let lastPrune = now();

  return (req: Request, res: Response, next: NextFunction): void => {
    const t = now();

    // 惰性清理：每过一个窗口清一遍过期桶，避免长期运行内存只增不减
    if (t - lastPrune >= windowMs) {
      for (const [key, bucket] of buckets) {
        if (bucket.resetAt <= t) buckets.delete(key);
      }
      lastPrune = t;
    }

    const key = keyOf(req);
    const bucket = buckets.get(key);

    if (!bucket || bucket.resetAt <= t) {
      buckets.set(key, { count: 1, resetAt: t + windowMs });
      next();
      return;
    }

    bucket.count += 1;
    if (bucket.count > max) {
      const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - t) / 1000));
      res.setHeader('Retry-After', String(retryAfter));
      fail(
        res,
        (config.message || '操作过于频繁，请 {retryAfter} 秒后重试').replace('{retryAfter}', String(retryAfter)),
        429,
        'TOO_MANY_REQUESTS'
      );
      return;
    }

    next();
  };
}

/** 登录限流：同一来源 IP 每分钟最多 10 次尝试（正常用户不会触发） */
export const loginRateLimit = rateLimit({
  windowMs: 60_000,
  max: 10,
  message: '登录尝试过于频繁，请 {retryAfter} 秒后重试',
});
