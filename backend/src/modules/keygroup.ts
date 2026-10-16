import { Router, Request, Response } from 'express';
import { query, queryOne } from '../config/db';
import { authMiddleware } from '../middleware/auth';
import { requirePermission, buildGridFilter } from '../middleware/rbac';
import { ok, PageResult } from '../utils/response';
import { buildPersonTagFilter, buildFamilyTagFilter, buildAgeFilter } from '../utils/tagQuery';
import { calcAge, ageRangeText, ELDERLY_MIN_AGE, MINOR_MAX_AGE } from '../utils/age';
import { formatDate } from '../utils/date';
import { buildDisabilityLevelFilter, disabilityLevelLabel } from '../utils/disability';
import { activeSql } from '../utils/personStatus';
import { FOCUS_GROUPS, focusGroupLabel } from '../utils/focusGroups';
import { z } from 'zod';
import { queryEnum } from '../utils/schema';

const router = Router();
router.use(authMiddleware);


/**
 * 重点人群快捷入口定义。
 * - 身份类（党员/退役军人…）按标签编码统计，需先通过名单导入或手工打标签
 * - 年龄类（老年人/未成年人）按年龄自动判定，无需打标签即可统计
 *
 * 定义统一取自 utils/focusGroups.ts（唯一来源），这里只是投影成接口返回结构。
 * `code` 是对外契约：身份类等于真实 tag_definition.code，前端据此匹配标签做筛选。
 */
const QUICK_GROUPS = FOCUS_GROUPS.map((g) => ({
  label: focusGroupLabel(g),
  code: g.code,
  minAge: g.minAge,
  maxAge: g.maxAge,
}));

/** 快捷入口统计（身份类按标签人数，年龄类按出生日期推算，均存在交叉、不可相加） */
router.get('/quick', requirePermission('keygroup:view'), async (req: Request, res: Response) => {
  // 与 /query 同口径：只统计在册人员，已死亡/迁出的不再计入重点人群服务名单
  const tagRows = await query<any>(
    `SELECT td.code, td.name, td.color,
       (SELECT COUNT(*) FROM person_tag pt
          JOIN person p2 ON p2.id = pt.person_id
        WHERE pt.tag_id = td.id AND pt.status = 'ACTIVE'
          AND ${activeSql('p2')}) AS cnt
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
    if (isAgeGroup) {
      // 年龄类：直接按出生日期推算，不依赖是否打过标签
      const af = buildAgeFilter(g.minAge ?? null, g.maxAge ?? null, 'p');
      const row = await queryOne<any>(
        `SELECT COUNT(*) AS cnt FROM person p WHERE 1=1 ${af.where} AND ${activeSql('p')}`,
        af.params
      );
      count = Number(row?.cnt || 0);
    } else {
      count = r ? Number(r.cnt) : 0;
    }
    list.push({
      label: g.label,
      code: g.code,
      count,
      color: r ? r.color : '#3978F6',
      // 前端据此决定是「按标签筛」还是「按年龄筛」
      byAge: isAgeGroup,
      minAge: g.minAge ?? null,
      maxAge: g.maxAge ?? null,
    });
  }
  return ok(res, {
    list,
    note: `口径：仅统计在册人员（正常/迁入），已迁出、已死亡的不计入；各人群人数存在交叉，不可简单相加；老年人按 ${ELDERLY_MIN_AGE} 周岁及以上、未成年人按 ${MINOR_MAX_AGE + 1} 周岁以下自动判定，无需打标签`,
  });
});

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
  tagIds: z.string().optional(),
  tagMode: queryEnum(['ANY', 'ALL'], 'ANY'),
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
  /**
   * 重点人群个性化筛选（V008）：
   * - 特困供养方式：集中 / 分散（按 tag_definition.code 走标签维度）
   * - 残疾等级区间：LEVEL_1~LEVEL_4（一级最重，支持只传一端）
   * - 发放金额区间（元/月）
   * - 监护人：有监护人 / 无监护人
   */
  extremePovertyMode: z.enum(['CENTRALIZED', 'DISPERSED']).optional(),
  minDisabilityLevel: z.enum(['LEVEL_1', 'LEVEL_2', 'LEVEL_3', 'LEVEL_4']).optional(),
  maxDisabilityLevel: z.enum(['LEVEL_1', 'LEVEL_2', 'LEVEL_3', 'LEVEL_4']).optional(),
  disabilityType: z.string().max(64).optional(),
  minSubsidy: z.coerce.number().min(0).optional(),
  maxSubsidy: z.coerce.number().min(0).optional(),
  guardian: z.enum(['YES', 'NO']).optional(),
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
    where.push(activeSql('p'));
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

  // ---- 特困供养方式：集中 / 分散（标签维度，与既有筛选器口径一致）----
  if (q.extremePovertyMode) {
    const code = q.extremePovertyMode === 'CENTRALIZED' ? 'EXTREME_POVERTY_CENTRALIZED' : 'EXTREME_POVERTY_DISPERSED';
    where.push(
      `EXISTS (SELECT 1 FROM person_tag pt2 JOIN tag_definition td2 ON td2.id = pt2.tag_id
        WHERE pt2.person_id = p.id AND pt2.status = 'ACTIVE' AND td2.code = ?)`
    );
    params.push(code);
    conditions.push(`特困供养方式：${q.extremePovertyMode === 'CENTRALIZED' ? '集中供养' : '分散供养'}`);
  }

  // ---- 残疾等级 / 类别 / 监护人 ----
  // JOIN 已无条件存在（见下方 fromSql），这里只按需拼接筛选条件。
  if (q.minDisabilityLevel || q.maxDisabilityLevel || q.disabilityType || q.guardian) {
    // 筛残疾条件即要求存在残疾档案，否则非残疾人会被算进来
    where.push('pd.person_id IS NOT NULL');

    const lvl = buildDisabilityLevelFilter(q.minDisabilityLevel, q.maxDisabilityLevel);
    if (lvl.where) {
      where.push(lvl.where);
      params.push(...lvl.params);
      const label = (v?: string) => disabilityLevelLabel(v).replace(/（.*）/, '');
      if (q.minDisabilityLevel && q.maxDisabilityLevel) conditions.push(`残疾等级 ${label(q.minDisabilityLevel)}~${label(q.maxDisabilityLevel)}`);
      else if (q.minDisabilityLevel) conditions.push(`残疾等级 不轻于${label(q.minDisabilityLevel)}`);
      else if (q.maxDisabilityLevel) conditions.push(`残疾等级 不重于${label(q.maxDisabilityLevel)}`);
    }
    if (q.disabilityType) {
      where.push('pd.disability_type = ?');
      params.push(q.disabilityType);
      conditions.push(`残疾类别：${q.disabilityType}`);
    }
    if (q.guardian) {
      if (q.guardian === 'YES') {
        where.push("pd.guardian_name IS NOT NULL AND pd.guardian_name <> ''");
        conditions.push('已登记监护人');
      } else {
        where.push("(pd.guardian_name IS NULL OR pd.guardian_name = '')");
        conditions.push('未登记监护人');
      }
    }
  }

  // ---- 发放金额区间（元/月）----
  if (q.minSubsidy != null || q.maxSubsidy != null) {
    const lo = q.minSubsidy;
    const hi = q.maxSubsidy;
    if (lo != null) { where.push('p.subsidy_amount >= ?'); params.push(lo); }
    if (hi != null) { where.push('p.subsidy_amount <= ?'); params.push(hi); }
    const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));
    conditions.push(
      lo != null && hi != null ? `发放金额 ${fmt(lo)}~${fmt(hi)} 元/月`
        : lo != null ? `发放金额 ≥ ${fmt(lo)} 元/月`
        : `发放金额 ≤ ${fmt(hi as number)} 元/月`
    );
  }

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
  // 列表表格始终展示「残疾等级」「监护人」两列，因此必须无条件 LEFT JOIN 并 SELECT
  // 残疾档案列——否则不筛残疾条件时这两列会永远空白（与 person 详情接口缺列同源的事故）。
  // person_disability 与 person 一对一（uk_pd_person），LEFT JOIN 不会放大行数。
  const fromSql = 'FROM person p LEFT JOIN person_disability pd ON pd.person_id = p.id';
  const disabilityCols = `, pd.person_id AS disability_person_id, pd.disability_type, pd.disability_level,
            pd.disability_card, pd.guardian_name, pd.guardian_phone`;

  const totalRow = await queryOne<any>(`SELECT COUNT(*) AS cnt ${fromSql} WHERE ${whereSql}`, params);
  const total = Number(totalRow?.cnt || 0);

  const rows = await query<any>(
    `SELECT p.id, p.person_no, p.name, p.gender, p.birth_date, p.id_card, p.phone, p.phone_backup,
            p.grid_id, g.name AS grid_name, p.family_id, f.family_no AS family_name, p.status,
            p.bank_account, p.subsidy_amount, p.family_condition, p.health_assessment
            ${disabilityCols}
     ${fromSql}
     LEFT JOIN grid g ON g.id = p.grid_id LEFT JOIN family f ON f.id = p.family_id
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
    birthDate: formatDate(r.birth_date),
    age: calcAge(r.birth_date),
    idCard: r.id_card,
    phone: r.phone,
    phoneBackup: r.phone_backup,
    gridId: r.grid_id,
    gridName: r.grid_name,
    familyName: r.family_name,
    status: r.status,
    tags: tagMap.get(r.id) || [],
    // 个性化台账字段（重点人群服务所需）
    bankAccount: r.bank_account,
    subsidyAmount: r.subsidy_amount != null ? Number(r.subsidy_amount) : null,
    familyCondition: r.family_condition,
    healthAssessment: r.health_assessment,
    disability: r.disability_person_id ? {
      type: r.disability_type,
      level: r.disability_level,
      levelLabel: disabilityLevelLabel(r.disability_level),
      card: r.disability_card,
      guardianName: r.guardian_name,
      guardianPhone: r.guardian_phone,
    } : null,
  }));

  // 结果集分布统计（整批结果，而非仅当前页）
  const genderRows = await query<any>(
    `SELECT COALESCE(p.gender, 'UNKNOWN') AS k, COUNT(*) AS cnt ${fromSql} WHERE ${whereSql} GROUP BY p.gender`,
    params
  );
  const gridRows = await query<any>(
    `SELECT COALESCE(g.name, '未分配网格') AS k, COUNT(*) AS cnt
     ${fromSql} LEFT JOIN grid g ON g.id = p.grid_id
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
      extremePovertyMode: q.extremePovertyMode || null,
      minDisabilityLevel: q.minDisabilityLevel || null,
      maxDisabilityLevel: q.maxDisabilityLevel || null,
      disabilityType: q.disabilityType || null,
      minSubsidy: q.minSubsidy ?? null,
      maxSubsidy: q.maxSubsidy ?? null,
      guardian: q.guardian || null,
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
