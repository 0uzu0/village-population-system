import { query, execute } from '../config/db';
import { logger } from '../utils/logger';

// ===== 以下内容自 modules/excel.ts 机械搬迁，未改动逻辑 =====

/**
 * 孤儿任务收敛：进程崩溃 / 重启会让任务状态永远停在 RUNNING，
 * 导致前端一直显示「处理中」。超过阈值仍未结束的一律判定为失败。
 *
 * 调用点较多（启动、工作台、任务列表），这里做最小间隔节流：
 * 任务列表每次刷新都全表扫一遍 RUNNING 任务没有意义，一分钟一次足够。
 */
const STALE_SCAN_INTERVAL_MS = 60_000;
let lastStaleScanAt = 0;

export async function markStaleImportTasks(minutes = 10, force = false): Promise<number> {
  const now = Date.now();
  if (!force && now - lastStaleScanAt < STALE_SCAN_INTERVAL_MS) return 0;
  lastStaleScanAt = now;
  try {
    const stale = await query<any>(
      `SELECT id FROM excel_import_task WHERE status = 'RUNNING' AND created_at < DATE_SUB(NOW(), INTERVAL ? MINUTE)`,
      [minutes]
    );
    if (!stale.length) return 0;
    for (const t of stale) {
      await execute(`UPDATE excel_import_task SET status = 'FAILED', finished_at = NOW() WHERE id = ?`, [t.id]);
      await execute(`INSERT INTO excel_import_error (task_id, row_no, message, raw_data) VALUES (?,?,?,?)`, [
        t.id,
        0,
        `任务异常中断：超过 ${minutes} 分钟仍停留在「处理中」，已自动判定为失败（常见于导入过程报错或后端重启）`,
        '',
      ]);
    }
    logger.warn('import-task-reconciled', { count: stale.length });
    return stale.length;
  } catch (e) {
    logger.error('import-task-reconcile-failed', { message: e instanceof Error ? e.message : String(e) });
    return 0;
  }
}

/** 导入过程异常时把任务标记为失败，避免停留在「处理中」 */
export async function markImportFailed(taskId: number, totalRows: number, err: unknown): Promise<void> {
  const reason = err instanceof Error ? err.message : String(err);
  try {
    await execute(`UPDATE excel_import_task SET status = 'FAILED', fail_count = ?, finished_at = NOW() WHERE id = ?`, [
      totalRows,
      taskId,
    ]);
    await execute(`INSERT INTO excel_import_error (task_id, row_no, message, raw_data) VALUES (?,?,?,?)`, [
      taskId,
      0,
      `导入过程异常中断（整批未生效）：${reason}`,
      '',
    ]);
  } catch (inner) {
    logger.error('import-task-mark-failed', { message: inner instanceof Error ? inner.message : String(inner) });
  }
}
