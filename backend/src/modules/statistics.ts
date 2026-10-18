import { Router, Request, Response } from 'express';
import { query, queryOne } from '../config/db';
import { authMiddleware } from '../middleware/auth';
import { requirePermission } from '../middleware/rbac';
import { ok } from '../utils/response';
import { markStaleImportTasks } from '../services/importTask';
import { activeSql } from '../utils/personStatus';
import { activeFamilySql } from '../utils/familySql';
import { FOCUS_GROUPS, allFocusTagCodes } from '../utils/focusGroups';
import { buildHukouFloatingCountSql } from '../utils/statisticsSql';

const router = Router();
router.use(authMiddleware);

/**
 * 统计口径说明（V007 起与列表/重点人群/导出保持一致）：
 * - 总人口 = 户籍人口 + 流动人口（2026-10 v2.1.0 口径）。
 *   户籍人口 = 户籍在本村的在册人员；流动人口 = 户籍不在本村、暂住本村的在册人员，
 *   两者**互斥不存在交叉**（打标签侧已做互斥 + V017 修复存量），
 *   floating 统计仍按「户籍优先」排除同时持有户籍标签的人员作为兜底。
 * - 总人口（在册档案数）与各标签人数 = 有效标签关联的在册去重人数，重点人群存在交叉，不可相加为总人口
 * - 个人标签（党员/退役/优抚/低保对象/特困/残疾/户籍/流动）：只数在册人员，
 *   已死亡/迁出的档案标签保留，但不计入当前服务名单
 * - 低保 = 个人级「低保对象」人数（家庭级「低保家庭」标签已随家庭标签功能整体下线）
 */

/** 工作台统计卡片 */
router.get('/dashboard', requirePermission('dashboard:view'), async (req: Request, res: Response) => {
  const [total, personTagCounts] = await Promise.all([
    queryOne<any>(
      `SELECT
        (SELECT COUNT(*) FROM person p WHERE ${activeSql('p')}) AS total_population,
        (SELECT COUNT(*) FROM family f WHERE ${activeFamilySql('f')}) AS family_count,
        (SELECT COUNT(*) FROM grid g WHERE g.status = 1) AS grid_count,
        ${buildHukouFloatingCountSql()}
      `,
    ),
    // 个人类标签：只数在册人员。死亡/迁出的档案保留标签可追溯，但不计入当前服务名单。
    // 编码列表统一取自 utils/focusGroups.ts（原先在各模块里各写一遍 IN 列表）。
    query<any>(
      `SELECT td.code,
         (SELECT COUNT(*) FROM person_tag pt
           WHERE pt.tag_id = td.id AND pt.status='ACTIVE'
             AND EXISTS (SELECT 1 FROM person p
               WHERE p.id = pt.person_id AND ${activeSql('p')})) AS cnt
       FROM tag_definition td WHERE td.code IN (${allFocusTagCodes().map(() => '?').join(',')})`,
      allFocusTagCodes()
    ),
  ]);

  const tagMap = new Map<string, number>();
  for (const r of personTagCounts) tagMap.set(r.code, Number(r.cnt));

  // 重点人群卡片字段由 focusGroups 单一来源推导（党员含正式+预备，与其他统计口径一致）
  const focusCounts: Record<string, number> = {};
  for (const g of FOCUS_GROUPS) {
    if (!g.dashboardField) continue;
    focusCounts[g.dashboardField] = g.tagCodes.reduce((sum, code) => sum + (tagMap.get(code) || 0), 0);
  }

  return ok(res, {
    totalPopulation: Number(total?.total_population || 0),
    familyCount: Number(total?.family_count || 0),
    gridCount: Number(total?.grid_count || 0),
    hukouCount: Number(total?.hukou_count || 0),
    floatingCount: Number(total?.floating_count || 0),
    ...focusCounts,
  });
});

/** 分布统计：年龄、性别、网格、标签 */
router.get('/distributions', requirePermission('statistics:view'), async (req: Request, res: Response) => {
  const age = await query<any>(
    `SELECT
       CASE
         WHEN TIMESTAMPDIFF(YEAR, birth_date, CURDATE()) < 18 THEN '0-17岁'
         WHEN TIMESTAMPDIFF(YEAR, birth_date, CURDATE()) BETWEEN 18 AND 35 THEN '18-35岁'
         WHEN TIMESTAMPDIFF(YEAR, birth_date, CURDATE()) BETWEEN 36 AND 59 THEN '36-59岁'
         WHEN TIMESTAMPDIFF(YEAR, birth_date, CURDATE()) BETWEEN 60 AND 79 THEN '60-79岁'
         ELSE '80岁及以上'
       END AS band, COUNT(*) AS cnt
     FROM person p WHERE ${activeSql('p')} AND birth_date IS NOT NULL     GROUP BY band ORDER BY FIELD(band,'0-17岁','18-35岁','36-59岁','60-79岁','80岁及以上')`
  );

  const gender = await query<any>(
    `SELECT gender, COUNT(*) AS cnt FROM person p WHERE ${activeSql('p')} GROUP BY gender`
  );

  const grids = await query<any>(
    `SELECT g.id, g.name, COUNT(p.id) AS cnt
     FROM grid g LEFT JOIN person p ON p.grid_id = g.id AND ${activeSql('p')}
     WHERE g.status = 1 GROUP BY g.id, g.name ORDER BY g.id`
  );

  const tags = await query<any>(
    // 只统计在册人员：已死亡/迁出的档案仍保留标签，但不应计入当前服务人数
    `SELECT td.code, td.name, td.color, COUNT(pt.id) AS cnt
     FROM tag_definition td
     LEFT JOIN person_tag pt ON pt.tag_id = td.id AND pt.status='ACTIVE'
       AND EXISTS (SELECT 1 FROM person p WHERE p.id = pt.person_id AND ${activeSql('p')})
     WHERE td.object_type='PERSON' GROUP BY td.id ORDER BY cnt DESC LIMIT 15`
  );

  return ok(res, { age, gender, grids, tags });
});

/** 近期人口档案变更摘要 */
router.get('/changes', requirePermission('dashboard:view'), async (req: Request, res: Response) => {
  // 删除是物理删除（v2.1.0 起删除动作本身留一条 DELETE 流水，person_id
  // 保留原值但档案已不存在），LEFT JOIN 取不到姓名时显示「已删除人员」，
  // 姓名/编号完整信息在 reason 里（删除时写入）。
  const rows = await query<any>(
    `SELECT pcl.*, COALESCE(p.name, '已删除人员') AS name,
            COALESCE(p.person_no, '') AS person_no, u.real_name AS operator_name
     FROM person_change_log pcl
     LEFT JOIN person p ON p.id = pcl.person_id
     LEFT JOIN sys_user u ON u.id = pcl.operator_id
     ORDER BY pcl.created_at DESC LIMIT 10`
  );
  return ok(res, rows);
});

/** 最近导入任务状态 */
router.get('/imports', requirePermission('dashboard:view'), async (req: Request, res: Response) => {
  // 先收敛卡在「处理中」的任务，工作台才不会一直转圈
  await markStaleImportTasks();
  const rows = await query<any>(
    `SELECT eit.id, eit.batch_no, eit.status, eit.total_rows, eit.success_count, eit.fail_count,
            eit.pending_count, eit.created_at, u.real_name AS operator_name
     FROM excel_import_task eit LEFT JOIN sys_user u ON u.id = eit.created_by
     ORDER BY eit.created_at DESC LIMIT 5`
  );
  return ok(res, rows);
});

export default router;
