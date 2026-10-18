/**
 * 残疾专项档案（person_disability 与 person 一对一）的写入服务。
 *
 * 从 modules/person.ts 抽出：建档、编辑、待核查确认入库三条路径都要写这张表，
 * 属于领域逻辑而不是某个路由的私有细节。
 */

/** 表单里残疾五字段的输入形状（由 modules/person.ts 的 schema 校验后传入） */
export interface DisabilityInput {
  disabilityType?: string | null;
  disabilityLevel?: string | null;
  disabilityCard?: string | null;
  guardianName?: string | null;
  guardianPhone?: string | null;
  remark?: string | null;
}

/**
 * 残疾专项档案读写（person_disability 与 person 一对一）。
 * 全空视为「不是残疾人」→ 删除记录；否则 upsert（INSERT ... ON DUPLICATE KEY UPDATE）。
 */
export async function saveDisability(
  conn: { query: (sql: string, params?: any[]) => Promise<any> },
  personId: number,
  d: DisabilityInput,
) {
  const values = [
    d.disabilityType || null,
    d.disabilityLevel || null,
    d.disabilityCard || null,
    d.guardianName || null,
    d.guardianPhone || null,
    d.remark || null,
  ];
  const empty = values.every((v) => v === null);
  if (empty) {
    await conn.query('DELETE FROM person_disability WHERE person_id = ?', [personId]);
    return;
  }
  await conn.query(
    `INSERT INTO person_disability
       (person_id, disability_type, disability_level, disability_card, guardian_name, guardian_phone, remark)
     VALUES (?,?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE
       disability_type = VALUES(disability_type),
       disability_level = VALUES(disability_level),
       disability_card  = VALUES(disability_card),
       guardian_name   = VALUES(guardian_name),
       guardian_phone  = VALUES(guardian_phone),
       remark          = VALUES(remark)`,
    [personId, ...values]
  );
}
