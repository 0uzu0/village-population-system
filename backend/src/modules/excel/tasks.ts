import { Router, Request, Response } from 'express';
import ExcelJS from 'exceljs';
import { query, queryOne } from '../../config/db';
import { z } from 'zod';
import { IMPORT_TASK_TYPES } from '../../utils/specialImport';
import { requirePermission } from '../../middleware/rbac';
import { ok, okPage, PageResult } from '../../utils/response';
import { markStaleImportTasks } from '../../services/importTask';

// ===== 以下内容自 modules/excel.ts 机械搬迁，未改动逻辑 =====

const router = Router();

/** 导入任务列表（先收敛卡住的任务，避免列表里长期挂着「处理中」） */
router.get('/import-tasks', requirePermission('excel:import'), async (req: Request, res: Response) => {
  await markStaleImportTasks();
  const q = z
    .object({
      page: z.coerce.number().int().min(1).default(1),
      pageSize: z.coerce.number().int().min(1).max(500).default(20),
      // 不传=全部。枚举来自 utils/specialImport 的 IMPORT_TASK_TYPES，
      // 新增导入类型时那里改一处即可，这里不会再出现 Invalid enum value
      taskType: z.enum(IMPORT_TASK_TYPES).optional(),
    })
    .parse(req.query);
  const whereSql = q.taskType ? 'WHERE eit.task_type = ?' : '';
  const params: any[] = q.taskType ? [q.taskType] : [];
  const totalRow = await queryOne<any>(`SELECT COUNT(*) AS cnt FROM excel_import_task eit ${whereSql}`, params);
  const rows = await query<any>(
    `SELECT eit.*, u.real_name AS operator_name FROM excel_import_task eit LEFT JOIN sys_user u ON u.id = eit.created_by
     ${whereSql} ORDER BY eit.created_at DESC LIMIT ? OFFSET ?`,
    [...params, q.pageSize, (q.page - 1) * q.pageSize]
  );
  const result: PageResult<any> = { list: rows, total: Number(totalRow?.cnt || 0), page: q.page, pageSize: q.pageSize };
  return okPage(res, result);
});

/** 导入错误记录 */
router.get('/import-tasks/:id/errors', requirePermission('excel:import'), async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const rows = await query<any>('SELECT * FROM excel_import_error WHERE task_id = ? ORDER BY row_no', [id]);
  return ok(res, rows);
});

/** 下载错误行 */
router.get(
  '/import-tasks/:id/errors/download',
  requirePermission('excel:import'),
  async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    const errors = await query<any>(
      'SELECT row_no, field_name, message, raw_data FROM excel_import_error WHERE task_id = ? ORDER BY row_no',
      [id]
    );
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('错误行');
    ws.columns = [
      { header: 'Excel行号', key: 'row_no', width: 12 },
      { header: '错误信息', key: 'message', width: 50 },
      { header: '姓名', key: 'raw_data', width: 20 },
    ];
    errors.forEach((e: any) => ws.addRow({ row_no: e.row_no, message: e.message, raw_data: e.raw_data }));
    const buf = await wb.xlsx.writeBuffer();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="import_errors_${id}.xlsx"`);
    res.send(Buffer.from(buf));
  }
);

// ================= 导出 =================

export default router;
