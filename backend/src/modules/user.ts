import { Router, Request, Response } from 'express';
import { query, queryOne, execute, withTransaction } from '../config/db';
import { authMiddleware } from '../middleware/auth';
import { requirePermission } from '../middleware/rbac';
import { ok, okPage, AppError, PageResult } from '../utils/response';
import { writeAudit } from '../middleware/audit';
import { hashPassword } from '../utils/crypto';
import { z } from 'zod';

const router = Router();
router.use(authMiddleware);

/** 用户列表 */
router.get('/', requirePermission('user:view'), async (req: Request, res: Response) => {
  const q = z.object({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(500).default(20), keyword: z.string().optional() }).parse(req.query);
  const where: string[] = ['1=1'];
  const params: any[] = [];
  if (q.keyword) { where.push('(u.username LIKE ? OR u.real_name LIKE ?)'); params.push(`%${q.keyword}%`, `%${q.keyword}%`); }
  const whereSql = where.join(' AND ');

  const totalRow = await queryOne<any>(`SELECT COUNT(*) AS cnt FROM sys_user u WHERE ${whereSql}`, params);
  const rows = await query<any>(
    `SELECT u.id, u.username, u.real_name, u.phone, u.email, u.status, u.is_admin, u.created_at
     FROM sys_user u WHERE ${whereSql} ORDER BY u.id LIMIT ? OFFSET ?`,
    [...params, q.pageSize, (q.page - 1) * q.pageSize]
  );
  const result: PageResult<any> = { list: rows, total: Number(totalRow?.cnt || 0), page: q.page, pageSize: q.pageSize };
  return okPage(res, result);
});

const userSchema = z.object({
  username: z.string().min(1).max(64),
  realName: z.string().min(1).max(64),
  password: z.string().min(8).max(64).optional().or(z.literal('')),
  phone: z.string().max(20).optional().or(z.literal('')),
  email: z.string().max(128).optional().or(z.literal('')),
  isAdmin: z.coerce.number().min(0).max(1).default(0),
});

/** 根据是否管理员关联角色 */
async function roleIdByAdmin(isAdmin: boolean): Promise<number> {
  const code = isAdmin ? 'SYSTEM_ADMIN' : 'USER';
  const role = await queryOne<any>('SELECT id FROM sys_role WHERE code = ?', [code]);
  return role?.id;
}

/** 新增用户 */
router.post('/', requirePermission('user:manage'), async (req: Request, res: Response) => {
  const body = userSchema.parse(req.body);
  const dup = await queryOne<any>('SELECT id FROM sys_user WHERE username = ?', [body.username]);
  if (dup) throw new AppError('账号已存在', 409, 'DUPLICATE_USERNAME');
  if (!body.password) throw new AppError('初始密码必填（至少8位）');

  const isAdmin = !!body.isAdmin;
  const roleId = await roleIdByAdmin(isAdmin);

  await withTransaction(async (conn) => {
    const r: any = await conn.query(
      'INSERT INTO sys_user (username, password_hash, real_name, phone, email, status, is_admin) VALUES (?,?,?,?,?,1,?)',
      [body.username, hashPassword(body.password!), body.realName, body.phone || null, body.email || null, isAdmin ? 1 : 0]
    );
    const uid = r[0].insertId;
    if (roleId) await conn.query('INSERT IGNORE INTO sys_user_role (user_id, role_id) VALUES (?,?)', [uid, roleId]);
  });

  await writeAudit({ userId: req.user!.id, username: req.user!.username, action: 'user:create', request: { username: body.username, isAdmin }, result: 'SUCCESS', ip: req.ip });
  return ok(res, null, '用户已创建');
});

/** 编辑用户（含管理员开关） */
router.put('/:id', requirePermission('user:manage'), async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const body = userSchema.partial().parse(req.body);
  const isAdmin = body.isAdmin !== undefined ? !!body.isAdmin : undefined;
  const roleId = isAdmin !== undefined ? await roleIdByAdmin(isAdmin) : null;

  await withTransaction(async (conn) => {
    if (body.realName !== undefined || body.phone !== undefined || body.email !== undefined) {
      await conn.query('UPDATE sys_user SET real_name = ?, phone = ?, email = ? WHERE id = ?', [body.realName ?? null, body.phone ?? null, body.email ?? null, id]);
    }
    if (body.password) {
      await conn.query('UPDATE sys_user SET password_hash = ? WHERE id = ?', [hashPassword(body.password), id]);
    }
    if (isAdmin !== undefined) {
      await conn.query('UPDATE sys_user SET is_admin = ? WHERE id = ?', [isAdmin ? 1 : 0, id]);
      await conn.query('DELETE FROM sys_user_role WHERE user_id = ?', [id]);
      if (roleId) await conn.query('INSERT IGNORE INTO sys_user_role (user_id, role_id) VALUES (?,?)', [id, roleId]);
    }
  });
  await writeAudit({ userId: req.user!.id, username: req.user!.username, action: 'user:edit', request: { id, isAdmin }, result: 'SUCCESS', ip: req.ip });
  return ok(res, { id }, '用户已更新');
});

/** 启用/停用用户 */
router.post('/:id/toggle', requirePermission('user:manage'), async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (id === req.user!.id) throw new AppError('不能停用自己的账号');
  const u = await queryOne<any>('SELECT status FROM sys_user WHERE id = ?', [id]);
  if (!u) throw new AppError('用户不存在', 404, 'NOT_FOUND');
  const next = u.status ? 0 : 1;
  await execute('UPDATE sys_user SET status = ? WHERE id = ?', [next, id]);
  return ok(res, { id, status: !!next }, next ? '用户已启用' : '用户已停用');
});

/** 角色列表（仅系统管理员/普通用户两种） */
router.get('/roles', requirePermission('user:view'), async (_req: Request, res: Response) => {
  const roles = await query<any>('SELECT id, code, name, remark FROM sys_role ORDER BY id');
  return ok(res, roles);
});

/** 权限列表 */
router.get('/permissions', requirePermission('user:view'), async (_req: Request, res: Response) => {
  const rows = await query<any>('SELECT * FROM sys_permission ORDER BY id');
  return ok(res, rows);
});

export default router;
