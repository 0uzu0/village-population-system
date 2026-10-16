import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth';
import templateRouter from './template';
import importPersonRouter from './importPerson';
import importKeyGroupRouter from './importKeyGroup';
import importSpecialRouter from './importSpecial';
import taskRouter from './tasks';
import exportRouter from './export';

/**
 * Excel 导入导出模块的路由聚合入口。
 *
 * 原先这里是单个 1485 行的文件，混了模板生成 / 人口导入 / 名单导入 / 专项导入 /
 * 任务状态机 / 导出六类互不相干的职责，任何一处改动都要在近 1500 行里找位置。
 * 现按职责拆到同目录下的多个文件，本文件只负责挂载与统一鉴权。
 */
const router = Router();
router.use(authMiddleware);

router.use(templateRouter);
router.use(importPersonRouter);
router.use(importKeyGroupRouter);
router.use(importSpecialRouter);
router.use(taskRouter);
router.use(exportRouter);

// 供测试与其它模块直接引用的共享能力（保持原 modules/excel 的对外形状）
export * from './shared';
export { markStaleImportTasks, markImportFailed } from '../../services/importTask';

export default router;
