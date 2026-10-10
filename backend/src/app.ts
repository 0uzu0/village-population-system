// 异步错误兜底必须最先加载：包装路由 handle，async 路由的未捕获异常
// 将转交统一 errorHandler，而不是成为 unhandledRejection 打崩进程
import './utils/async-shim';
import express, { Express } from 'express';
import cors from 'cors';
import { env } from './config/env';
import { errorHandler, notFoundHandler } from './middleware/error';
import { auditMiddleware } from './middleware/audit';
import { authMiddleware } from './middleware/auth';
import authModule from './modules/auth';
import userModule from './modules/user';
import personModule from './modules/person';
import familyModule from './modules/family';
import gridModule from './modules/grid';
import tagModule from './modules/tag';
import keygroupModule from './modules/keygroup';
import statisticsModule from './modules/statistics';
import excelModule from './modules/excel';
import auditModule from './modules/audit';

export function createApp(): Express {
  const app = express();

  app.disable('x-powered-by');
  app.use(cors({ origin: env.corsOrigin === '*' ? true : env.corsOrigin.split(','), credentials: true }));
  app.use(express.json({ limit: '2mb' }));

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
  app.use('/api/audit-logs', auditModule);

  // 未匹配路由与错误处理
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
