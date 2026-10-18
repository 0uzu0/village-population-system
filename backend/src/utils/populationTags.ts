import { AppError } from './response';
import { FLOATING_POP_CODE, HUKOU_POP_CODE } from '../config/tagCodes';
import { STATUS_LABELS, isActiveStatus } from './personStatus';
import type { DbLike } from './tagExclusive';

/**
 * 人口归属标签（户籍人口 / 流动人口）× 人员状态 的**唯一联动实现**。
 *
 * 为什么需要这套规则：
 * 这两个标签描述的不是「曾经的身份」，而是「**现在**属于本村哪一类人口」——
 * 与户籍人口、流动人口这两个统计口径一一对应。所以一个人迁出或死亡之后，
 * 他既不在户籍人口里、也不在流动人口里，标签却还挂着：详情页会同时显示
 * 「迁出」和「户籍人口」，导出名单时一眼就是错的。
 *
 * 与 utils/tagExclusive.ts 分工：
 * - tagExclusive 管「同一互斥组内只能留一枚」（户籍 vs 流动）；
 * - 本文件管「非在册人员一枚都不该留」，并在改回在册时把原来那枚还回去。
 * 两者都只认 tag_definition 里的编码，不在业务代码里散落字符串。
 *
 * 三条不变式（改任何入口前先读这三条）：
 * 1. 非在册（MOVED_OUT / DEAD）→ 两枚人口标签都不得 ACTIVE；
 * 2. 改回在册 → 恢复**最近一次被状态联动停用**的那一枚，不猜、不默认；
 * 3. 所有停用/恢复都写 tag_change_log，remark 以 STATUS_SYNC_PREFIX 开头，
 *    恢复逻辑靠这个前缀反查，前缀不能改。
 */

export const POPULATION_TAG_CODES = [HUKOU_POP_CODE, FLOATING_POP_CODE] as const;

/** 状态联动留痕的统一前缀 —— 恢复时按它倒查，改动等于丢掉恢复能力 */
export const STATUS_SYNC_PREFIX = '状态联动：';

/** 中文口径 / 简称 → 标签编码（导入模板、台账里的写法都落在这里） */
const POPULATION_TAG_ALIASES = new Map<string, string>([
  ['户籍人口', HUKOU_POP_CODE],
  ['户籍', HUKOU_POP_CODE],
  ['本村户籍', HUKOU_POP_CODE],
  ['本地户籍', HUKOU_POP_CODE],
  [HUKOU_POP_CODE, HUKOU_POP_CODE],
  ['流动人口', FLOATING_POP_CODE],
  ['流动', FLOATING_POP_CODE],
  ['暂住', FLOATING_POP_CODE],
  ['暂住人口', FLOATING_POP_CODE],
  ['外来人口', FLOATING_POP_CODE],
  [FLOATING_POP_CODE, FLOATING_POP_CODE],
]);

export interface PopulationTagDef {
  id: number;
  code: string;
  name: string;
}

/** mysql2 的 [rows, fields] 与纯 rows 两种返回形状归一 */
function rowsOf(res: any): any[] {
  return Array.isArray(res) && Array.isArray(res[0]) ? res[0] : res;
}

function codeListSql(): string {
  return POPULATION_TAG_CODES.map(() => '?').join(',');
}

export function isPopulationTagCode(code: string | null | undefined): boolean {
  return (POPULATION_TAG_CODES as readonly string[]).includes(String(code ?? ''));
}

/**
 * 把导入/台账里的文字解析成人口标签编码。
 * 空值与无法识别的写法都返回 null（由调用方决定是报错还是忽略），
 * 不做「猜一个最像的」——猜错会把流动人口算成户籍人口，而且没人会发现。
 */
export function parsePopulationTagCode(text: unknown): string | null {
  const key = String(text ?? '').replace(/[\s　]/g, '').toUpperCase();
  if (!key) return null;
  return POPULATION_TAG_ALIASES.get(key) ?? null;
}

/** 一次查出两枚人口标签的定义（导入/校验共用，避免逐个查） */
export async function loadPopulationTagDefs(db: DbLike): Promise<PopulationTagDef[]> {
  const rows = rowsOf(
    await db.query(
      `SELECT id, code, name FROM tag_definition WHERE code IN (${codeListSql()})`,
      [...POPULATION_TAG_CODES]
    )
  );
  return (rows || []).map((r: any) => ({
    id: Number(r.id),
    code: String(r.code),
    name: String(r.name),
  }));
}

/** 从一组标签 id 里挑出人口标签（其余标签原样保留） */
export async function pickPopulationTags(db: DbLike, tagIds: number[]): Promise<PopulationTagDef[]> {
  const ids = [...new Set(tagIds.map(Number).filter((n) => Number.isFinite(n) && n > 0))];
  if (!ids.length) return [];
  const rows = rowsOf(
    await db.query(
      `SELECT id, code, name FROM tag_definition
        WHERE id IN (${ids.map(() => '?').join(',')}) AND code IN (${codeListSql()})`,
      [...ids, ...POPULATION_TAG_CODES]
    )
  );
  return (rows || []).map((r: any) => ({
    id: Number(r.id),
    code: String(r.code),
    name: String(r.name),
  }));
}

/** 该人员当前生效的人口标签关联 */
export async function activePopulationTags(
  db: DbLike,
  personId: number
): Promise<{ linkId: number; tagId: number; name: string }[]> {
  const rows = rowsOf(
    await db.query(
      `SELECT pt.id, pt.tag_id, td.name
         FROM person_tag pt
         JOIN tag_definition td ON td.id = pt.tag_id
        WHERE pt.person_id = ? AND pt.status = 'ACTIVE'
          AND td.code IN (${codeListSql()})`,
      [personId, ...POPULATION_TAG_CODES]
    )
  );
  return (rows || []).map((r: any) => ({
    linkId: Number(r.id),
    tagId: Number(r.tag_id),
    name: String(r.name),
  }));
}

/**
 * 写入守卫：非在册人员不得持有人口标签。
 *
 * 用在所有「用户明确点了这枚标签」的入口（建档/编辑标签、单加、批量加）。
 * 这里**抛错而不是静默丢弃**：静默丢弃的后果是用户以为打上了、统计里却不生效，
 * 项目里已经因为这类静默偏差排查过好几次。
 *
 * @param status 调用方已知的人员状态；不传则查一次库
 * @param action 提示语里的动作词（「标注」「添加」）
 */
export async function assertPopulationTagsAllowed(
  db: DbLike,
  personId: number,
  tagIds: number[],
  status?: string | null,
  action = '标注'
): Promise<void> {
  if (!tagIds.length) return;

  let current = status ?? null;
  if (!current) {
    const row = rowsOf(await db.query('SELECT status FROM person WHERE id = ?', [personId]))[0];
    if (!row) return; // 人员不存在交给后续 SQL/路由报错，不在这里抢答
    current = String(row.status);
  }
  if (isActiveStatus(current)) return;

  const hits = await pickPopulationTags(db, tagIds);
  if (!hits.length) return;

  throw new AppError(
    `该人员已是「${STATUS_LABELS[current] || current}」状态，不能${action}「${hits
      .map((h) => h.name)
      .join('、')}」。` +
      '户籍人口 / 流动人口只描述当前归属，人员迁出或死亡后会随状态停用；如需保留，请先改回在册状态。',
    422,
    'POPULATION_TAG_ON_INACTIVE'
  );
}

/** 停用该人员全部生效人口标签并留痕，返回停用条数 */
export async function clearPopulationTags(
  db: DbLike,
  personId: number,
  userId: number | null,
  reason: string
): Promise<number> {
  const rows = rowsOf(
    await db.query(
      `SELECT pt.id, pt.tag_id, td.name
         FROM person_tag pt
         JOIN tag_definition td ON td.id = pt.tag_id
        WHERE pt.person_id = ? AND pt.status = 'ACTIVE'
          AND td.code IN (${codeListSql()})`,
      [personId, ...POPULATION_TAG_CODES]
    )
  );
  if (!rows?.length) return 0;

  const linkIds = rows.map((r: any) => Number(r.id));
  await db.query(
    `UPDATE person_tag SET status = 'INACTIVE', expire_date = CURDATE()
      WHERE id IN (${linkIds.map(() => '?').join(',')})`,
    linkIds
  );
  await db.query(
    `INSERT INTO tag_change_log (object_type, object_id, tag_id, action, operator_id, remark)
     VALUES ${rows.map(() => `('PERSON', ?, ?, 'REMOVE', ?, ?)`).join(', ')}`,
    rows.flatMap((r: any) => [
      Number(personId),
      Number(r.tag_id),
      userId,
      `${STATUS_SYNC_PREFIX}${reason}，停用「${r.name}」`,
    ])
  );
  return linkIds.length;
}

/**
 * 改回在册时恢复「最近一次被状态联动停用的那一枚」。
 *
 * 不从表单/参数里取，是因为停用可能发生在很久以前（迁出两年后迁回），
 * 期间人员档案可能被改过很多次；唯一可靠的记录是 tag_change_log。
 *
 * 判定依据是「这两枚标签最近一次 REMOVE 的留痕」：
 * - 最新那条是状态联动写的 → 恢复它记录的 tag_id；
 * - 最新那条是**手工移除**（remark 没有联动前缀）→ 说明经办人后来主动摘掉了，
 *   此时绝不能把旧标签翻出来，直接不恢复。
 *
 * 另三种情况也不恢复（返回 0）：
 * - 从没被联动停用过（本来就没人品标签）；
 * - 那枚标签已被删除或改了编码；
 * - 当前已有一枚生效的人口标签（例如经办人手工补过）——
 *   再恢复就成了同组两枚，与互斥规则冲突。
 */
export async function restorePopulationTag(
  db: DbLike,
  personId: number,
  userId: number | null
): Promise<number> {
  const last = rowsOf(
    await db.query(
      `SELECT tcl.tag_id, tcl.remark
         FROM tag_change_log tcl
         JOIN tag_definition td ON td.id = tcl.tag_id
        WHERE tcl.object_type = 'PERSON' AND tcl.object_id = ?
          AND tcl.action = 'REMOVE'
          AND td.code IN (${codeListSql()})
        ORDER BY tcl.id DESC LIMIT 1`,
      [personId, ...POPULATION_TAG_CODES]
    )
  )[0];
  if (!last) return 0;
  // 最新一次移除不是状态联动做的 → 用户主动移除，保持移除
  if (!String(last.remark || '').startsWith(STATUS_SYNC_PREFIX)) return 0;

  const tagId = Number(last.tag_id);
  const def = rowsOf(await db.query('SELECT id, code, name FROM tag_definition WHERE id = ?', [tagId]))[0];
  if (!def || !isPopulationTagCode(String(def.code))) return 0;

  const existing = await activePopulationTags(db, personId);
  if (existing.length) return 0;

  // person_tag 没有 (person_id, tag_id) 唯一键，只能取最近一条关联行复用，
  // 否则每次迁回都会多插一行历史。
  const link = rowsOf(
    await db.query(`SELECT id FROM person_tag WHERE person_id = ? AND tag_id = ? ORDER BY id DESC LIMIT 1`, [
      personId,
      tagId,
    ])
  )[0];

  if (link) {
    await db.query(`UPDATE person_tag SET status = 'ACTIVE', expire_date = NULL WHERE id = ?`, [Number(link.id)]);
  } else {
    await db.query(
      `INSERT INTO person_tag (person_id, tag_id, status, basis, created_by)
       VALUES (?, ?, 'ACTIVE', ?, ?)`,
      [personId, tagId, `${STATUS_SYNC_PREFIX}恢复在册`, userId]
    );
  }

  await db.query(
    `INSERT INTO tag_change_log (object_type, object_id, tag_id, action, operator_id, remark)
     VALUES ('PERSON', ?, ?, 'ADD', ?, ?)`,
    [personId, tagId, userId, `${STATUS_SYNC_PREFIX}改回在册，恢复「${def.name}」`]
  );
  return 1;
}

/**
 * 状态变更后的标签联动 —— 单条与批量状态变更共用这一个入口。
 *
 * 批量接口原先逐人复制一段 SQL，导致「单条改了、批量忘了」的问题反复出现；
 * 这里把「改状态」与「改标签」绑成一个动作，调用方只负责传目标状态。
 */
export async function syncPopulationTagsOnStatusChange(
  db: DbLike,
  personId: number,
  toStatus: string,
  userId: number | null
): Promise<{ cleared: number; restored: number }> {
  if (isActiveStatus(toStatus)) {
    return { cleared: 0, restored: await restorePopulationTag(db, personId, userId) };
  }
  const label = STATUS_LABELS[toStatus] || toStatus;
  return {
    cleared: await clearPopulationTags(db, personId, userId, `变更为「${label}」`),
    restored: 0,
  };
}
