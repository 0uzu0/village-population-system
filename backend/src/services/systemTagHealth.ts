import { query } from '../config/db';
import { logger } from '../utils/logger';
import { SYSTEM_TAG_CODES } from '../utils/systemTags';

/**
 * 系统标签自检。
 *
 * 为什么需要：工作台与重点人群的卡片是**按标签编码取数**的。一旦对应的
 * `tag_definition` 行被删掉、被停用，或者被换成自定义编码，接口不会报错，
 * 只是一直返回 0——界面上看起来像「村里没有这类人」，比报错更难发现。
 * （2026-10-18 线上「流动人口恒为 0」就是这一类。）
 *
 * 所以在启动时主动查一次，把问题写进容器日志。**只读、只告警，不改数据**：
 * 自动改数据风险太大，这里只负责让问题可见。
 */
export interface SystemTagHealth {
  /** 编码在数据库里根本不存在（被物理删除，或从未初始化） */
  missing: string[];
  /** 存在但被停用（enabled = 0） */
  disabled: string[];
}

export async function checkSystemTags(): Promise<SystemTagHealth> {
  const placeholders = SYSTEM_TAG_CODES.map(() => '?').join(',');
  const rows = await query<any>(
    `SELECT code, enabled FROM tag_definition WHERE code IN (${placeholders})`,
    [...SYSTEM_TAG_CODES]
  );
  const found = new Map<string, number>();
  for (const r of rows) found.set(String(r.code), Number(r.enabled));

  const missing = SYSTEM_TAG_CODES.filter((c) => !found.has(c));
  const disabled = SYSTEM_TAG_CODES.filter((c) => found.get(c) === 0);

  if (missing.length) {
    logger.warn('system-tag-missing', {
      missing,
      hint: '这些编码对应的标签在 tag_definition 里不存在，工作台/重点人群的对应卡片会恒为 0',
    });
  }
  if (disabled.length) {
    logger.warn('system-tag-disabled', {
      disabled,
      hint: '标签存在但已停用：已有的标签关联仍会统计，但界面上无法再给人员打这个标签',
    });
  }
  return { missing, disabled };
}
