import { Router, Request, Response } from 'express';
import { query, queryOne } from '../config/db';
import { authMiddleware } from '../middleware/auth';
import { requirePermission, buildGridFilter } from '../middleware/rbac';
import { ok } from '../utils/response';

const router = Router();
router.use(authMiddleware);

/**
 * 统计口径说明：
 * - 总人口 = 状态为「正常」或「迁入」的档案数（迁出/注销不计入）
 * - 各标签人数 = 有效个人标签关联的去重人数，存在交叉，不可相加为总人口
 * - 低保 = 家庭级「低保家庭」数 + 个人级「低保对象」人数，二者口径不同
 */

/** 工作台统计卡片 */
router.get('/dashboard', requirePermission('dashboard:view'), async (req: Request, res: Response) => {
  const gridFilter = buildGridFilter(req, 'p.grid_id');
  const scope = gridFilter.where; // 形如 " AND p.grid_id IN (...)"
  const scopeParams = gridFilter.params;

  const total = await queryOne<any>(
    `SELECT
      (SELECT COUNT(*) FROM person p WHERE p.status IN ('NORMAL','MOVED_IN') ${scope}) AS total_population,
      (SELECT COUNT(*) FROM family f WHERE f.status = 1 ${scope.replace(/p\.grid_id/g, 'f.grid_id')}) AS family_count,
      (SELECT COUNT(*) FROM grid g WHERE g.status = 1 ${scope.replace(/p\.grid_id/g, 'g.id')}) AS grid_count,
      (SELECT COUNT(*) FROM person p WHERE p.status IN ('NORMAL','MOVED_IN') ${scope}
        AND EXISTS (SELECT 1 FROM person_tag pt JOIN tag_definition td ON td.id=pt.tag_id
          WHERE pt.person_id=p.id AND pt.status='ACTIVE' AND td.code IN ('HUKOU_POP'))) AS hukou_count,
      (SELECT COUNT(*) FROM person p WHERE p.status IN ('NORMAL','MOVED_IN') ${scope}
        AND EXISTS (SELECT 1 FROM person_tag pt JOIN tag_definition td ON td.id=pt.tag_id
          WHERE pt.person_id=p.id AND pt.status='ACTIVE' AND td.code IN ('RESIDENT_POP'))) AS resident_count
    `,
    scopeParams
  );

  // 各标签人数（交叉计数）
  const tagCounts = await query<any>(
    `SELECT td.code,
       (SELECT COUNT(*) FROM person_tag pt WHERE pt.tag_id = td.id AND pt.status='ACTIVE') AS cnt
     FROM tag_definition td WHERE td.code IN
       ('PARTY_MEMBER','PARTY_PROBATIONARY','VETERAN','PREFERENTIAL_OBJECT','LOW_INCOME_PERSON',
        'EXTREME_POVERTY_PERSON','DISABLED_PERSON','LOW_INCOME_FAMILY')`
  );
  const tagMap = new Map(tagCounts.map((r: any) => [r.code, Number(r.cnt)]));

  return ok(res, {
    totalPopulation: Number(total?.total_population || 0),
    familyCount: Number(total?.family_count || 0),
    gridCount: Number(total?.grid_count || 0),
    hukouCount: Number(total?.hukou_count || 0),
    residentCount: Number(total?.resident_count || 0),
    partyCount: (tagMap.get('PARTY_MEMBER') || 0) + (tagMap.get('PARTY_PROBATIONARY') || 0),
    veteranCount: tagMap.get('VETERAN') || 0,
    preferentialCount: tagMap.get('PREFERENTIAL_OBJECT') || 0,
    lowIncomePersonCount: tagMap.get('LOW_INCOME_PERSON') || 0,
    lowIncomeFamilyCount: tagMap.get('LOW_INCOME_FAMILY') || 0,
    extremePovertyCount: tagMap.get('EXTREME_POVERTY_PERSON') || 0,
    disabledCount: tagMap.get('DISABLED_PERSON') || 0,
  });
});

/** 分布统计：年龄、性别、网格、标签 */
router.get('/distributions', requirePermission('statistics:view'), async (req: Request, res: Response) => {
  const gridFilter = buildGridFilter(req, 'p.grid_id');
  const scope = gridFilter.where;

  const age = await query<any>(
    `SELECT
       CASE
         WHEN TIMESTAMPDIFF(YEAR, birth_date, CURDATE()) < 18 THEN '0-17岁'
         WHEN TIMESTAMPDIFF(YEAR, birth_date, CURDATE()) BETWEEN 18 AND 35 THEN '18-35岁'
         WHEN TIMESTAMPDIFF(YEAR, birth_date, CURDATE()) BETWEEN 36 AND 59 THEN '36-59岁'
         WHEN TIMESTAMPDIFF(YEAR, birth_date, CURDATE()) BETWEEN 60 AND 79 THEN '60-79岁'
         ELSE '80岁及以上'
       END AS band, COUNT(*) AS cnt
     FROM person p WHERE p.status IN ('NORMAL','MOVED_IN') AND birth_date IS NOT NULL ${scope}
     GROUP BY band ORDER BY FIELD(band,'0-17岁','18-35岁','36-59岁','60-79岁','80岁及以上')`
  );

  const gender = await query<any>(
    `SELECT gender, COUNT(*) AS cnt FROM person p WHERE p.status IN ('NORMAL','MOVED_IN') ${scope} GROUP BY gender`
  );

  const grids = await query<any>(
    `SELECT g.id, g.name, COUNT(p.id) AS cnt
     FROM grid g LEFT JOIN person p ON p.grid_id = g.id AND p.status IN ('NORMAL','MOVED_IN')
     WHERE g.status = 1 GROUP BY g.id, g.name ORDER BY g.id`
  );

  const tags = await query<any>(
    `SELECT td.code, td.name, td.color, COUNT(pt.id) AS cnt
     FROM tag_definition td LEFT JOIN person_tag pt ON pt.tag_id = td.id AND pt.status='ACTIVE'
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
  const rows = await query<any>(
    `SELECT eit.id, eit.batch_no, eit.status, eit.total_rows, eit.success_count, eit.fail_count, eit.created_at, u.real_name AS operator_name
     FROM excel_import_task eit LEFT JOIN sys_user u ON u.id = eit.created_by
     ORDER BY eit.created_at DESC LIMIT 5`
  );
  return ok(res, rows);
});

export default router;
