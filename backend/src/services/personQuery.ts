import { z } from 'zod';
import { AppError } from '../utils/response';
import { validateIdCard, birthFromIdCard, genderFromIdCard } from '../utils/idcard';
import { formatDate } from '../utils/date';
import { calcAge } from '../utils/age';
import { disabilityLevelLabel } from '../utils/disability';
import { activeSql } from '../utils/personStatus';
import { buildPersonTagFilter, buildAgeFilter } from '../utils/tagQuery';
import { queryEnum } from '../utils/schema';

/**
 * 人员查询的读侧服务：入参校验、SQL 条件拼装、DB 行 → 前端展示结构。
 *
 * 从 modules/person.ts 抽出（v2.2）：这个文件原本 993 行，塞了列表查询、
 * 建档、编辑、状态变更、标签、残疾档案、变更历史七类职责。
 * 读侧逻辑（尤其是排序白名单、标签筛选）与写侧无关，单独成文件后
 * 路由文件只留「取参 → 调服务 → 包响应」。
 */

/**
 * 处理身份证/手机号：校验 + 提取出生日期/性别（明文存储）。
 * 身份证是出生日期与性别的权威来源：提取不到（无证/日期不合法）时才由调用方回退到表单值。
 */
export function prepareIdentity(body: any) {
  const result: Record<string, string | null> = {};
  if (body.idCard) {
    const check = validateIdCard(body.idCard.trim().toUpperCase());
    if (!check.valid) throw new AppError(`身份证号：${check.message}`);
    const normalized = check.normalized!;
    result.id_card = normalized;
    const birth = birthFromIdCard(normalized);
    if (birth) result.birth_date = birth;
    const gender = genderFromIdCard(normalized);
    if (gender) result.gender = gender;
  }
  if (body.phone) {
    result.phone = body.phone;
  }
  if (body.phoneBackup) {
    result.phone_backup = body.phoneBackup;
  }
  return result;
}

/** 将 DB 行转为前端展示结构 */
export function toPersonVO(row: any): any {
  return {
    id: row.id,
    personNo: row.person_no,
    name: row.name,
    formerName: row.former_name,
    gender: row.gender,
    birthDate: formatDate(row.birth_date),
    age: calcAge(row.birth_date),
    idCard: row.id_card,
    phone: row.phone,
    phoneBackup: row.phone_backup,
    hukouAddress: row.hukou_address,
    liveAddress: row.live_address,
    village: row.village,
    gridId: row.grid_id,
    gridName: row.grid_name,
    familyId: row.family_id,
    familyName: row.family_name,
    relation: row.relation,
    status: row.status,
    statusDate: formatDate(row.status_date),
    remark: row.remark,
    // 重点人群服务台账
    bankAccount: row.bank_account,
    subsidyAmount: row.subsidy_amount != null ? Number(row.subsidy_amount) : null,
    familyCondition: row.family_condition,
    healthAssessment: row.health_assessment,
    // 残疾专项档案：只有 person_disability 有记录时才返回对象，
    // 列名与 person_disability 字段同名（无歧义，person 表无同名列）
    disability: row.disability_person_id
      ? {
          type: row.disability_type,
          level: row.disability_level,
          levelLabel: disabilityLevelLabel(row.disability_level),
          card: row.disability_card,
          guardianName: row.guardian_name,
          guardianPhone: row.guardian_phone,
          remark: row.disability_remark,
        }
      : null,
    dataSource: row.data_source,
    updatedAt: row.updated_at,
    /** 乐观锁版本号：前端编辑时带上它，服务端据此判断期间有没有被别人改过 */
    rowVersion: Number(row.row_version ?? 0),
    tags: row.tags || [],
  };
}

export const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
  keyword: z.string().optional(),
  gender: z.string().optional(),
  gridId: z.coerce.number().optional(),
  familyId: z.coerce.number().optional(),
  village: z.string().optional(),
  status: z.string().optional(),
  /**
   * 只看在册（默认开启）：排除死亡/迁出人员，避免日常翻名单时混进历史档案。
   * 显式按 status 筛选时以 status 为准；前端传 activeOnly=false 可查看全部。
   */
  activeOnly: z.enum(['true', 'false']).optional().default('true'),
  minAge: z.coerce.number().optional(),
  maxAge: z.coerce.number().optional(),
  tagIds: z.string().optional(),
  tagMode: queryEnum(['ANY', 'ALL'], 'ANY'),
  sortBy: z.string().optional(),
  sortOrder: queryEnum(['asc', 'desc'], 'asc'),
});

export type PersonListQuery = z.infer<typeof listQuerySchema>;

export interface BuiltPersonListQuery {
  whereSql: string;
  params: any[];
  orderBy: string;
  direction: 'ASC' | 'DESC';
}

/**
 * 把查询参数拼成 WHERE / ORDER BY。
 *
 * 排序**必须**走白名单：sortBy 来自前端查询串，直接拼进 SQL 就是注入点。
 * key 同时接受前端表格的 snake_case 与 camelCase 写法。
 */
export function buildPersonListQuery(q: PersonListQuery): BuiltPersonListQuery {
  const where: string[] = ['1=1'];
  const params: any[] = [];

  if (q.keyword) {
    // 姓名 / 身份证号 / 手机号（含备用）/ 户籍地址 / 实际居住地址 模糊匹配
    where.push(
      '(p.name LIKE ? OR p.id_card LIKE ? OR p.phone LIKE ? OR p.phone_backup LIKE ? OR p.hukou_address LIKE ? OR p.live_address LIKE ?)'
    );
    params.push(`%${q.keyword}%`, `%${q.keyword}%`, `%${q.keyword}%`, `%${q.keyword}%`, `%${q.keyword}%`, `%${q.keyword}%`);
  }
  if (q.gender) {
    where.push('p.gender = ?');
    params.push(q.gender);
  }
  if (q.gridId) {
    where.push('p.grid_id = ?');
    params.push(q.gridId);
  }
  if (q.familyId) {
    where.push('p.family_id = ?');
    params.push(q.familyId);
  }
  if (q.village) {
    where.push('p.village = ?');
    params.push(q.village);
  }
  if (q.status) {
    where.push('p.status = ?');
    params.push(q.status);
  } else if (q.activeOnly !== 'false') {
    where.push(activeSql('p'));
  }

  const ageFilter = buildAgeFilter(q.minAge, q.maxAge, 'p');
  if (ageFilter.where) {
    where.push(ageFilter.where.replace(/^ AND /, ''));
    params.push(...ageFilter.params);
  }

  // 标签筛选：互斥组判定在 buildPersonTagFilter 内部完成，
  // 与工作台统计、标签人数共用同一套规则
  if (q.tagIds) {
    const tagIds = q.tagIds.split(',').map((s) => parseInt(s, 10)).filter((n) => !isNaN(n));
    const tagFilter = buildPersonTagFilter({ tags: tagIds, mode: q.tagMode === 'ALL' ? 'ALL' : 'ANY' }, 'p');
    if (tagFilter.where) {
      where.push(tagFilter.where.replace(/^ AND /, ''));
      params.push(...tagFilter.params);
    }
  }

  const SORTABLE: Record<string, string> = {
    id: 'p.id',
    name: 'p.name',
    person_no: 'p.person_no',
    personNo: 'p.person_no',
    age: 'p.birth_date',
    birth_date: 'p.birth_date',
    birthDate: 'p.birth_date',
    gender: 'p.gender',
    grid_id: 'p.grid_id',
    gridId: 'p.grid_id',
    status: 'p.status',
    updated_at: 'p.updated_at',
    updatedAt: 'p.updated_at',
  };
  const orderBy = q.sortBy && SORTABLE[q.sortBy] ? SORTABLE[q.sortBy] : 'p.id';
  const direction: 'ASC' | 'DESC' = q.sortOrder === 'desc' ? 'DESC' : 'ASC';

  return { whereSql: where.join(' AND '), params, orderBy, direction };
}
