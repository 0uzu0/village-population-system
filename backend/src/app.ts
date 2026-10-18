// 异步错误兜底必须最先加载：包装路由 handle，async 路由的未捕获异常
// 将转交统一 errorHandler，而不是成为 unhandledRejection 打崩进程
import './utils/async-shim';
import express, { Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { env } from './config/env';
import { errorHandler, notFoundHandler } from './middleware/error';
import { auditMiddleware } from './middleware/audit';
import { requestLogger } from './middleware/requestLog';
// 注意：鉴权由各业务模块自行 router.use(authMiddleware)，这里不需要全局挂载
import authModule from './modules/auth';
import userModule from './modules/user';
import personModule from './modules/person';
import familyModule from './modules/family';
import gridModule from './modules/grid';
import tagModule from './modules/tag';
import keygroupModule from './modules/keygroup';
import statisticsModule from './modules/statistics';
import excelModule from './modules/excel';
import pendingModule from './modules/pending';
import auditModule from './modules/audit';
import ledgerModule from './modules/ledger';
import fileModule from './modules/file';

export function createApp(): Express {
  const app = express();

  app.disable('x-powered-by');

  // 安全响应头。
  // 前端 nginx 已经给页面配了 nosniff / X-Frame-Options / Referrer-Policy，
  // 这一层不是重复配置，而是覆盖「绕过 nginx 直连后端」的路径（运维排查、
  // 将来前后端分离部署）；也让 API 响应自带同一套头，不必两处分别维护。
  app.use(
    helmet({
      // CSP 约束的是 HTML 文档里能加载什么，API 只返回 JSON 与附件字节，
      // 配在这里没有作用。页面的 CSP 属于前端层，在 frontend/nginx.conf 中配置。
      contentSecurityPolicy: false,
      // 本系统的常见部署是局域网 HTTP（NAS / 内网 IP）。HSTS 一旦被浏览器记住，
      // 就会强制把后续访问升级到 HTTPS，而这类部署往往没有证书，等于把自己锁在门外。
      // 是否启用交给真正提供 HTTPS 的反向代理层决定。
      hsts: false,
    })
  );

  // CORS：生产是同源部署（frontend 的 nginx 把 /api 反代到后端），不需要跨域。
  // 因此默认**不放开**，只有前后端分离部署时才在 .env 里显式配 CORS_ORIGIN
  //（逗号分隔多个来源）。原先默认 '*' 会走 `origin: true` 反射任意来源，
  // 等于允许任何网站读取本系统接口响应。
  // credentials 固定 false：本项目 token 走 Authorization 头，不用 cookie，
  // 而「反射来源 + credentials」正是最危险的组合。
  app.use(
    cors({
      origin: env.corsOrigin ? env.corsOrigin.split(',').map((s) => s.trim()) : false,
      credentials: false,
    })
  );
  app.use(express.json({ limit: '2mb' }));

  // 请求日志（分配请求 ID + 记录访问日志），放在最前面以便后续所有环节都能串联
  app.use(requestLogger);

  // 健康检查（不鉴权，供容器/负载均衡探活）
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'UP', time: new Date().toISOString() });
  });

  // 审计中间件（记录写操作）
  app.use(auditMiddleware);

  // 业务路由
  app.use('/api/auth', authModule);
  app.use('/api/users', userModule);
  app.use('/api/persons', personModule);
  app.use('/api/families', familyModule);
  app.use('/api/grids', gridModule);
  app.use('/api/tags', tagModule);
  app.use('/api/key-groups', keygroupModule);
  app.use('/api/statistics', statisticsModule);
  app.use('/api/excel', excelModule);
  app.use('/api/pending', pendingModule);
  app.use('/api/audit-logs', auditModule);
  app.use('/api/ledgers', ledgerModule);
  app.use('/api/files', fileModule);

  // 未匹配路由与错误处理
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
