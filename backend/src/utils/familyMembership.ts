import { isActiveStatus, isInactiveStatus } from './personStatus';
import { activeFamilySql } from './familySql';

/**
 * 人员状态 × 家庭成员关联 的**唯一联动实现**。
 *
 * 规则：
 * - 转为非在册（迁出 / 死亡）→ 关联标记离开，leave_date 记**状态生效日期**；
 * - 改回在册 → 关联恢复。
 *
 * 两个都是踩过的坑：
 * 1. leave_date 原先写死 `CURDATE()`。补登三年前去世的老人时，家庭成员的
 *    离户日期会变成「今天」，与人员档案上的死亡日期对不上，户籍核对时没法解释。
 *    现在有生效日期就用生效日期，没有（如批量只给状态）才退回当天。
 * 2. 原先只维护关联，没人去管「这户是不是没人了」。家庭数因此只增不减：
 *    独居老人死亡后，人不在任何人口统计里，那一户却还挂在家庭总数上。
 *    这里在变更后判定一次「该户是否已无在册成员」，供接口回给前端提示。
 *
 * ⚠️ 家庭是否在册**不落库**（见 utils/familySql.ts 的说明）：派生口径下
 * 人员改回在册时家庭自动复活，不需要额外的「恢复家庭」逻辑。
 */

interface RowsLike {
  query: (sql: string, params?: any[]) => Promise<any>;
}

/** mysql2 的 [rows, fields] 与纯 rows 两种返回形状归一 */
function rowsOf(res: any): any[] {
  return Array.isArray(res) && Array.isArray(res[0]) ? res[0] : res;
}

/** 家庭成员在家庭视角下的去向：死亡 / 迁出 / 手工移出 */
export type MemberLeaveReason = 'DEAD' | 'MOVED_OUT' | 'REMOVED';

/**
 * 由人员状态反推「这个人在家庭里算什么」。
 *
 * 特意不再给 family_member 加 leave_reason 列：加了就有两个真值——
 * 人员状态改了而列没改，家庭页就会显示「已迁出」而档案页显示「死亡」。
 * 人员状态是唯一事实，这里只做翻译。
 */
export function memberLeaveReason(personStatus: string | null | undefined): MemberLeaveReason {
  if (personStatus === 'DEAD') return 'DEAD';
  if (personStatus === 'MOVED_OUT') return 'MOVED_OUT';
  return 'REMOVED';
}

/**
 * 维护该人员的家庭成员关联，**不做任何「家庭是否灭户」的判定**。
 * 批量场景下逐个判定会多出 N 次查询，改由 countEmptiedFamilies 一次算完。
 *
 * @param effectiveDate 状态生效日期（YYYY-MM-DD）；为 null 时按当天
 */
export async function markFamilyMemberOnStatusChange(
  db: RowsLike,
  personId: number,
  status: string,
  effectiveDate: string | null
): Promise<void> {
  if (isInactiveStatus(status)) {
    // COALESCE 走 SQL 端而不是 JS：CURDATE() 是数据库本地日期，
    // 与 leave_date 列（DATE）同一时区口径，不受应用进程时区影响。
    await db.query(
      `UPDATE family_member SET status = 0, leave_date = COALESCE(?, CURDATE())
        WHERE person_id = ? AND status = 1`,
      [effectiveDate, personId]
    );
    return;
  }
  await db.query(
    'UPDATE family_member SET status = 1, leave_date = NULL WHERE person_id = ? AND status = 0',
    [personId]
  );
}

/** 该人员当前（按家庭成员关联，而非 person.family_id）所属的家庭 */
export async function findPersonFamilyId(db: RowsLike, personId: number): Promise<number | null> {
  const row = rowsOf(
    await db.query(
      // 优先取仍有效的关联；都没有则取最近一条（改回在册时能找回原家庭）
      `SELECT family_id FROM family_member WHERE person_id = ?
        ORDER BY status DESC, id DESC LIMIT 1`,
      [personId]
    )
  )[0];
  return row?.family_id ? Number(row.family_id) : null;
}

/** 家庭是否已无在册成员（家庭不存在或已停用也返回 true） */
export async function isFamilyEmptied(db: RowsLike, familyId: number): Promise<boolean> {
  const row = rowsOf(
    await db.query(
      `SELECT COUNT(*) AS cnt FROM family f WHERE f.id = ? AND ${activeFamilySql('f')}`,
      [familyId]
    )
  )[0];
  return Number(row?.cnt || 0) === 0;
}

/**
 * 单条状态变更用：维护关联并报出「这一户是不是由此灭户」。
 * 家编号一并返回，是为了让提示语能具体到户（「F0013 已无在册成员」）。
 */
export async function syncFamilyMemberOnStatusChange(
  db: RowsLike,
  personId: number,
  status: string,
  effectiveDate: string | null
): Promise<{ familyId: number | null; familyNo: string | null; familyEmptied: boolean }> {
  await markFamilyMemberOnStatusChange(db, personId, status, effectiveDate);

  const familyId = await findPersonFamilyId(db, personId);
  if (!familyId) return { familyId: null, familyNo: null, familyEmptied: false };

  const row = rowsOf(
    await db.query('SELECT family_no FROM family WHERE id = ?', [familyId])
  )[0];
  const emptied = await isFamilyEmptied(db, familyId);
  return { familyId, familyNo: row?.family_no ?? null, familyEmptied: emptied };
}

/**
 * 批量状态变更用：一次算出这批家庭里有多少户已无在册成员。
 *
 * 放在批量里单独算，是因为「逐人 isFamilyEmptied」在 500 人的批次上会多出
 * 500 次 COUNT；这里一条 IN 查询就够。
 */
export async function countEmptiedFamilies(
  db: RowsLike,
  familyIds: number[]
): Promise<number> {
  const ids = [...new Set(familyIds.filter((n) => Number.isInteger(n) && n > 0))];
  if (!ids.length) return 0;
  const row = rowsOf(
    await db.query(
      `SELECT COUNT(*) AS cnt FROM family f
        WHERE f.id IN (${ids.map(() => '?').join(',')}) AND ${activeFamilySql('f')}`,
      ids
    )
  )[0];
  // 返回的是「仍在册的户数」，灭户数 = 总数 − 在册数
  return ids.length - Number(row?.cnt || 0);
}

/** 取这批人员变更前所属的家庭（批量变更前调用，用于事后统计灭户数） */
export async function findFamiliesOfPersons(
  db: RowsLike,
  personIds: number[]
): Promise<number[]> {
  if (!personIds.length) return [];
  const rows = rowsOf(
    await db.query(
      `SELECT DISTINCT family_id FROM family_member
        WHERE person_id IN (${personIds.map(() => '?').join(',')})`,
      personIds
    )
  );
  // SQL 已经 DISTINCT，这里再去一次是为了让「返回即去重」成为函数契约：
  // 调用方（countEmptiedFamilies）拿 ids.length 当分母，重复项会算错灭户数。
  const ids = rows.map((r: any) => Number(r.family_id)).filter((n: number) => n > 0);
  return [...new Set(ids)];
}

/**
 * 只改「与户主关系」时用：更新在户那一行，不新建、不解除归属。
 * 与 syncPersonFamilyOnEdit 分开，是为了不把「没改家庭」误当成「解除归属」。
 */
export async function updateMemberRelation(
  db: RowsLike,
  personId: number,
  relation: string | null
): Promise<void> {
  const rel = relation || 'OTHER';
  const isHead = rel === 'HEAD' ? 1 : 0;
  await db.query(
    `UPDATE family_member SET relation = ?, is_householder = ?
      WHERE person_id = ? AND status = 1`,
    [rel, isHead, personId]
  );
  if (isHead) {
    // family_member 是另一张表，这里不会撞 MySQL 1093
    await db.query(
      `UPDATE family SET head_person_id = ?
        WHERE id IN (SELECT family_id FROM family_member WHERE person_id = ? AND status = 1)`,
      [personId, personId]
    );
  }
}

/**
 * 编辑人员时同步家庭归属。
 *
 * 原先 PUT /persons/:id 只改 person.family_id，完全不动 family_member：
 * 换户之后旧家庭里他仍在户、新家庭里没有他——家庭人数、家庭是否在册、
 * 家庭列表全跟着错。「家庭有没有人」现在是现算的，这张表就更不能漂。
 *
 * @param familyId 目标家庭；null 表示解除归属
 * @param relation 与户主关系；为 HEAD 时顺带把户主指过来
 * @param personStatus 人员当前状态（已故/迁出的人不能是在户成员）
 */
export async function syncPersonFamilyOnEdit(
  db: RowsLike,
  personId: number,
  familyId: number | null,
  relation: string | null,
  personStatus: string
): Promise<void> {
  // 1) 不属于目标家庭的旧关联一律标记离开（换户 / 解除归属共用这条）
  if (familyId === null) {
    await db.query(
      `UPDATE family_member SET status = 0, leave_date = COALESCE(leave_date, CURDATE())
        WHERE person_id = ? AND status = 1`,
      [personId]
    );
    return;
  }
  await db.query(
    `UPDATE family_member SET status = 0, leave_date = COALESCE(leave_date, CURDATE())
      WHERE person_id = ? AND family_id <> ? AND status = 1`,
    [personId, familyId]
  );

  // 2) 写入/更新目标家庭的关联（uk_fm 保证一人一户一行）
  const rel = relation || 'OTHER';
  const isHead = rel === 'HEAD' ? 1 : 0;
  const memberStatus = isActiveStatus(personStatus) ? 1 : 0;
  await db.query(
    `INSERT INTO family_member (family_id, person_id, relation, is_householder, status)
     VALUES (?,?,?,?,?)
     ON DUPLICATE KEY UPDATE relation = ?, is_householder = ?, status = ?`,
    [familyId, personId, rel, isHead, memberStatus, rel, isHead, memberStatus]
  );
  // 户主只能是在册成员；已故/迁出的人顶着 head_person_id 只会让列表显示「已故户主」
  if (isHead && memberStatus === 1) {
    await db.query('UPDATE family SET head_person_id = ? WHERE id = ?', [personId, familyId]);
  }
}
