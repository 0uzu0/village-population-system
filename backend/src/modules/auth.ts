import { Router, Request, Response } from 'express';
import { queryOne, execute } from '../config/db';
import { verifyPassword, hashPassword } from '../utils/crypto';
import { signToken, loadAuthContext, invalidateAuthCache } from '../middleware/auth';
import { authMiddleware } from '../middleware/auth';
import { ok, fail } from '../utils/response';
import { writeAudit } from '../middleware/audit';
import { loginRateLimit } from '../middleware/rateLimit';
import { z } from 'zod';

const router = Router();

const loginSchema = z.object({
  username: z.string().min(1, '请输入账号'),
  password: z.string().min(1, '请输入密码'),
});

/** 登录（限流：同 IP 每分钟 10 次，防密码爆破） */
router.post('/login', loginRateLimit, async (req: Request, res: Response) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, parsed.error.errors[0].message);
  const { username, password } = parsed.data;

  const user = await queryOne<any>(
    'SELECT id, username, password_hash, real_name, status, is_admin, token_version FROM sys_user WHERE username = ?',
    [username]
  );
  if (!user || !verifyPassword(password, user.password_hash)) {
    await writeAudit({ username, action: 'auth:login', result: 'FAIL', ip: req.ip });
    return fail(res, '账号或密码错误', 401, 'INVALID_CREDENTIALS');
  }
  if (user.status !== 1) {
    return fail(res, '账号已被停用', 403, 'ACCOUNT_DISABLED');
  }

  const token = signToken({ id: user.id, username: user.username, tokenVersion: Number(user.token_version ?? 0) });
  const ctx = await loadAuthContext(user.id);

  await writeAudit({ userId: user.id, username: user.username, action: 'auth:login', result: 'SUCCESS', ip: req.ip });

  return ok(res, {
    token,
    user: {
      id: user.id,
      username: user.username,
      realName: user.real_name,
      isAdmin: !!user.is_admin,
      roles: ctx.roles,
      permissions: Array.from(ctx.permissions),
    },
  });
});

/** 当前登录用户信息 */
router.get('/me', authMiddleware, async (req: Request, res: Response) => {
  const ctx = req.user!;
  return ok(res, {
    id: ctx.id,
    username: ctx.username,
    realName: ctx.realName,
    isAdmin: ctx.isAdmin,
    roles: ctx.roles,
    permissions: Array.from(ctx.permissions),
  });
});

const passwordSchema = z.object({
  oldPassword: z.string().min(1),
  newPassword: z.string().min(8, '新密码至少8位').max(64),
});

/** 修改密码 */
router.put('/password', authMiddleware, async (req: Request, res: Response) => {
  const parsed = passwordSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, parsed.error.errors[0].message);
  const { oldPassword, newPassword } = parsed.data;
  const user = await queryOne<any>('SELECT password_hash FROM sys_user WHERE id = ?', [req.user!.id]);
  if (!user || !verifyPassword(oldPassword, user.password_hash)) {
    return fail(res, '原密码错误', 400, 'OLD_PASSWORD_WRONG');
  }
  // 改密码同时把令牌版本 +1：其他设备上仍有效的旧 token 立即作废。
  // 当前这台设备换发一张新 token（下面返回给前端替换），否则用户改完密码
  // 立刻被自己的操作踢下线，体验上说不过去。
  await execute(
    'UPDATE sys_user SET password_hash = ?, token_version = token_version + 1 WHERE id = ?',
    [hashPassword(newPassword), req.user!.id]
  );
  // 缓存里存的还是旧版本号，不失效的话最长 60 秒内旧 token 仍能通过校验
  invalidateAuthCache(req.user!.id);
  const nextToken = signToken({
    id: req.user!.id,
    username: req.user!.username,
    tokenVersion: req.user!.tokenVersion + 1,
  });

  await writeAudit({ userId: req.user!.id, username: req.user!.username, action: 'auth:change_password', result: 'SUCCESS' });
  return ok(res, { token: nextToken }, '密码修改成功');
});

export default router;
