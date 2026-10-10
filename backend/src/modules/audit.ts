import { Router, Request, Response } from 'express';
import { query, queryOne } from '../config/db';
import { authMiddleware } from '../middleware/auth';
import { requirePermission } from '../middleware/rbac';
import { ok, okPage, PageResult } from '../utils/response';
import { z } from 'zod';

const router = Router();
router.use(authMiddleware);

/** 审计日志列表 */
router.get('/', requirePermission('audit:view'), async (req: Request, res: Response) => {
  const q = z.object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    keyword: z.string().optional(),
    action: z.string().optional(),
    result: z.string().optional(),
    start: z.string().optional(),
    end: z.string().optional(),
  }).parse(req.query);

  const where: string[] = ['1=1'];
  const params: any[] = [];
  if (q.keyword) { where.push('(a.username LIKE ? OR a.action LIKE ?)'); params.push(`%${q.keyword}%`, `%${q.keyword}%`); }
  if (q.action) { where.push('a.action = ?'); params.push(q.action); }
  if (q.result) { where.push('a.result = ?'); params.push(q.result); }
  if (q.start) { where.push('a.created_at >= ?'); params.push(q.start); }
  if (q.end) { where.push('a.created_at <= ?'); params.push(q.end); }
  const whereSql = where.join(' AND ');

  const totalRow = await queryOne<any>(`SELECT COUNT(*) AS cnt FROM audit_log a WHERE ${whereSql}`, params);
  const rows = await query<any>(
    `SELECT a.* FROM audit_log a WHERE ${whereSql} ORDER BY a.created_at DESC LIMIT ? OFFSET ?`,
    [...params, q.pageSize, (q.page - 1) * q.pageSize]
  );
  const result: PageResult<any> = { list: rows, total: Number(totalRow?.cnt || 0), page: q.page, pageSize: q.pageSize };
  return okPage(res, result);
});

/** 字典查询 */
router.get('/dicts/:type', requirePermission('dashboard:view'), async (req: Request, res: Response) => {
  const rows = await query<any>('SELECT dict_label, dict_value, sort FROM sys_dict WHERE dict_type = ? AND enabled = 1 ORDER BY sort', [req.params.type]);
  return ok(res, rows);
});

export default router;
