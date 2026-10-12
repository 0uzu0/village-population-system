import { Router, Request, Response } from 'express';
import { query, queryOne } from '../config/db';
import { authMiddleware } from '../middleware/auth';
import { requirePermission, buildGridFilter } from '../middleware/rbac';
import { ok } from '../utils/response';
import { markStaleImportTasks } from './excel';
import { PERSON_ACTIVE_SQL } from '../utils/personStatus';

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
  const gridFilter = buildGridFilter(req, 'p.grid_id');
  const scope = gridFilter.where; // 形如 " AND p.grid_id IN (...)"
  const scopeParams = gridFilter.params;
  // 家庭/网格维度复用同一数据范围，仅换别名
  const familyScope = scope.replace(/p\.grid_id/g, 'f.grid_id');
  const gridScope = scope.replace(/p\.grid_id/g, 'g.id');

  const [total, personTagCounts, familyTagCounts] = await Promise.all([
    queryOne<any>(
      `SELECT
        (SELECT COUNT(*) FROM person p WHERE ${PERSON_ACTIVE_SQL} ${scope}) AS total_population,
        (SELECT COUNT(*) FROM family f WHERE f.status = 1 ${familyScope}) AS family_count,
        (SELECT COUNT(*) FROM grid g WHERE g.status = 1 ${gridScope}) AS grid_count,
        (SELECT COUNT(*) FROM person p WHERE ${PERSON_ACTIVE_SQL} ${scope}
          AND EXISTS (SELECT 1 FROM person_tag pt JOIN tag_definition td ON td.id=pt.tag_id
            WHERE pt.person_id=p.id AND pt.status='ACTIVE' AND td.code IN ('HUKOU_POP'))) AS hukou_count,
        (SELECT COUNT(*) FROM person p WHERE ${PERSON_ACTIVE_SQL} ${scope}
          AND EXISTS (SELECT 1 FROM person_tag pt JOIN tag_definition td ON td.id=pt.tag_id
            WHERE pt.person_id=p.id AND pt.status='ACTIVE' AND td.code IN ('RESIDENT_POP'))) AS resident_count
      `,
      scopeParams
    ),
    // 个人类标签：只数在册人员。死亡/迁出的档案保留标签可追溯，但不计入当前服务名单
    query<any>(
      `SELECT td.code,
         (SELECT COUNT(*) FROM person_tag pt
           WHERE pt.tag_id = td.id AND pt.status='ACTIVE'
             AND EXISTS (SELECT 1 FROM person p
               WHERE p.id = pt.person_id AND ${PERSON_ACTIVE_SQL} ${scope})) AS cnt
       FROM tag_definition td WHERE td.code IN
         ('PARTY_MEMBER','PARTY_PROBATIONARY','VETERAN','PREFERENTIAL_OBJECT','LOW_INCOME_PERSON',
          'EXTREME_POVERTY_PERSON','DISABLED_PERSON')`,
      scopeParams
    ),
    // 家庭类标签：认定对象是家庭，走 family_tag；家庭无死亡概念，户主去世家庭仍在册
    query<any>(
      `SELECT td.code,
         (SELECT COUNT(*) FROM family_tag ft JOIN family f ON f.id = ft.family_id
           WHERE ft.tag_id = td.id AND ft.status='ACTIVE' AND f.status = 1 ${familyScope}) AS cnt
       FROM tag_definition td WHERE td.code = 'LOW_INCOME_FAMILY'`,
      scopeParams
    ),
  ]);

  const tagMap = new Map<string, number>();
  for (const r of [...personTagCounts, ...familyTagCounts]) tagMap.set(r.code, Number(r.cnt));

  return ok(res, {
    // 口径标识：前端据此显示统计口径说明。旧版后端不返回该字段，
    // 页面上没有口径说明即代表后端未更新（数字仍是含迁出/死亡的全量口径）。
    scope: 'ACTIVE_ONLY',
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
     FROM person p WHERE ${PERSON_ACTIVE_SQL} AND birth_date IS NOT NULL ${scope}
     GROUP BY band ORDER BY FIELD(band,'0-17岁','18-35岁','36-59岁','60-79岁','80岁及以上')`
  );

  const gender = await query<any>(
    `SELECT gender, COUNT(*) AS cnt FROM person p WHERE ${PERSON_ACTIVE_SQL} ${scope} GROUP BY gender`
  );

  const grids = await query<any>(
    `SELECT g.id, g.name, COUNT(p.id) AS cnt
     FROM grid g LEFT JOIN person p ON p.grid_id = g.id AND ${PERSON_ACTIVE_SQL}
     WHERE g.status = 1 GROUP BY g.id, g.name ORDER BY g.id`
  );

  const tags = await query<any>(
    // 只统计在册人员：已死亡/迁出的档案仍保留标签，但不应计入当前服务人数
    `SELECT td.code, td.name, td.color, COUNT(pt.id) AS cnt
     FROM tag_definition td
     LEFT JOIN person_tag pt ON pt.tag_id = td.id AND pt.status='ACTIVE'
       AND EXISTS (SELECT 1 FROM person p WHERE p.id = pt.person_id AND ${PERSON_ACTIVE_SQL})
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
