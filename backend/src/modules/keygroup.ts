import { Router, Request, Response } from 'express';
import { query, queryOne } from '../config/db';
import { authMiddleware } from '../middleware/auth';
import { requirePermission, buildGridFilter } from '../middleware/rbac';
import { ok, okPage, AppError, PageResult } from '../utils/response';
import { buildPersonTagFilter, buildFamilyTagFilter, buildAgeFilter } from '../utils/tagQuery';
import { calcAge, ageRangeText, ELDERLY_MIN_AGE, MINOR_MAX_AGE } from '../utils/age';
import { PERSON_ACTIVE_SQL } from '../utils/personStatus';
import { z } from 'zod';

const router = Router();
router.use(authMiddleware);


/**
 * 重点人群快捷入口定义。
 * - 身份类（党员/退役军人…）按标签编码统计，需先通过名单导入或手工打标签
 * - 年龄类（老年人/未成年人）按年龄自动判定，无需打标签即可统计
 */
const QUICK_GROUPS: { label: string; code: string; minAge?: number; maxAge?: number }[] = [
  { label: '党员', code: 'PARTY_MEMBER' },
  { label: '退役军人', code: 'VETERAN' },
  { label: '优抚对象', code: 'PREFERENTIAL_OBJECT' },
  { label: '低保对象', code: 'LOW_INCOME_PERSON' },
  { label: '特困供养对象', code: 'EXTREME_POVERTY_PERSON' },
  { label: '残疾人', code: 'DISABLED_PERSON' },
  { label: `老年人（≥${ELDERLY_MIN_AGE}岁）`, code: 'ELDERLY', minAge: ELDERLY_MIN_AGE },
  { label: `未成年人（<${MINOR_MAX_AGE + 1}岁）`, code: 'MINOR', maxAge: MINOR_MAX_AGE },
];

/** 快捷入口统计（身份类按标签人数，年龄类按出生日期推算，均存在交叉、不可相加） */
router.get('/quick', requirePermission('keygroup:view'), async (req: Request, res: Response) => {
  // 与 /query 同口径：只统计在册人员，已死亡/迁出的不再计入重点人群服务名单。
  // excluded 单独统计被排除的数量，便于在界面上确认「死亡/迁出后人数是否已剔除」。
  const tagRows = await query<any>(
    `SELECT td.code, td.name, td.color,
       (SELECT COUNT(*) FROM person_tag pt
          JOIN person p2 ON p2.id = pt.person_id
        WHERE pt.tag_id = td.id AND pt.status = 'ACTIVE'
          AND p2.status IN ('NORMAL','MOVED_IN')) AS cnt,
       (SELECT COUNT(*) FROM person_tag pt
          JOIN person p2 ON p2.id = pt.person_id
        WHERE pt.tag_id = td.id AND pt.status = 'ACTIVE'
          AND p2.status NOT IN ('NORMAL','MOVED_IN')) AS excluded
     FROM tag_definition td
     WHERE td.code IN (${QUICK_GROUPS.map(() => '?').join(',')})`,
    QUICK_GROUPS.map((g) => g.code)
  );
  const tagMap = new Map(tagRows.map((r: any) => [r.code, r]));

  const list: any[] = [];
  for (const g of QUICK_GROUPS) {
    const r = tagMap.get(g.code);
    const isAgeGroup = g.minAge != null || g.maxAge != null;
    let count = 0;
    let excluded = 0;
    if (isAgeGroup) {
      // 年龄类：直接按出生日期推算，不依赖是否打过标签
      const af = buildAgeFilter(g.minAge ?? null, g.maxAge ?? null, 'p');
      const [activeRow, excludedRow] = await Promise.all([
        queryOne<any>(
          `SELECT COUNT(*) AS cnt FROM person p WHERE 1=1 ${af.where} AND p.status IN ('NORMAL','MOVED_IN')`,
          af.params
        ),
        queryOne<any>(
          `SELECT COUNT(*) AS cnt FROM person p WHERE 1=1 ${af.where} AND p.status NOT IN ('NORMAL','MOVED_IN')`,
          af.params
        ),
      ]);
      count = Number(activeRow?.cnt || 0);
      excluded = Number(excludedRow?.cnt || 0);
    } else {
      count = r ? Number(r.cnt) : 0;
      excluded = r ? Number(r.excluded) : 0;
    }
    list.push({
      label: g.label,
      code: g.code,
      count,
      // 已被剔除的迁出/死亡档案数，仅用于界面核对口径是否生效
      excluded,
      color: r ? r.color : '#3978F6',
      // 前端据此决定是「按标签筛」还是「按年龄筛」
      byAge: isAgeGroup,
      minAge: g.minAge ?? null,
      maxAge: g.maxAge ?? null,
    });
  }
  return ok(res, {
    list,
    /** 统计口径标识：前端据此显示「仅统计在册」，也便于确认后端版本 */
    scope: 'ACTIVE',
    note: `口径：仅统计在册人员（正常/迁入），已迁出、已死亡的不计入；各人群人数存在交叉，不可简单相加；老年人按 ${ELDERLY_MIN_AGE} 周岁及以上、未成年人按 ${MINOR_MAX_AGE + 1} 周岁以下自动判定，无需打标签`,
  });
});

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
  tagIds: z.string().optional(),
  tagMode: z.enum(['ANY', 'ALL']).or(z.literal('')).default('ANY'),
  familyTagIds: z.string().optional(),
  gridId: z.coerce.number().optional(),
  minAge: z.coerce.number().optional(),
  maxAge: z.coerce.number().optional(),
  keyword: z.string().optional(),
  /**
   * 只看在册（默认开启）。此前该查询完全不过滤状态，已死亡/迁出的人员仍会出现在
   * 低保、残疾、退役军人等名单里。传 activeOnly=false 可查历史档案。
   */
  activeOnly: z.enum(['true', 'false']).optional().default('true'),
});

/**
 * 重点人群查询：支持个人标签交集/并集、家庭级标签、网格、年龄区间
 * 返回：符合条件人数 + 人员列表 + 当前筛选条件（用于界面明确展示）
 */
router.get('/query', requirePermission('keygroup:view'), async (req: Request, res: Response) => {
  const q = querySchema.parse(req.query);

  const where: string[] = ['1=1'];
  const params: any[] = [];

  const conditions: string[] = [];

  // 默认只统计在册人口：死亡/迁出人员已从重点人群服务名单中退出
  if (q.activeOnly !== 'false') {
    where.push(PERSON_ACTIVE_SQL);
    conditions.push('仅统计在册人员');
  } else {
    conditions.push('含已迁出/死亡的历史档案');
  }

  if (q.keyword) { where.push('(p.name LIKE ? OR p.id_card LIKE ? OR p.phone LIKE ? OR p.phone_backup LIKE ?)'); params.push(`%${q.keyword}%`, `%${q.keyword}%`, `%${q.keyword}%`, `%${q.keyword}%`); conditions.push(`姓名/身份证号/手机号含「${q.keyword}」`); }

  const gridFilter = buildGridFilter(req, 'p.grid_id');
  if (gridFilter.where) { where.push(gridFilter.where.replace(/^ AND /, '')); params.push(...gridFilter.params); }
  if (q.gridId) {
    where.push('p.grid_id = ?'); params.push(q.gridId);
    const g = await queryOne<any>('SELECT name FROM grid WHERE id = ?', [q.gridId]);
    conditions.push(`网格：${g?.name || q.gridId}`);
  }

  const ageFilter = buildAgeFilter(q.minAge, q.maxAge, 'p');
  if (ageFilter.where) { where.push(ageFilter.where.replace(/^ AND /, '')); params.push(...ageFilter.params); conditions.push(`年龄 ${ageRangeText(q.minAge, q.maxAge)}`); }

  /** 把标签 ID 翻成名称，避免界面上只显示一串数字 */
  async function tagNames(ids: number[]): Promise<string[]> {
    if (!ids.length) return [];
    const rows = await query<any>(
      `SELECT id, name FROM tag_definition WHERE id IN (${ids.map(() => '?').join(',')})`,
      ids
    );
    const map = new Map(rows.map((r: any) => [r.id, r.name]));
    return ids.map((i) => map.get(i) || `#${i}`);
  }

  const selectedTagIds: number[] = q.tagIds
    ? q.tagIds.split(',').map((s) => parseInt(s, 10)).filter((n) => !isNaN(n))
    : [];
  const selectedFamilyTagIds: number[] = q.familyTagIds
    ? q.familyTagIds.split(',').map((s) => parseInt(s, 10)).filter((n) => !isNaN(n))
    : [];

  if (selectedTagIds.length) {
    const tf = buildPersonTagFilter({ tags: selectedTagIds, mode: q.tagMode === 'ALL' ? 'ALL' : 'ANY' }, 'p');
    if (tf.where) { where.push(tf.where.replace(/^ AND /, '')); params.push(...tf.params); }
    const names = await tagNames(selectedTagIds);
    conditions.push(`个人标签(${q.tagMode === 'ALL' ? '交集' : '并集'}): ${names.join('、')}`);
  }

  if (selectedFamilyTagIds.length) {
    const ft = buildFamilyTagFilter(selectedFamilyTagIds, 'p');
    if (ft.where) { where.push(ft.where.replace(/^ AND /, '')); params.push(...ft.params); }
    const names = await tagNames(selectedFamilyTagIds);
    conditions.push(`家庭标签: ${names.join('、')}`);
  }

  const whereSql = where.join(' AND ');

  const totalRow = await queryOne<any>(`SELECT COUNT(*) AS cnt FROM person p WHERE ${whereSql}`, params);
  const total = Number(totalRow?.cnt || 0);

  const rows = await query<any>(
    `SELECT p.id, p.person_no, p.name, p.gender, p.birth_date, p.id_card, p.phone, p.phone_backup,
            p.grid_id, g.name AS grid_name, p.family_id, f.family_no AS family_name, p.status
     FROM person p LEFT JOIN grid g ON g.id = p.grid_id LEFT JOIN family f ON f.id = p.family_id
     WHERE ${whereSql} ORDER BY p.id LIMIT ? OFFSET ?`,
    [...params, q.pageSize, (q.page - 1) * q.pageSize]
  );

  // 批量取命中标签，避免 N+1；界面上据此高亮「命中的标签」
  const personIds = rows.map((r: any) => r.id);
  const tagMap = new Map<number, any[]>();
  if (personIds.length) {
    const tags = await query<any>(
      `SELECT pt.person_id, td.id, td.name, td.color
       FROM person_tag pt JOIN tag_definition td ON td.id = pt.tag_id
       WHERE pt.person_id IN (${personIds.map(() => '?').join(',')}) AND pt.status = 'ACTIVE'`,
      personIds
    );
    for (const t of tags) {
      if (!tagMap.has(t.person_id)) tagMap.set(t.person_id, []);
      tagMap.get(t.person_id)!.push({ id: t.id, name: t.name, color: t.color });
    }
  }

  const list = rows.map((r: any) => ({
    id: r.id,
    personNo: r.person_no,
    name: r.name,
    gender: r.gender,
    birthDate: r.birth_date ? new Date(r.birth_date).toISOString().slice(0, 10) : null,
    age: calcAge(r.birth_date),
    idCard: r.id_card,
    phone: r.phone,
    phoneBackup: r.phone_backup,
    gridId: r.grid_id,
    gridName: r.grid_name,
    familyName: r.family_name,
    status: r.status,
    tags: tagMap.get(r.id) || [],
  }));

  // 结果集分布统计（整批结果，而非仅当前页）
  const genderRows = await query<any>(
    `SELECT COALESCE(p.gender, 'UNKNOWN') AS k, COUNT(*) AS cnt FROM person p WHERE ${whereSql} GROUP BY p.gender`,
    params
  );
  const gridRows = await query<any>(
    `SELECT COALESCE(g.name, '未分配网格') AS k, COUNT(*) AS cnt
     FROM person p LEFT JOIN grid g ON g.id = p.grid_id
     WHERE ${whereSql} GROUP BY g.name ORDER BY cnt DESC`,
    params
  );

  const result: PageResult<any> = { list, total, page: q.page, pageSize: q.pageSize };
  return ok(res, {
    page: result,
    filter: {
      conditions,
      tagMode: selectedTagIds.length ? q.tagMode : null,
      tagIds: selectedTagIds,
      familyTagIds: selectedFamilyTagIds,
      gridId: q.gridId || null,
      minAge: q.minAge ?? null,
      maxAge: q.maxAge ?? null,
      keyword: q.keyword || null,
      hasFilter: conditions.length > 0,
      summary: conditions.length ? conditions.join('；') : '全部人口',
    },
    stats: {
      gender: genderRows.map((r: any) => ({ key: r.k, count: Number(r.cnt) })),
      grids: gridRows.map((r: any) => ({ key: r.k, count: Number(r.cnt) })),
    },
  });
});

export default router;
