import { Router, Request, Response } from 'express';
import { query, queryOne } from '../config/db';
import { authMiddleware } from '../middleware/auth';
import { requirePermission } from '../middleware/rbac';
import { ok } from '../utils/response';
import { markStaleImportTasks } from '../services/importTask';
import { activeSql } from '../utils/personStatus';
import { FOCUS_GROUPS, allFocusTagCodes } from '../utils/focusGroups';

const router = Router();
router.use(authMiddleware);

/**
 * 统计口径说明（V007 起与列表/重点人群/导出保持一致）：
 * - 总人口 = 状态为「正常」或「迁入」的档案数（迁出/死亡不计入，档案保留可追溯）
 * - 各标签人数 = 有效标签关联的在册去重人数，存在交叉，不可相加为总人口
 * - 个人标签（党员/退役/优抚/低保对象/特困/残疾/户籍/常住）：只数在册人员，
 *   已死亡/迁出的档案标签保留，但不计入当前服务名单
 * - 家庭标签（低保家庭）：家庭维度认定，与户主个人状态无关，家庭在册即计数
 * - 低保 = 家庭级「低保家庭」数 + 个人级「低保对象」人数，二者口径不同
 */

/** 工作台统计卡片 */
router.get('/dashboard', requirePermission('dashboard:view'), async (req: Request, res: Response) => {
  const [total, personTagCounts] = await Promise.all([
    queryOne<any>(
      `SELECT
        (SELECT COUNT(*) FROM person p WHERE ${activeSql('p')}) AS total_population,
        (SELECT COUNT(*) FROM family f WHERE f.status = 1) AS family_count,
        (SELECT COUNT(*) FROM grid g WHERE g.status = 1) AS grid_count,
        (SELECT COUNT(*) FROM person p WHERE ${activeSql('p')}          AND EXISTS (SELECT 1 FROM person_tag pt JOIN tag_definition td ON td.id=pt.tag_id
            WHERE pt.person_id=p.id AND pt.status='ACTIVE' AND td.code IN ('HUKOU_POP'))) AS hukou_count,
        (SELECT COUNT(*) FROM person p WHERE ${activeSql('p')}          AND EXISTS (SELECT 1 FROM person_tag pt JOIN tag_definition td ON td.id=pt.tag_id
            WHERE pt.person_id=p.id AND pt.status='ACTIVE' AND td.code IN ('RESIDENT_POP'))) AS resident_count
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
    residentCount: Number(total?.resident_count || 0),
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
  const rows = await query<any>(
    `SELECT pcl.*, p.name, p.person_no, u.real_name AS operator_name
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
