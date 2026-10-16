import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * 权限上下文缓存的测试。
 * 用 mock 掉 db 层，直接断言「查询次数」——这正是缓存要解决的问题
 * （每个请求 3 条 SQL 变成每分钟 3 条）。
 */
const h = vi.hoisted(() => ({
  queryOne: vi.fn(),
  query: vi.fn(),
}));

vi.mock('../src/config/db', () => ({
  queryOne: h.queryOne,
  query: h.query,
}));

// 必须在 vi.mock 之后 import，确保拿到的是被替换过的依赖
import { loadAuthContext, invalidateAuthCache } from '../src/middleware/auth';

describe('权限上下文缓存', () => {
  beforeEach(() => {
    invalidateAuthCache(); // 清空模块级缓存，避免用例互相污染
    h.queryOne.mockReset();
    h.query.mockReset();

    h.queryOne.mockResolvedValue({
      id: 1,
      username: 'admin',
      real_name: '系统管理员',
      is_admin: 1,
      status: 1,
    });
    h.query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM sys_role r')) return [{ code: 'SYSTEM_ADMIN' }];
      if (sql.includes('FROM sys_permission p')) return [{ code: 'person:view' }];
      return [];
    });
  });

  it('首次加载会查用户 + 角色 + 权限（3 条 SQL）', async () => {
    const ctx = await loadAuthContext(1);
    expect(h.queryOne).toHaveBeenCalledTimes(1);
    expect(h.query).toHaveBeenCalledTimes(2);
    expect(ctx.roles).toEqual(['SYSTEM_ADMIN']);
    expect(ctx.permissions.has('person:view')).toBe(true);
    expect(ctx.active).toBe(true);
  });

  it('TTL 内重复加载命中缓存，不再打库', async () => {
    await loadAuthContext(1);
    const before = h.queryOne.mock.calls.length + h.query.mock.calls.length;

    await loadAuthContext(1);
    await loadAuthContext(1);

    const after = h.queryOne.mock.calls.length + h.query.mock.calls.length;
    expect(after).toBe(before); // 后两次一次 SQL 都没发
  });

  it('invalidateAuthCache(userId) 后重新查库', async () => {
    await loadAuthContext(1);
    const before = h.queryOne.mock.calls.length;

    invalidateAuthCache(1);
    await loadAuthContext(1);

    expect(h.queryOne.mock.calls.length).toBe(before + 1);
  });

  it('invalidateAuthCache() 清空全部用户缓存', async () => {
    await loadAuthContext(1);
    await loadAuthContext(2);
    const before = h.queryOne.mock.calls.length;

    invalidateAuthCache();
    await loadAuthContext(1);
    await loadAuthContext(2);

    expect(h.queryOne.mock.calls.length).toBe(before + 2);
  });

  it('账号被停用时 active=false（供 authMiddleware 拒绝旧 token）', async () => {
    h.queryOne.mockResolvedValue({
      id: 1,
      username: 'admin',
      real_name: '系统管理员',
      is_admin: 1,
      status: 0,
    });
    const ctx = await loadAuthContext(1);
    expect(ctx.active).toBe(false);
  });

  it('用户不存在时抛错，且不留下脏缓存', async () => {
    h.queryOne.mockResolvedValue(null);
    await expect(loadAuthContext(9)).rejects.toThrow('用户不存在');

    // 第二次仍应打库（若被缓存成 null 就不会再查）
    h.queryOne.mockResolvedValue({
      id: 9,
      username: 'x',
      real_name: 'x',
      is_admin: 0,
      status: 1,
    });
    const ctx = await loadAuthContext(9);
    expect(ctx.id).toBe(9);
  });
});
