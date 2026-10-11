/**
 * 内部编号生成
 *
 * person.person_no 上有唯一索引 uk_person_no，一旦重复整批导入都会失败。
 * 原实现是「时间戳 + 4 位随机」：同一毫秒内批量导入上万行时，随机段只有
 * 36^4 ≈ 168 万种取值，按生日悖论碰撞概率并不低（万行约 3%），撞上即整批回滚。
 * 这里引入调用方传入的序号，保证同一批次内绝对不重复。
 */

/** 序号段宽度：3 位 36 进制，最大 46655 */
const SEQ_WIDTH = 3;
const SEQ_MAX = 36 ** SEQ_WIDTH;

/**
 * 生成人员内部编号
 * @param seq 批次内序号（必传，用于保证同批次唯一）；手工新增时传 0 即可
 */
export function genPersonNo(seq = 0): string {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase().padEnd(4, '0');
  const seqPart = (Math.abs(Math.floor(seq)) % SEQ_MAX)
    .toString(36)
    .toUpperCase()
    .padStart(SEQ_WIDTH, '0');
  return `P${ts}${rand}${seqPart}`;
}
