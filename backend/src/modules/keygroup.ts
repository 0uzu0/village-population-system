import { Router, Request, Response } from 'express';
import { query, queryOne } from '../config/db';
import { authMiddleware } from '../middleware/auth';
import { requirePermission, buildGridFilter } from '../middleware/rbac';
import { ok, okPage, AppError, PageResult } from '../utils/response';
import { buildPersonTagFilter, buildFamilyTagFilter, buildAgeFilter } from '../utils/tagQuery';
import { z } from 'zod';

const router = Router();
router.use(authMiddleware);

/** 重点人群快捷入口定义（按标签编码） */
const QUICK_GROUPS: { label: string; code: string }[] = [
  { label: '党员', code: 'PARTY_MEMBER' },
  { label: '退役军人', code: 'VETERAN' },
  { label: '优抚对象', code: 'PREFERENTIAL_OBJECT' },
  { label: '低保对象', code: 'LOW_INCOME_PERSON' },
  { label: '特困供养对象', code: 'EXTREME_POVERTY_PERSON' },
  { label: '残疾人', code: 'DISABLED_PERSON' },
  { label: '老年人', code: 'ELDERLY' },
  { label: '未成年人', code: 'MINOR' },
];

/** 快捷入口统计（各标签人数，明确说明存在交叉、不可相加） */
router.get('/quick', requirePermission('keygroup:view'), async (req: Request, res: Response) => {
  const rows = await query<any>(
    `SELECT td.code, td.name, td.color,
       (SELECT COUNT(*) FROM person_tag pt WHERE pt.tag_id = td.id AND pt.status = 'ACTIVE') AS cnt
     FROM tag_definition td
     WHERE td.code IN (${QUICK_GROUPS.map(() => '?').join(',')})`,
    QUICK_GROUPS.map((g) => g.code)
  );
  const map = new Map(rows.map((r: any) => [r.code, r]));
  const list = QUICK_GROUPS.map((g) => {
    const r = map.get(g.code);
    return { label: g.label, code: g.code, count: r ? r.cnt : 0, color: r ? r.color : '#3978F6' };
  });
  return ok(res, { list, note: '各标签人数存在交叉，不可简单相加' });
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

  if (q.keyword) { where.push('(p.name LIKE ? OR p.person_no LIKE ?)'); params.push(`%${q.keyword}%`, `%${q.keyword}%`); conditions.push(`姓名/编号含「${q.keyword}」`); }

  const gridFilter = buildGridFilter(req, 'p.grid_id');
  if (gridFilter.where) { where.push(gridFilter.where.replace(/^ AND /, '')); params.push(...gridFilter.params); }
  if (q.gridId) { where.push('p.grid_id = ?'); params.push(q.gridId); conditions.push(`网格ID=${q.gridId}`); }

  const ageFilter = buildAgeFilter(q.minAge, q.maxAge, 'p');
  if (ageFilter.where) { where.push(ageFilter.where.replace(/^ AND /, '')); params.push(...ageFilter.params); conditions.push(`年龄 ${q.minAge ?? ''}-${q.maxAge ?? ''} 岁`); }

  if (q.tagIds) {
    const tagIds = q.tagIds.split(',').map((s) => parseInt(s, 10)).filter((n) => !isNaN(n));
    const tf = buildPersonTagFilter({ tags: tagIds, mode: q.tagMode === 'ALL' ? 'ALL' : 'ANY' }, 'p');
    if (tf.where) { where.push(tf.where.replace(/^ AND /, '')); params.push(...tf.params); }
    conditions.push(`个人标签(${q.tagMode === 'ALL' ? '交集' : '并集'}): ${tagIds.join(',')}`);
  }

  if (q.familyTagIds) {
    const ftIds = q.familyTagIds.split(',').map((s) => parseInt(s, 10)).filter((n) => !isNaN(n));
    const ft = buildFamilyTagFilter(ftIds, 'p');
    if (ft.where) { where.push(ft.where.replace(/^ AND /, '')); params.push(...ft.params); }
    conditions.push(`家庭标签: ${ftIds.join(',')}`);
  }

  const whereSql = where.join(' AND ');

  const totalRow = await queryOne<any>(`SELECT COUNT(*) AS cnt FROM person p WHERE ${whereSql}`, params);
  const total = Number(totalRow?.cnt || 0);

  const rows = await query<any>(
    `SELECT p.id, p.person_no, p.name, p.gender, p.birth_date, p.id_card, p.phone,
            p.grid_id, g.name AS grid_name, p.family_id, f.family_no AS family_name, p.status
     FROM person p LEFT JOIN grid g ON g.id = p.grid_id LEFT JOIN family f ON f.id = p.family_id
     WHERE ${whereSql} ORDER BY p.id LIMIT ? OFFSET ?`,
    [...params, q.pageSize, (q.page - 1) * q.pageSize]
  );

  const list = rows.map((r: any) => ({
    id: r.id,
    personNo: r.person_no,
    name: r.name,
    gender: r.gender,
    birthDate: r.birth_date ? new Date(r.birth_date).toISOString().slice(0, 10) : null,
    idCard: r.id_card,
    phone: r.phone,
    gridId: r.grid_id,
    gridName: r.grid_name,
    familyName: r.family_name,
    status: r.status,
  }));

  const result: PageResult<any> = { list, total, page: q.page, pageSize: q.pageSize };
  return ok(res, {
    page: result,
    filter: {
      conditions,
      tagMode: q.tagIds ? q.tagMode : null,
      summary: conditions.length ? conditions.join('；') : '全部人口',
    },
  });
});

export default router;
