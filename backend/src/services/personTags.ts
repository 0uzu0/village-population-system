import {
  loadTagExclusiveInfo,
  pickExclusiveWinners,
  findStrongerGroupPeer,
} from '../utils/tagExclusive';
import { assertPopulationTagsAllowed } from '../utils/populationTags';

/**
 * 人员标签的写入服务。
 *
 * 从 modules/person.ts 抽出来的原因：标签写入不再只是「人员路由的一个片段」——
 * 待核查确认入库（modules/pending.ts）也要回挂建档时选的标签，
 * 两个模块共用同一套互斥裁决与留痕口径。留在路由文件里就变成了
 * 「一个模块 import 另一个模块的内部函数」，边界是错的。
 */

/**
 * 标签互斥（数据驱动，规则与 SQL 片段见 utils/tagExclusive.ts）。
 *
 * 历史上这里写死了户籍 / 流动两个编码，等于「后端认识业务口径」。
 * 现在规则来自 tag_definition.exclusive_group / exclusive_priority，
 * 新增一组互斥只需要一条 UPDATE，本文件不用改。
 *
 * 裁决顺序：
 * 1) 同一批里同组只留优先级最高的一枚（pickExclusiveWinners）；
 * 2) 该人若已在同组持有优先级更高的标签，这批里的低优先级标签**不写入**——
 *    读数侧本来就不认它，写进去只会让用户以为打上了，统计里却不生效；
 * 3) 通过裁决的标签写入后，调用方再用 deactivateGroupPeers 停用同组旧标签。
 */
export async function resolveTagExclusivity(
  db: { query: (sql: string, params?: any[]) => Promise<any> },
  personId: number,
  incomingTagIds: number[],
): Promise<{ writable: number[]; blocked: { tagId: number; name: string }[]; groups: string[] }> {
  const info = await loadTagExclusiveInfo(db, incomingTagIds);
  const winners = pickExclusiveWinners(incomingTagIds, info);
  const writable: number[] = [];
  const blocked: { tagId: number; name: string }[] = [];
  const groups = new Set<string>();

  for (const tagId of winners) {
    const meta = info.get(Number(tagId));
    if (!meta?.group) {
      writable.push(tagId);
      continue;
    }
    const peer = await findStrongerGroupPeer(db, personId, meta);
    if (peer) {
      blocked.push({ tagId, name: peer.name });
      continue;
    }
    writable.push(tagId);
    groups.add(meta.group);
  }
  return { writable, blocked, groups: [...groups] };
}

/**
 * 把人员的标签同步成给定的 tagIds —— **全量覆盖**语义。
 *
 * 传 `[]` 表示清空标签，未传该字段（undefined）才表示「不动标签」，
 * 因此调用方要先判断 `body.tagIds !== undefined` 再调这里。
 *
 * 放进人员主表写入的同一个事务：标签挂不上有可能失败（标签 id 不存在等），
 * 分开写会留下「人建好了但标签没挂上」的残缺档案。
 * update 路由本身不在事务里，此时传入 pool（与 saveDisability 的做法一致）。
 *
 * 每一处增删都写 tag_change_log，与批量打标签保持同样的留痕口径。
 * 待核查确认入库（pending.ts）也用它回挂建档时选择的标签。
 */
export async function syncPersonTags(
  conn: { query: (sql: string, params?: any[]) => Promise<any> },
  personId: number,
  tagIds: number[],
  userId: number,
) {
  /**
   * 非在册人员不得持有人口归属标签（户籍人口 / 流动人口）。
   *
   * 放在这个函数里是因为它是「全量覆盖」的唯一入口——建档、编辑、
   * 待核查确认入库都从这里过。把它放在路由层，新增一个调用方就会漏。
   * 明确报错而不是静默丢弃：用户点了这枚标签却没生效，比报错更难排查。
   * （tagIds 为空时守卫直接返回，不会多查一次库。）
   */
  await assertPopulationTagsAllowed(conn, personId, tagIds);

  const [curRows] = (await conn.query(
    `SELECT tag_id FROM person_tag WHERE person_id = ? AND status = 'ACTIVE'`,
    [personId]
  )) as any[];
  const current = new Set<number>((curRows || []).map((r: any) => Number(r.tag_id)));
  const next = new Set<number>(tagIds);

  // 标签互斥（数据驱动）：全量覆盖下「不在 next 里的一律停用」本身就保证了互斥，
  // 唯一要处理的是新集合在同一互斥组里声明了多枚 —— 只保留优先级最高的一枚
  //（被剔除的那枚从未写入，无需留痕）。
  const exclusiveInfo = await loadTagExclusiveInfo(conn, tagIds);
  const winners = new Set(pickExclusiveWinners(tagIds, exclusiveInfo));
  for (const tagId of tagIds) {
    if (!winners.has(tagId)) next.delete(tagId);
  }

  // 移除：当前有、新列表里没有 → 置为 INACTIVE（保留历史，不物理删除）
  for (const tagId of current) {
    if (next.has(tagId)) continue;
    await conn.query(
      `UPDATE person_tag SET status = 'INACTIVE', expire_date = CURDATE()
       WHERE person_id = ? AND tag_id = ? AND status = 'ACTIVE'`,
      [personId, tagId]
    );
    await conn.query(
      `INSERT INTO tag_change_log (object_type, object_id, tag_id, action, operator_id) VALUES ('PERSON', ?, ?, 'REMOVE', ?)`,
      [personId, tagId, userId]
    );
  }

  // 新增：新列表里有、当前没有生效记录 → 插入 ACTIVE
  for (const tagId of next) {
    if (current.has(tagId)) continue;
    await conn.query(
      `INSERT INTO person_tag (person_id, tag_id, status, created_by)
       SELECT ?, ?, 'ACTIVE', ? FROM DUAL
       WHERE NOT EXISTS (SELECT 1 FROM person_tag WHERE person_id = ? AND tag_id = ? AND status = 'ACTIVE')`,
      [personId, tagId, userId, personId, tagId]
    );
    await conn.query(
      `INSERT INTO tag_change_log (object_type, object_id, tag_id, action, operator_id) VALUES ('PERSON', ?, ?, 'ADD', ?)`,
      [personId, tagId, userId]
    );
  }
}
