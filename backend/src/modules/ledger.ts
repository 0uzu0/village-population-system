import { Router, Request, Response } from 'express';
import fs from 'fs';
import { query, queryOne, execute, withTransaction, pool } from '../config/db';
import { authMiddleware } from '../middleware/auth';
import { requirePermission } from '../middleware/rbac';
import { ok, okPage, fail, AppError, PageResult } from '../utils/response';
import { writeAudit } from '../middleware/audit';
import { z } from 'zod';
import {
  LEDGER_CATEGORIES,
  categoryName,
  workTypeName,
  isValidCategory,
  isValidWorkType,
  isWorkTypeUnderCategory,
} from '../utils/ledger';

const router = Router();
router.use(authMiddleware);

/** 附件归属类型常量 */
const BIZ_LEDGER = 'LEDGER';

// ---------------------------------------------------------------------------
// 配置暴露给前端（下拉与图例）
// ---------------------------------------------------------------------------
router.get('/meta', requirePermission('ledger:view'), async (_req: Request, res: Response) => {
  return ok(res, LEDGER_CATEGORIES);
});

// ---------------------------------------------------------------------------
// 列表（带筛选 + 分页 + 附件数）
// ---------------------------------------------------------------------------
const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(20),
  category: z.string().nullable().optional(),
  workType: z.string().nullable().optional(),
  keyword: z.string().nullable().optional(),
  start: z.string().nullable().optional(),
  end: z.string().nullable().optional(),
});

function buildListFilter(q: any): { where: string; params: any[] } {
  const where: string[] = ['1=1'];
  const params: any[] = [];
  if (q.category) { where.push('l.category = ?'); params.push(q.category); }
  if (q.workType) { where.push('l.work_type = ?'); params.push(q.workType); }
  if (q.keyword) {
    where.push('(l.title LIKE ? OR l.location LIKE ? OR l.responsible LIKE ? OR l.invoice_no LIKE ?)');
    const kw = `%${q.keyword}%`;
    params.push(kw, kw, kw, kw);
  }
  if (q.start) { where.push('l.record_date >= ?'); params.push(q.start); }
  if (q.end) { where.push('l.record_date <= ?'); params.push(q.end); }
  return { where: where.join(' AND '), params };
}

router.get('/records', requirePermission('ledger:view'), async (req: Request, res: Response) => {
  const q = listSchema.parse(req.query);
  const { where, params } = buildListFilter(q);

  const totalRow = await queryOne<any>(`SELECT COUNT(*) AS cnt FROM ledger_record l WHERE ${where}`, params);
  const total = Number(totalRow?.cnt || 0);

  const rows = await query<any>(
    `SELECT l.*,
            (SELECT COUNT(*) FROM file_info f WHERE f.biz_type = '${BIZ_LEDGER}' AND f.biz_id = l.id) AS attachment_count
     FROM ledger_record l
     WHERE ${where}
     ORDER BY l.record_date DESC, l.id DESC
     LIMIT ? OFFSET ?`,
    [...params, q.pageSize, (q.page - 1) * q.pageSize]
  );

  const list = rows.map((r: any) => ({
    id: r.id,
    category: r.category,
    categoryName: categoryName(r.category),
    workType: r.work_type,
    workTypeName: workTypeName(r.work_type),
    recordDate: r.record_date,
    location: r.location,
    title: r.title,
    detail: r.detail,
    laborCost: Number(r.labor_cost),
    invoiceCost: Number(r.invoice_cost),
    totalCost: Number(r.labor_cost) + Number(r.invoice_cost),
    invoiceNo: r.invoice_no,
    responsible: r.responsible,
    remark: r.remark,
    attachmentCount: Number(r.attachment_count || 0),
    createdBy: r.created_by,
    createdAt: r.created_at,
  }));

  const result: PageResult<any> = { list, total, page: q.page, pageSize: q.pageSize };
  return okPage(res, result);
});

// ---------------------------------------------------------------------------
// 详情（含附件列表）
// ---------------------------------------------------------------------------
router.get('/records/:id', requirePermission('ledger:view'), async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const r = await queryOne<any>('SELECT l.* FROM ledger_record l WHERE l.id = ?', [id]);
  if (!r) throw new AppError('台账记录不存在', 404, 'NOT_FOUND');

  const attachments = await query<any>(
    `SELECT id, file_name, file_type, file_size, content_type, created_at
     FROM file_info WHERE biz_type = ? AND biz_id = ? ORDER BY id`,
    [BIZ_LEDGER, id]
  );

  return ok(res, {
    id: r.id,
    category: r.category,
    categoryName: categoryName(r.category),
    workType: r.work_type,
    workTypeName: workTypeName(r.work_type),
    recordDate: r.record_date,
    location: r.location,
    title: r.title,
    detail: r.detail,
    laborCost: Number(r.labor_cost),
    invoiceCost: Number(r.invoice_cost),
    totalCost: Number(r.labor_cost) + Number(r.invoice_cost),
    invoiceNo: r.invoice_no,
    responsible: r.responsible,
    remark: r.remark,
    createdBy: r.created_by,
    createdAt: r.created_at,
    attachments: attachments.map((a: any) => ({
      id: a.id,
      fileName: a.file_name,
      fileType: a.file_type,
      size: Number(a.file_size),
      contentType: a.content_type,
      createdAt: a.created_at,
    })),
  });
});

// ---------------------------------------------------------------------------
// 创建 / 更新：校验 + 附件关联
// ---------------------------------------------------------------------------
export const recordSchema = z.object({
  category: z.string().min(1).max(32),
  workType: z.string().min(1).max(32),
  recordDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式应为 YYYY-MM-DD'),
  location: z.string().max(255).nullable().optional(),
  title: z.string().min(1).max(255),
  detail: z.string().max(2000).nullable().optional(),
  laborCost: z.coerce.number().min(0).default(0),
  invoiceCost: z.coerce.number().min(0).default(0),
  invoiceNo: z.string().max(64).nullable().optional(),
  responsible: z.string().max(64).nullable().optional(),
  remark: z.string().max(500).nullable().optional(),
  attachmentIds: z.array(z.coerce.number().int().positive()).default([]),
});

/** 在事务内把附件打上台账归属（仅认领当前用户上传且未挂接他处的文件） */
async function linkAttachments(conn: any, ids: number[], recordId: number, userId: number) {
  for (const id of ids) {
    await conn.execute(
      `UPDATE file_info SET biz_type = ?, biz_id = ? WHERE id = ? AND created_by = ? AND (biz_type IS NULL OR biz_id = ?)`,
      [BIZ_LEDGER, recordId, id, userId, recordId]
    );
  }
}

router.post('/records', requirePermission('ledger:manage'), async (req: Request, res: Response) => {
  const body = recordSchema.parse(req.body);
  if (!isValidCategory(body.category)) throw new AppError('无效的条口编码', 400, 'INVALID_CATEGORY');
  if (!isValidWorkType(body.workType)) throw new AppError('无效的工作类型编码', 400, 'INVALID_WORK_TYPE');
  if (!isWorkTypeUnderCategory(body.category, body.workType)) {
    throw new AppError('工作类型不属于该条口', 400, 'WORKTYPE_MISMATCH');
  }

  const id = await withTransaction(async (conn) => {
    const result = await conn.execute(
      `INSERT INTO ledger_record
        (category, work_type, record_date, location, title, detail,
         labor_cost, invoice_cost, invoice_no, responsible, remark, created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        body.category, body.workType, body.recordDate, body.location || null,
        body.title, body.detail || null, body.laborCost, body.invoiceCost,
        body.invoiceNo || null, body.responsible || null, body.remark || null, req.user!.id,
      ]
    );
    const recordId = (result as any).insertId;
    await linkAttachments(conn, body.attachmentIds, recordId, req.user!.id);
    return recordId;
  });

  await writeAudit({ userId: req.user!.id, username: req.user!.username, action: 'ledger:create', request: { id, title: body.title }, result: 'SUCCESS', ip: req.ip });
  return ok(res, { id }, '台账记录已创建');
});

router.put('/records/:id', requirePermission('ledger:manage'), async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const body = recordSchema.parse(req.body);
  if (!isValidCategory(body.category)) throw new AppError('无效的条口编码', 400, 'INVALID_CATEGORY');
  if (!isValidWorkType(body.workType)) throw new AppError('无效的工作类型编码', 400, 'INVALID_WORK_TYPE');
  if (!isWorkTypeUnderCategory(body.category, body.workType)) {
    throw new AppError('工作类型不属于该条口', 400, 'WORKTYPE_MISMATCH');
  }

  const existing = await queryOne<any>('SELECT id FROM ledger_record WHERE id = ?', [id]);
  if (!existing) throw new AppError('台账记录不存在', 404, 'NOT_FOUND');

  await withTransaction(async (conn) => {
    await conn.execute(
      `UPDATE ledger_record SET
         category=?, work_type=?, record_date=?, location=?, title=?, detail=?,
         labor_cost=?, invoice_cost=?, invoice_no=?, responsible=?, remark=?
       WHERE id=?`,
      [
        body.category, body.workType, body.recordDate, body.location || null,
        body.title, body.detail || null, body.laborCost, body.invoiceCost,
        body.invoiceNo || null, body.responsible || null, body.remark || null, id,
      ]
    );
    // 取消关联：已被移除的附件解绑（保留文件，避免误删）
    const cur = await conn.query('SELECT id FROM file_info WHERE biz_type = ? AND biz_id = ?', [BIZ_LEDGER, id]);
    const curIds: number[] = (cur[0] as any[]).map((r: any) => r.id);
    const toDetach = curIds.filter((x) => !body.attachmentIds.includes(x));
    for (const x of toDetach) {
      await conn.execute('UPDATE file_info SET biz_type = NULL, biz_id = NULL WHERE id = ? AND biz_type = ? AND biz_id = ?', [x, BIZ_LEDGER, id]);
    }
    // 关联当前勾选的附件
    await linkAttachments(conn, body.attachmentIds, id, req.user!.id);
  });

  await writeAudit({ userId: req.user!.id, username: req.user!.username, action: 'ledger:edit', request: { id, title: body.title }, result: 'SUCCESS', ip: req.ip });
  return ok(res, { id }, '台账记录已更新');
});

// ---------------------------------------------------------------------------
// 删除（连带解绑并删除物理附件，best-effort）
// ---------------------------------------------------------------------------
router.delete('/records/:id', requirePermission('ledger:manage'), async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const existing = await queryOne<any>('SELECT id FROM ledger_record WHERE id = ?', [id]);
  if (!existing) throw new AppError('台账记录不存在', 404, 'NOT_FOUND');

  // 先收集待删物理文件，删除库记录后清理磁盘（避免事务内删文件、回滚却已丢失）
  const files = await query<any>('SELECT storage_path FROM file_info WHERE biz_type = ? AND biz_id = ?', [BIZ_LEDGER, id]);
  const paths = files.map((f: any) => f.storage_path);

  await withTransaction(async (conn) => {
    await conn.execute('DELETE FROM file_info WHERE biz_type = ? AND biz_id = ?', [BIZ_LEDGER, id]);
    await conn.execute('DELETE FROM ledger_record WHERE id = ?', [id]);
  });

  for (const p of paths) {
    try { if (p && fs.existsSync(p)) fs.unlinkSync(p); } catch { /* 忽略清理失败 */ }
  }

  await writeAudit({ userId: req.user!.id, username: req.user!.username, action: 'ledger:delete', request: { id }, result: 'SUCCESS', ip: req.ip });
  return ok(res, { id }, '台账记录已删除');
});

// ---------------------------------------------------------------------------
// 统计：指标卡 + 按条口 / 工作类型 / 月份 / 网格
// ---------------------------------------------------------------------------
const statsSchema = z.object({
  start: z.string().nullable().optional(),
  end: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
  workType: z.string().nullable().optional(),
});

router.get('/stats', requirePermission('ledger:view'), async (req: Request, res: Response) => {
  const q = statsSchema.parse(req.query);
  const { where, params } = buildListFilter({ ...q, keyword: '' });

  const sumRow = await queryOne<any>(
    `SELECT
        COUNT(*) AS record_count,
        COALESCE(SUM(labor_cost),0) AS labor,
        COALESCE(SUM(invoice_cost),0) AS invoice,
        COALESCE(SUM(labor_cost + invoice_cost),0) AS total
     FROM ledger_record l WHERE ${where}`,
    params
  );

  const attachRow = await queryOne<any>(
    `SELECT COUNT(f.id) AS cnt
     FROM ledger_record l LEFT JOIN file_info f ON f.biz_type = '${BIZ_LEDGER}' AND f.biz_id = l.id
     WHERE ${where}`,
    params
  );

  const byCategory = await query<any>(
    `SELECT category, COUNT(*) AS cnt,
            COALESCE(SUM(labor_cost),0) AS labor,
            COALESCE(SUM(invoice_cost),0) AS invoice, COALESCE(SUM(labor_cost+invoice_cost),0) AS total
     FROM ledger_record l WHERE ${where} GROUP BY category ORDER BY total DESC`,
    params
  );

  const byWorkType = await query<any>(
    `SELECT work_type, COUNT(*) AS cnt,
            COALESCE(SUM(labor_cost+invoice_cost),0) AS total
     FROM ledger_record l WHERE ${where} GROUP BY work_type ORDER BY total DESC`,
    params
  );

  const byMonth = await query<any>(
    `SELECT DATE_FORMAT(record_date,'%Y-%m') AS month, COUNT(*) AS cnt,
            COALESCE(SUM(labor_cost),0) AS labor,
            COALESCE(SUM(invoice_cost),0) AS invoice, COALESCE(SUM(labor_cost+invoice_cost),0) AS total
     FROM ledger_record l WHERE ${where} GROUP BY month ORDER BY month`,
    params
  );

  return ok(res, {
    summary: {
      recordCount: Number(sumRow?.record_count || 0),
      laborCost: Number(sumRow?.labor || 0),
      invoiceCost: Number(sumRow?.invoice || 0),
      totalCost: Number(sumRow?.total || 0),
      attachmentCount: Number(attachRow?.cnt || 0),
    },
    byCategory: byCategory.map((r: any) => ({
      code: r.category, name: categoryName(r.category),
      count: Number(r.cnt), laborCost: Number(r.labor),
      invoiceCost: Number(r.invoice), totalCost: Number(r.total),
    })),
    byWorkType: byWorkType.map((r: any) => ({
      code: r.work_type, name: workTypeName(r.work_type), count: Number(r.cnt), totalCost: Number(r.total),
    })),
    byMonth: byMonth.map((r: any) => ({
      month: r.month, count: Number(r.cnt), laborCost: Number(r.labor),
      invoiceCost: Number(r.invoice), totalCost: Number(r.total),
    })),
  });
});

export default router;
