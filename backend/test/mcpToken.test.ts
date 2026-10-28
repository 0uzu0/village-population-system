/**
 * MCP 长期令牌的单元测试。
 *
 * 全部是纯逻辑 + 静态守卫，不需要数据库：
 * 令牌的安全性不体现在「能不能查到数据」，而体现在几条边界上——
 * 库里不留明文、吊销/过期/改密码三条失效路径、只读令牌看不到写工具、
 * 以及「令牌只能进 /api/mcp，不能直接打业务接口」这条边界不被悄悄扩大。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';

// tokens.ts 会连库；这里的断言都不需要真实连接，只验证它发给库的语义
vi.mock('../src/config/db', () => ({ queryOne: vi.fn(), query: vi.fn(), execute: vi.fn() }));

import { execute, queryOne } from '../src/config/db';
import {
  MAX_TOKENS_PER_USER,
  TOKEN_PREFIX,
  findValidToken,
  generateToken,
  hashToken,
  looksLikeToken,
  normalizeName,
  normalizeScope,
  resetTouchCache,
  revokeToken,
  touchToken,
} from '../src/modules/mcp/tokens';
import { tokenWriteCeiling } from '../src/modules/mcp/mcpAuth';

const root = path.resolve(__dirname, '..');

beforeEach(() => {
  vi.clearAllMocks();
  resetTouchCache();
});

describe('令牌生成', () => {
  it('带可识别前缀，长度足以抵抗枚举', () => {
    const { token } = generateToken();
    expect(token.startsWith(TOKEN_PREFIX)).toBe(true);
    // vpm_ + 32 字节 base64url（43 字符）
    expect(token.length).toBeGreaterThanOrEqual(40);
  });

  it('每次都不一样', () => {
    const seen = new Set(Array.from({ length: 50 }, () => generateToken().token));
    expect(seen.size).toBe(50);
  });

  it('库里存的是 sha256，明文无法从 hash 反推', () => {
    const { token, hash } = generateToken();
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(token);
    expect(hashToken(token)).toBe(hash);
  });

  it('prefix 是明文前 12 位，用于列表区分是哪一枚', () => {
    const { token, prefix } = generateToken();
    expect(prefix).toBe(token.slice(0, 12));
  });

  it('能识别本系统的令牌，不会把 JWT 当成长令牌', () => {
    expect(looksLikeToken(generateToken().token)).toBe(true);
    expect(looksLikeToken('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.xxx')).toBe(false);
    expect(looksLikeToken('')).toBe(false);
  });
});

describe('入参归一化', () => {
  it('scope 只认 write，其余一律降级为只读', () => {
    // 故意传乱七八糟的值：宁可变只读，也不能因为拼写错误变成可写
    expect(normalizeScope('write')).toBe('write');
    expect(normalizeScope('WRITE')).toBe('read');
    expect(normalizeScope('admin')).toBe('read');
    expect(normalizeScope(undefined)).toBe('read');
    expect(normalizeScope(1)).toBe('read');
  });

  it('名字为空时给个能认的默认值，超长截断', () => {
    expect(normalizeName('  ')).toBe('未命名令牌');
    expect(normalizeName(undefined)).toBe('未命名令牌');
    expect(normalizeName('  家里电脑  ')).toBe('家里电脑');
    expect(normalizeName('x'.repeat(200)).length).toBe(64);
  });
});

describe('令牌校验', () => {
  const row = {
    id: 1,
    user_id: 7,
    name: '家里的 Claude',
    scope: 'read' as const,
    token_hash: 'h',
    token_prefix: 'vpm_abcdefg',
    token_version: 3,
    expires_at: null,
    last_used_at: null,
    last_used_ip: null,
    revoked_at: null,
    created_at: '2026-10-28 10:00:00',
  };

  it('查不到就是 null（不能靠错误信息区分「不存在」与「已吊销」）', async () => {
    (queryOne as any).mockResolvedValueOnce(null);
    expect(await findValidToken('vpm_nope')).toBeNull();
  });

  it('已吊销的令牌带着原因返回，供调用方给出「重新创建」的提示', async () => {
    (queryOne as any).mockResolvedValueOnce({ ...row, revoked_at: '2026-10-28 11:00:00' });
    const found: any = await findValidToken('vpm_revoked');
    expect(found.reason).toBe('REVOKED');
  });

  it('过期令牌同样失效', async () => {
    (queryOne as any).mockResolvedValueOnce({ ...row, expires_at: '2020-01-01 00:00:00' });
    const found: any = await findValidToken('vpm_expired');
    expect(found.reason).toBe('EXPIRED');
  });

  it('长期有效（expires_at 为 NULL）不因时间失效', async () => {
    (queryOne as any).mockResolvedValueOnce({ ...row });
    const found: any = await findValidToken('vpm_ok');
    expect(found.reason).toBeUndefined();
    expect(found.row.id).toBe(1);
  });

  it('按 hash 查，绝不按明文查', async () => {
    (queryOne as any).mockResolvedValueOnce(null);
    await findValidToken('vpm_plaintext');
    const [sql, params] = (queryOne as any).mock.calls[0];
    expect(sql).toContain('token_hash');
    expect(params[0]).toBe(hashToken('vpm_plaintext'));
    expect(params[0]).not.toBe('vpm_plaintext');
  });
});

describe('吊销', () => {
  it('普通用户只能吊销自己的（SQL 里带 user_id 条件）', async () => {
    (execute as any).mockResolvedValueOnce({ affectedRows: 1 });
    await revokeToken(5, 7, false);
    const [sql, params] = (execute as any).mock.calls[0];
    expect(sql).toContain('user_id = ?');
    expect(params).toEqual([5, 7]);
  });

  it('管理员不受 user_id 限制（应急止血），但仍不物理删除', async () => {
    (execute as any).mockResolvedValueOnce({ affectedRows: 1 });
    await revokeToken(5, 1, true);
    const [sql, params] = (execute as any).mock.calls[0];
    expect(sql).not.toContain('user_id = ?');
    expect(sql).toContain('revoked_at = NOW()');
    expect(params).toEqual([5]);
  });

  it('已经吊销过的不重复记时间（affectedRows=0 让上层报 404）', async () => {
    (execute as any).mockResolvedValueOnce({ affectedRows: 0 });
    expect(await revokeToken(5, 7, false)).toBe(false);
    const [sql] = (execute as any).mock.calls[0];
    expect(sql).toContain('revoked_at IS NULL');
  });
});

describe('最近使用时间节流', () => {
  it('同一枚令牌 60 秒内只写一次库', async () => {
    (execute as any).mockResolvedValue({ affectedRows: 1 });
    touchToken(1, '10.0.0.1');
    touchToken(1, '10.0.0.1');
    touchToken(1, '10.0.0.1');
    expect((execute as any).mock.calls.length).toBe(1);
  });

  it('不同令牌互不影响', async () => {
    (execute as any).mockResolvedValue({ affectedRows: 1 });
    touchToken(1, '10.0.0.1');
    touchToken(2, '10.0.0.2');
    expect((execute as any).mock.calls.length).toBe(2);
  });
});

describe('只读令牌的写入上限', () => {
  it('read 令牌把写入等级压到 off（于是写工具根本不出现在清单里）', () => {
    expect(tokenWriteCeiling({ mcpToken: { id: 1, name: 'x', scope: 'read' } } as any)).toBe('off');
  });

  it('write 令牌不额外设限，交给全局 MCP_WRITE_LEVEL 决定', () => {
    expect(tokenWriteCeiling({ mcpToken: { id: 1, name: 'x', scope: 'write' } } as any)).toBeNull();
  });

  it('JWT 登录（没有令牌）不受影响', () => {
    expect(tokenWriteCeiling({} as any)).toBeNull();
  });
});

/**
 * 静态守卫：这些约束删掉不会报错，只会静默失去安全性。
 */
describe('安全边界守卫', () => {
  const read = (p: string) => fs.readFileSync(path.resolve(root, 'src', p), 'utf8');

  it('长期令牌只能进 /api/mcp：全局鉴权中间件不认识它', () => {
    // 一旦有人图省事在 authMiddleware 里加 mcp_token 分支，这枚长期令牌就能
    // 直接打 /api/persons、/api/files，等于给系统开了绕过 7 天过期的后门。
    const src = read('middleware/auth.ts');
    expect(src).not.toMatch(/mcp_token/);
    expect(src).not.toMatch(/looksLikeToken/);
  });

  it('令牌管理接口只认 JWT，且只能给自己创建', () => {
    const src = read('modules/mcp/tokenRoutes.ts');
    expect(src).toMatch(/router\.use\(authMiddleware\)/);
    expect(src).not.toMatch(/mcpAuth/);
    // 创建时 userId 必须取自登录态，不接受请求体指定
    expect(src).toMatch(/userId:\s*user\.id/);
    expect(src).not.toMatch(/userId:\s*req\.body/);
  });

  it('审计里不出现明文：创建令牌时只记 id/名称/范围', () => {
    const src = read('modules/mcp/tokenRoutes.ts');
    // 精确截取 writeAudit({ ... }) 这一块，避免把后面的响应体也算进来
    const blocks = src.match(/writeAudit\(\{[\s\S]*?\n {2}\}\);/g) || [];
    const createAudit = blocks.find((b) => b.includes('mcp:token_create'));
    expect(createAudit, '没找到创建令牌的审计写入').toBeTruthy();
    expect(createAudit).not.toMatch(/created\.token/);
  });

  it('迁移：明文列不存在，且 hash 唯一、可重入', () => {
    const sql = fs.readFileSync(
      path.resolve(root, 'src', 'db', 'migrations', 'V027__mcp_token.sql'),
      'utf8'
    );
    // 只存 hash：出现「token VARCHAR」这种列名就说明有人改了主意
    expect(sql).toMatch(/`token_hash` CHAR\(64\) NOT NULL/);
    expect(sql).toMatch(/UNIQUE KEY `uk_mcp_token_hash`/);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS/);
    // 三条失效路径所需的列必须在
    expect(sql).toMatch(/`token_version`/);
    expect(sql).toMatch(/`expires_at`/);
    expect(sql).toMatch(/`revoked_at`/);
    // scope 默认只读
    expect(sql).toMatch(/`scope` VARCHAR\(8\) NOT NULL DEFAULT 'read'/);
    // 无外键（全库统一约定）
    expect(sql).not.toMatch(/FOREIGN KEY/i);
  });

  it('每人令牌数量有上限，避免无限累积', () => {
    expect(MAX_TOKENS_PER_USER).toBeGreaterThan(0);
    const src = read('modules/mcp/tokens.ts');
    expect(src).toMatch(/COUNT\(\*\)/);
  });
});
