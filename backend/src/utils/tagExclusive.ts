/**
 * 标签互斥组的**唯一实现**。
 *
 * 规则存在数据里：`tag_definition.exclusive_group` 声明一个标签属于哪个互斥组，
 * `exclusive_priority`（越小越优先）声明同组内谁该被保留。
 * 代码只负责「按这两列裁决」，不再认识任何具体标签编码。
 *
 * 为什么要这样：户籍人口 / 流动人口「只能留一个」这条规则，原先在
 * 后端 SQL、PC 建档表单、APP 标签 chip 三处各写一遍，且都硬编码
 * HUKOU_POP / FLOATING_POP。再加一组互斥（例如低保户与特困供养）就要三端
 * 各改一次代码、各发一次版；任何一端漏改，就会出现「前端拦住了后端没拦」
 * 或者「工作台和标签页两个数」。
 *
 * 现状：HUKOU_POP(10) 与 FLOATING_POP(20) 同属 HUKOU_FLOATING 组，
 * 因此仍然保持 v2.1.0 以来的「户籍优先」——户籍是事实属性、流动是暂态。
 *
 * 三种使用位置：
 * - 读数（统计 / 标签人数 / 列表筛选）：用 notSuperseded* 片段，SQL 里直接裁决，
 *   不需要调用方先查标签编码；
 * - 写入（建档 / 编辑 / 单加 / 批量 / 导入）：用 pickExclusiveWinners 与
 *   deactivateGroupPeers 收口，保证新数据本身就不违反互斥。
 */

/** mysql2 风格连接（pool / 事务 conn 均可，query 返回 [rows, fields]） */
export type DbLike = { query: (sql: string, params?: any[]) => Promise<any> };

/** 把 [rows, fields] 与纯 rows 两种返回形状归一 */
function rowsOf(res: any): any[] {
  return Array.isArray(res) && Array.isArray(res[0]) ? res[0] : res;
}

/**
 * 拼进 SQL 的标签编码必须是代码常量而非用户输入。
 * 这些片段是字符串拼接（占位符放不进 JOIN 的定义表），加一道白名单挡住误用。
 */
function codeLiteral(code: string): string {
  if (!/^[A-Z0-9_]+$/.test(code)) throw new Error(`非法的标签编码字面量: ${code}`);
  return `'${code}'`;
}

/**
 * 「此标签未被同组更高优先级的标签压制」的 SQL 条件。
 *
 * @param selfTagIdExpr 当前标签 id 的 SQL 表达式（如 `pt.tag_id`）
 * @param personIdExpr  人员 id 的 SQL 表达式（如 `p.id`）
 *
 * 语义：该人员在「当前标签所属的互斥组」内，若还持有优先级更高的标签，
 * 当前标签就不算数。标签没有互斥组时 `exclusive_group` 为 NULL，
 * `=` 比较不成立 → 条件恒真 → 普通标签不受任何影响。
 */
export function notSupersededByTagIdSql(selfTagIdExpr: string, personIdExpr: string): string {
  return `NOT EXISTS (
      SELECT 1 FROM person_tag pt_g
      JOIN tag_definition td_g ON td_g.id = pt_g.tag_id
      JOIN tag_definition td_self ON td_self.id = ${selfTagIdExpr}
      WHERE pt_g.person_id = ${personIdExpr}
        AND pt_g.status = 'ACTIVE'
        AND td_g.exclusive_group IS NOT NULL
        AND td_g.exclusive_group = td_self.exclusive_group
        AND td_g.exclusive_priority < td_self.exclusive_priority
    )`;
}

/**
 * 按标签编码判定「未被同组压制」——用于工作台这类已知口径的地方
 * （如「流动人口」= 持有 FLOATING_POP 且没有被 HUKOU_POP 压制）。
 */
export function notSupersededByCodeSql(tagCode: string, personIdExpr: string): string {
  return `NOT EXISTS (
      SELECT 1 FROM person_tag pt_g
      JOIN tag_definition td_g ON td_g.id = pt_g.tag_id
      JOIN tag_definition td_self ON td_self.code = ${codeLiteral(tagCode)}
      WHERE pt_g.person_id = ${personIdExpr}
        AND pt_g.status = 'ACTIVE'
        AND td_g.exclusive_group IS NOT NULL
        AND td_g.exclusive_group = td_self.exclusive_group
        AND td_g.exclusive_priority < td_self.exclusive_priority
    )`;
}

/**
 * 标签人数统计的互斥守卫（追加到 tag.ts 的 person_count 子查询）。
 *
 * @param codeExpr     当前标签行的 code 表达式（tag.ts 里是 `td.code`）
 * @param personIdExpr 被统计人员的 id 表达式（`pt.person_id`）
 *
 * 与 notSupersededByCodeSql 同语义，区别是「当前标签」来自同一个查询里的列，
 * 所以不用再写死编码——新增的互斥组自动生效，不必改这里。
 */
export function tagPersonCountExclusiveGuard(codeExpr: string, personIdExpr: string): string {
  return `AND NOT EXISTS (
      SELECT 1 FROM person_tag pt_g
      JOIN tag_definition td_g ON td_g.id = pt_g.tag_id
      JOIN tag_definition td_self ON td_self.code = ${codeExpr}
      WHERE pt_g.person_id = ${personIdExpr}
        AND pt_g.status = 'ACTIVE'
        AND td_g.exclusive_group IS NOT NULL
        AND td_g.exclusive_group = td_self.exclusive_group
        AND td_g.exclusive_priority < td_self.exclusive_priority
    )`;
}

// ---------------------------------------------------------------------------
// 写入侧
// ---------------------------------------------------------------------------

export interface TagExclusiveInfo {
  id: number;
  code: string;
  /** 互斥组；null 表示不参与互斥 */
  group: string | null;
  /** 组内优先级，越小越优先 */
  priority: number;
}

/** 批量读取标签的互斥属性（一次查询，避免每个标签查一遍） */
export async function loadTagExclusiveInfo(db: DbLike, tagIds: number[]): Promise<Map<number, TagExclusiveInfo>> {
  const ids = [...new Set(tagIds.map(Number).filter((n) => Number.isFinite(n) && n > 0))];
  const map = new Map<number, TagExclusiveInfo>();
  if (!ids.length) return map;

  const ph = ids.map(() => '?').join(',');
  const rows = rowsOf(
    await db.query(
      `SELECT id, code, exclusive_group, exclusive_priority FROM tag_definition WHERE id IN (${ph})`,
      ids
    )
  );
  for (const r of rows || []) {
    map.set(Number(r.id), {
      id: Number(r.id),
      code: r.code,
      group: r.exclusive_group ?? null,
      priority: Number(r.exclusive_priority ?? 100),
    });
  }
  return map;
}

/**
 * 一批待写入的标签里，同一个互斥组只保留优先级最高的一枚。
 *
 * - 无互斥组的标签原样保留；
 * - 组内优先级并列时保留**先出现**的那个——调用方传的是前端勾选顺序，
 *   等价于「用户最后改主意时点到的那一侧」；
 * - 不在 info 里的 id（标签已被删除）也原样保留，让后续 SQL 去报错，
 *   不在这里静默吞掉。
 */
export function pickExclusiveWinners(ids: number[], info: Map<number, TagExclusiveInfo>): number[] {
  const winnerIndex = new Map<string, number>();
  const result: number[] = [];
  for (const id of ids) {
    const meta = info.get(Number(id));
    if (!meta || !meta.group) {
      result.push(id);
      continue;
    }
    const at = winnerIndex.get(meta.group);
    if (at === undefined) {
      winnerIndex.set(meta.group, result.length);
      result.push(id);
      continue;
    }
    const current = info.get(Number(result[at]));
    if (current && meta.priority < current.priority) result[at] = id;
  }
  return result;
}

/**
 * 找出该人员在某互斥组内**优先级高于** incoming 的生效标签。
 * 用于单加场景：想加「流动人口」，但他已经是「户籍人口」——按规则加不进去，
 * 应该明确告诉用户，而不是默默写一条永远不生效的关联。
 */
export async function findStrongerGroupPeer(
  db: DbLike,
  personId: number,
  incoming: TagExclusiveInfo
): Promise<{ id: number; name: string; priority: number } | null> {
  if (!incoming.group) return null;
  const rows = rowsOf(
    await db.query(
      `SELECT td.id, td.name, td.exclusive_priority
         FROM person_tag pt
         JOIN tag_definition td ON td.id = pt.tag_id
        WHERE pt.person_id = ? AND pt.status = 'ACTIVE'
          AND td.exclusive_group = ?
          AND td.exclusive_priority < ?
        ORDER BY td.exclusive_priority LIMIT 1`,
      [personId, incoming.group, incoming.priority]
    )
  );
  const row = rows?.[0];
  return row ? { id: Number(row.id), name: row.name, priority: Number(row.exclusive_priority) } : null;
}

/**
 * 停用该人员在指定互斥组内的其它生效标签（保留 keepTagIds），并逐条留痕。
 *
 * 只在「新标签确实写进去了」之后调用：调用方已经用 pickExclusiveWinners /
 * findStrongerGroupPeer 裁决过谁该留，这里只负责执行与留痕。
 *
 * @returns 实际停用的关联条数
 */
export async function deactivateGroupPeers(
  db: DbLike,
  personId: number,
  groups: string[],
  keepTagIds: number[],
  userId: number | null,
  remark: string
): Promise<number> {
  const groupList = [...new Set(groups.filter(Boolean))];
  if (!groupList.length) return 0;

  const gph = groupList.map(() => '?').join(',');
  const keep = [...new Set(keepTagIds.map(Number).filter((n) => Number.isFinite(n) && n > 0))];
  const keepSql = keep.length ? `AND pt.tag_id NOT IN (${keep.map(() => '?').join(',')})` : '';

  const rows = rowsOf(
    await db.query(
      `SELECT pt.id, pt.tag_id, td.name
         FROM person_tag pt
         JOIN tag_definition td ON td.id = pt.tag_id
        WHERE pt.person_id = ? AND pt.status = 'ACTIVE'
          AND td.exclusive_group IN (${gph})
          ${keepSql}`,
      [personId, ...groupList, ...keep]
    )
  );
  if (!rows?.length) return 0;

  const rowIds = rows.map((r: any) => Number(r.id));
  await db.query(
    `UPDATE person_tag SET status = 'INACTIVE', expire_date = CURDATE()
      WHERE id IN (${rowIds.map(() => '?').join(',')})`,
    rowIds
  );
  if (userId != null) {
    await db.query(
      `INSERT INTO tag_change_log (object_type, object_id, tag_id, action, operator_id, remark)
       VALUES ${rows.map(() => `('PERSON', ?, ?, 'REMOVE', ?, ?)`).join(', ')}`,
      rows.flatMap((r: any) => [Number(personId), Number(r.tag_id), userId, remark])
    );
  }
  return rowIds.length;
}

/** 单批修复的人员上限（与 SQL 占位符长度对齐，避免超长语句） */
const REPAIR_CHUNK = 500;

/**
 * 按互斥组规则修复给定人员的「组内多枚生效」问题（幂等，可反复调用）。
 *
 * 用途：
 * - 批量导入（重点人群名单 / 特殊人群）写入标签后统一收口——那两条路径
 *   是按文件内容直接 INSERT，绕过了 person.ts 的互斥裁决；
 * - 需要一次性清理存量时由迁移脚本做同口径的 SQL 处理（V021）。
 *
 * 与旧版（只认户籍/流动两枚标签）的区别：这里读 exclusive_group，
 * 因此新增互斥组后导入收口自动生效，不用再改代码。
 *
 * @returns 被停用的关联条数，便于导入结果里给出「口径修正 N 条」
 */
export async function repairExclusiveGroups(
  db: DbLike,
  personIds: number[],
  userId: number | null,
  remark: string
): Promise<number> {
  const ids = [...new Set(personIds.filter((id) => Number.isFinite(id) && id > 0))];
  if (!ids.length) return 0;

  let repaired = 0;
  for (let i = 0; i < ids.length; i += REPAIR_CHUNK) {
    const chunk = ids.slice(i, i + REPAIR_CHUNK);
    const ph = chunk.map(() => '?').join(',');

    const rows = rowsOf(
      await db.query(
        `SELECT pt.id, pt.person_id, pt.tag_id,
                td.exclusive_group AS grp, td.exclusive_priority AS pri
           FROM person_tag pt
           JOIN tag_definition td ON td.id = pt.tag_id
          WHERE pt.person_id IN (${ph})
            AND pt.status = 'ACTIVE'
            AND td.exclusive_group IS NOT NULL
          ORDER BY pt.person_id, td.exclusive_group, td.exclusive_priority, pt.id`,
        chunk
      )
    );
    if (!rows?.length) continue;

    // 内存里裁决：同一 (person, group) 只保留排序后第一行（优先级最小、并列取最早）
    const losers: any[] = [];
    let lastKey = '';
    for (const r of rows) {
      const key = `${r.person_id}::${r.grp}`;
      if (key === lastKey) losers.push(r);
      else lastKey = key;
    }
    if (!losers.length) continue;

    const rowIds = losers.map((r: any) => Number(r.id));
    await db.query(
      `UPDATE person_tag SET status = 'INACTIVE', expire_date = CURDATE()
        WHERE id IN (${rowIds.map(() => '?').join(',')})`,
      rowIds
    );
    if (userId != null) {
      await db.query(
        `INSERT INTO tag_change_log (object_type, object_id, tag_id, action, operator_id, remark)
         VALUES ${losers.map(() => `('PERSON', ?, ?, 'REMOVE', ?, ?)`).join(', ')}`,
        losers.flatMap((r: any) => [Number(r.person_id), Number(r.tag_id), userId, remark])
      );
    }
    repaired += rowIds.length;
  }
  return repaired;
}
