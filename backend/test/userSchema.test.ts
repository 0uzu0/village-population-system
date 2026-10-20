import { describe, it, expect } from 'vitest';
import { userSchema } from '../src/modules/user';

/**
 * 用户表单校验契约。
 *
 * 回归背景：编辑用户时前端会带 `password: ''`（不改密码），
 * 曾直接撞上 min(8) 报「String must contain at least 8 character(s)」，
 * 导致管理员开关/资料修改整个保存失败。
 */
describe('userSchema：编辑时空串密码按「未填」处理', () => {
  it('password 为空串 → 视为未传，校验通过且不产出 password 字段', () => {
    const parsed = userSchema.partial().parse({ isAdmin: 1, password: '' });
    expect(parsed.password).toBeUndefined();
    expect(parsed.isAdmin).toBe(1);
  });

  it('password 未传 → 通过（partial 编辑的常态）', () => {
    const parsed = userSchema.partial().parse({ realName: '张三' });
    expect(parsed.password).toBeUndefined();
  });

  it('给了密码就仍要求至少 8 位（防误设弱密码）', () => {
    expect(() => userSchema.partial().parse({ password: '1234567' })).toThrow();
    const ok = userSchema.partial().parse({ password: '12345678' });
    expect(ok.password).toBe('12345678');
  });

  it('null 也按「未填」放行（.nullable() 的既有约定）', () => {
    const parsed = userSchema.partial().parse({ password: null });
    expect(parsed.password).toBeNull();
  });
});
