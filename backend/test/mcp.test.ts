import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { ALL_TOOLS, enabledTools, isEnabled, visibleTools, writeLevel } from '../src/modules/mcp/registry';
import { coerceArgs, toJsonSchema } from '../src/modules/mcp/params';
import { internalUrl, maskPii, normalizeKeys } from '../src/modules/mcp/invoke';
import { handleRpc } from '../src/modules/mcp/protocol';
import { ToolCtx, ToolDef, ToolRunError } from '../src/modules/mcp/types';

/**
 * 这组测试不启服务、不连数据库，只覆盖「协议层与工具层」的纯逻辑。
 * 重点不是「工具有没有返回数据」（那取决于库里的真实数据），而是三条容易悄悄坏掉的约束：
 *   1. 工具清单必须按权限过滤 —— 坏了就等于越权可见；
 *   2. 参数必须收敛类型 —— 坏了会让下游 SQL 收到字符串；
 *   3. 敏感字段必须脱敏 —— 坏了身份证会直接进大模型上下文。
 */

const fakeCtx = (over: Partial<ToolCtx> = {}): ToolCtx => ({
  token: 't',
  userId: 1,
  username: 'tester',
  isAdmin: false,
  permissions: new Set<string>(),
  ip: '127.0.0.1',
  call: async () => ({}),
  send: async () => ({}),
  catalog: [],
  ...over,
});

describe('MCP 工具注册表', () => {
  it('工具名唯一且符合协议允许的字符集', () => {
    const names = ALL_TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const n of names) {
      expect(n).toMatch(/^[a-z][a-z0-9_]{1,63}$/);
    }
  });

  it('每个工具都声明了权限码与数据域', () => {
    for (const t of ALL_TOOLS) {
      expect(t.permission).toMatch(/^[a-z]+:[a-z]+$/);
      expect(t.domain.length).toBeGreaterThan(0);
      expect(t.description.length).toBeGreaterThan(10);
    }
  });

  it('数据域覆盖全部业务模块', () => {
    const domains = new Set(ALL_TOOLS.map((t) => t.domain));
    for (const d of ['meta', 'person', 'family', 'grid', 'tag', 'keygroup', 'statistics', 'ledger', 'pending', 'excel', 'audit', 'admin', 'file']) {
      expect(domains.has(d)).toBe(true);
    }
  });

  it('默认只开放只读工具', () => {
    const level = writeLevel();
    // 默认部署不带 MCP_WRITE_LEVEL，应为 off
    expect(level).toBe('off');
    const tools = enabledTools(level);
    expect(tools.every((t) => t.scope === 'read')).toBe(true);
    expect(tools.length).toBe(ALL_TOOLS.filter((t) => t.scope === 'read').length);
  });

  it('写入与危险操作分级放开', () => {
    const write = ALL_TOOLS.find((t) => t.scope === 'write')!;
    const danger = ALL_TOOLS.find((t) => t.scope === 'danger');
    expect(isEnabled(write, 'off')).toBe(false);
    expect(isEnabled(write, 'basic')).toBe(true);
    // danger 除了 file level 还要单独的破坏性开关，这里只断言 off/basic 不放行
    if (danger) {
      expect(isEnabled(danger, 'off')).toBe(false);
      expect(isEnabled(danger, 'basic')).toBe(false);
    }
  });

  it('无权限的账号看不到对应工具', () => {
    const reader = visibleTools({ isAdmin: false, permissions: new Set(['person:view']) });
    const names = reader.map((t) => t.name);
    expect(names).toContain('person_search');
    // 没有 keygroup:view，就不该看到重点人群工具
    expect(names).not.toContain('keygroup_quick');
    // 没有 audit:view，就不该看到审计
    expect(names).not.toContain('audit_search');
  });

  it('管理员可见全部已启用工具', () => {
    const admin = visibleTools({ isAdmin: true, permissions: new Set() });
    expect(admin.length).toBe(enabledTools().length);
  });
});

describe('MCP 参数声明与校验', () => {
  const params = [
    { key: 'page', type: 'integer' as const, desc: '页码', default: 1, min: 1 },
    { key: 'activeOnly', type: 'boolean' as const, desc: '只看在册', default: true },
    { key: 'gender', type: 'enum' as const, desc: '性别', values: ['MALE', 'FEMALE'] as const },
    { key: 'keyword', type: 'string' as const, desc: '关键词' },
    { key: 'id', type: 'integer' as const, desc: 'id', required: true },
  ];

  it('生成标准 JSON Schema', () => {
    const schema: any = toJsonSchema(params);
    expect(schema.type).toBe('object');
    expect(schema.properties.page.type).toBe('integer');
    expect(schema.properties.page.default).toBe(1);
    expect(schema.properties.gender.enum).toEqual(['MALE', 'FEMALE']);
    expect(schema.required).toEqual(['id']);
    expect(schema.additionalProperties).toBe(false);
  });

  it('把字符串数字与字符串布尔收敛成真类型', () => {
    const args = coerceArgs(params, { id: '12', page: '3', activeOnly: 'false', gender: 'MALE' });
    expect(args.id).toBe(12);
    expect(args.page).toBe(3);
    expect(args.activeOnly).toBe(false);
  });

  it('空串按未传处理，补默认值', () => {
    const args = coerceArgs(params, { id: 5, keyword: '', page: '' });
    expect(args.keyword).toBeUndefined();
    expect(args.page).toBe(1);
    expect(args.activeOnly).toBe(true);
  });

  it('显式 null 保留（写接口的「清空字段」语义）', () => {
    const args = coerceArgs(params, { id: 5, keyword: null });
    expect(args.keyword).toBeNull();
  });

  it('缺必填、类型不符、枚举越界都报错', () => {
    expect(() => coerceArgs(params, {})).toThrow(/id/);
    expect(() => coerceArgs(params, { id: 'abc' })).toThrow(/整数/);
    expect(() => coerceArgs(params, { id: 1, gender: '男' })).toThrow(/MALE/);
  });
});

describe('MCP 字段归一化与脱敏', () => {
  it('下划线转驼峰，且递归处理数组', () => {
    const out = normalizeKeys({ grid_no: 'G01', person_count: 3, list: [{ family_no: 'F1' }] });
    expect(out).toEqual({ gridNo: 'G01', personCount: 3, list: [{ familyNo: 'F1' }] });
  });

  it('不误伤本来就无下划线的键', () => {
    expect(normalizeKeys({ name: '张三', id: 1 })).toEqual({ name: '张三', id: 1 });
  });

  it('默认掩码身份证与手机号', () => {
    const out: any = maskPii({ idCard: '320102199001011234', phone: '13812345678' });
    expect(out.idCard).toBe('320102********1234');
    expect(out.phone).toBe('138****5678');
  });

  it('MCP_PII_MODE=full 时原样返回', () => {
    const old = process.env.MCP_PII_MODE;
    process.env.MCP_PII_MODE = 'full';
    try {
      const out: any = maskPii({ phone: '13812345678' });
      expect(out.phone).toBe('13812345678');
    } finally {
      if (old === undefined) delete process.env.MCP_PII_MODE;
      else process.env.MCP_PII_MODE = old;
    }
  });
});

describe('MCP 协议层', () => {
  const echoTool: ToolDef = {
    name: 'echo_test',
    title: '回声',
    description: '测试用工具，把传入的 keyword 原样返回',
    domain: 'meta',
    scope: 'read',
    permission: 'person:view',
    params: [{ key: 'keyword', type: 'string', desc: '关键词' }],
    note: '这是测试口径',
    async exec(_ctx, args) {
      return { echo: args.keyword };
    },
  };

  const boomTool: ToolDef = {
    ...echoTool,
    name: 'boom_test',
    async exec() {
      // 直接抛 ToolRunError，验证协议层会把它转成 isError 内容而不是协议错误
      throw new ToolRunError('记录不存在', 'NOT_FOUND');
    },
  };

  const tools = [echoTool, boomTool];

  let audit: string[] = [];
  const onCall = (tool: string) => audit.push(tool);

  beforeEach(() => {
    audit = [];
  });

  it('initialize 返回协议版本与能力声明', async () => {
    const r: any = await handleRpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }, fakeCtx(), tools);
    expect(r.result.protocolVersion).toBe('2025-03-26');
    expect(r.result.capabilities.tools).toBeDefined();
    expect(r.result.serverInfo.name).toBe('village-population-mcp');
  });

  it('tools/list 输出 inputSchema 与只读标注', async () => {
    const r: any = await handleRpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, fakeCtx(), tools);
    const t = r.result.tools.find((x: any) => x.name === 'echo_test');
    expect(t.inputSchema.properties.keyword.type).toBe('string');
    expect(t.annotations.readOnlyHint).toBe(true);
  });

  it('tools/call 成功时返回 content 文本与口径', async () => {
    const r: any = await handleRpc(
      { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'echo_test', arguments: { keyword: '张' } } },
      fakeCtx(),
      tools,
      onCall
    );
    expect(r.result.content[0].type).toBe('text');
    const payload = JSON.parse(r.result.content[0].text);
    expect(payload.echo).toBe('张');
    expect(payload._meta.caliber).toBe('这是测试口径');
    expect(audit).toEqual(['echo_test']);
  });

  it('未知工具回 -32602，而不是静默成功', async () => {
    const r: any = await handleRpc(
      { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'nope', arguments: {} } },
      fakeCtx(),
      tools
    );
    expect(r.error.code).toBe(-32602);
  });

  it('参数不合法回 -32602', async () => {
    const r: any = await handleRpc(
      { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'echo_test', arguments: { keyword: { a: 1 } } } },
      fakeCtx(),
      tools
    );
    expect(r.error.code).toBe(-32602);
  });

  it('业务失败走 isError 内容，带可执行提示', async () => {
    const r: any = await handleRpc(
      { jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'boom_test', arguments: {} } },
      fakeCtx(),
      tools,
      onCall
    );
    expect(r.result.isError).toBe(true);
    const payload = JSON.parse(r.result.content[0].text);
    expect(payload.code).toBe('NOT_FOUND');
    expect(payload.hint).toMatch(/id/);
  });

  it('接口不存在与记录不存在的提示要能区分开', async () => {
    // 同样是 NOT_FOUND，但「接口不存在」是部署/路径问题，
    // 让模型换个 id 再试是白费功夫，提示必须指向版本/部署。
    const noRoute: ToolDef = {
      ...echoTool,
      name: 'boom_route',
      async exec() {
        throw new ToolRunError('接口不存在: GET /persons', 'NOT_FOUND');
      },
    };
    const r: any = await handleRpc(
      { jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'boom_route', arguments: {} } },
      fakeCtx(),
      [noRoute],
      onCall
    );
    const payload = JSON.parse(r.result.content[0].text);
    expect(payload.hint).toMatch(/版本/);
    expect(payload.hint).not.toMatch(/id 填错/);
  });

  it('未知方法回 -32601', async () => {
    const r: any = await handleRpc({ jsonrpc: '2.0', id: 7, method: 'foo/bar' }, fakeCtx(), tools);
    expect(r.error.code).toBe(-32601);
  });

  it('通知不需要响应体', async () => {
    const r = await handleRpc({ jsonrpc: '2.0', method: 'notifications/initialized' }, fakeCtx(), tools);
    expect(r).toBeNull();
  });
});

describe('真实工具的取数映射', () => {  it('person_search 把参数转成 /persons 查询并整形成 items', async () => {
    const seen: any = {};
    const ctx = fakeCtx({
      call: async (path, query) => {
        seen.path = path;
        seen.query = query;
        return { list: [{ id: 1, name: '张三' }], total: 1, page: 1, pageSize: 20 };
      },
    });
    const tool = ALL_TOOLS.find((t) => t.name === 'person_search')!;
    const out: any = await tool.exec(ctx, { keyword: '张', page: 1, pageSize: 20 });

    expect(seen.path).toBe('/persons');
    expect(seen.query.keyword).toBe('张');
    expect(out.items).toHaveLength(1);
    expect(out.total).toBe(1);
    expect(out.hasMore).toBe(false);
  });

  it('person_get 用 id 拼路径', async () => {
    const seen: any = {};
    const ctx = fakeCtx({
      call: async (path) => {
        seen.path = path;
        return { id: 7, name: '李四' };
      },
    });
    await ALL_TOOLS.find((t) => t.name === 'person_get')!.exec(ctx, { id: 7 });
    expect(seen.path).toBe('/persons/7');
  });
});

/**
 * 静态守卫：这两条是「删掉也不会报错、但后果严重」的接线。
 * - 去掉 authMiddleware，MCP 就变成匿名可读全库；
 * - 去掉 app.use('/api/mcp')，端点直接 404，而单元测试全绿。
 * 没有数据库也能跑，所以放进这组纯逻辑测试里。
 */
describe('MCP 接线守卫', () => {
  const read = (p: string) => fs.readFileSync(path.resolve(__dirname, '..', 'src', p), 'utf8');

  it('MCP 路由强制鉴权，且令牌管理接口排在最前', () => {
    const src = read('modules/mcp/index.ts');
    // 协议端点的双通道鉴权（JWT 或长期令牌），两者都在 mcpAuth 里，不得绕过
    expect(src).toMatch(/router\.use\(mcpAuth\)/);
    // 顺序要求 1：鉴权必须在限流之前，否则未登录请求也会占配额
    expect(src.indexOf('router.use(mcpAuth)')).toBeLessThan(src.indexOf('router.use(\n  rateLimit'));
    // 顺序要求 2：令牌管理必须早于 mcpAuth —— 否则一枚泄露的长期令牌能给自己续签，
    // 吊销立刻失去意义。这条比上面那条更隐蔽，删掉不会报错只会静默失去安全性。
    expect(src.indexOf("router.use('/tokens', tokenRoutes)")).toBeGreaterThanOrEqual(0);
    expect(src.indexOf("router.use('/tokens', tokenRoutes)")).toBeLessThan(src.indexOf('router.use(mcpAuth)'));
  });

  it('令牌管理接口只认 JWT，不认长期令牌', () => {
    const src = read('modules/mcp/tokenRoutes.ts');
    // 必须用 authMiddleware 而不是 mcpAuth
    expect(src).toMatch(/router\.use\(authMiddleware\)/);
    expect(src).not.toMatch(/mcpAuth/);
  });

  it('应用挂载了 /api/mcp', () => {
    expect(read('app.ts')).toMatch(/app\.use\('\/api\/mcp', mcpModule\)/);
  });

  it('MCP 内部转发不会被审计中间件重复记账', () => {
    const src = read('middleware/audit.ts');
    expect(src).toMatch(/x-mcp-call/);
    expect(src).toMatch(/\/api\/mcp/);
  });
});

/**
 * 内部转发 URL 的拼接规则。
 *
 * 这一组是**线上事故补的**：曾用 `new URL(path, baseUrl())` 拼地址，工具传入的
 * `/persons` 是绝对路径，把 base 的 `/api` 整段替换掉，于是所有 tools/call 统一
 * 404「接口不存在: GET /persons」。当时全部单测都是绿的，因为它们在 ctx.call 那层
 * 就被 mock 掉了，根本没走到拼 URL 这一步。
 */
describe('MCP 内部转发地址', () => {
  const saved = process.env.MCP_INTERNAL_BASE;
  afterEach(() => {
    if (saved === undefined) delete process.env.MCP_INTERNAL_BASE;
    else process.env.MCP_INTERNAL_BASE = saved;
  });

  it('必须带上 /api 前缀', () => {
    process.env.MCP_INTERNAL_BASE = 'http://127.0.0.1:3000';
    expect(internalUrl('/persons').pathname).toBe('/api/persons');
    expect(internalUrl('/auth/me').pathname).toBe('/api/auth/me');
  });

  it('path 没有前导斜杠也能拼对，不会粘成一串', () => {
    process.env.MCP_INTERNAL_BASE = 'http://127.0.0.1:3000';
    expect(internalUrl('persons/7').pathname).toBe('/api/persons/7');
  });

  it('覆盖值自带 /api 时不重复拼接', () => {
    process.env.MCP_INTERNAL_BASE = 'http://backend:3000/api';
    expect(internalUrl('/persons').pathname).toBe('/api/persons');
  });

  it('尾斜杠不会拼出双斜杠', () => {
    process.env.MCP_INTERNAL_BASE = 'http://backend:3000/';
    expect(internalUrl('/persons').pathname).toBe('/api/persons');
  });

  it('查询参数：空串与 null 丢弃，其余转字符串', () => {
    process.env.MCP_INTERNAL_BASE = 'http://127.0.0.1:3000';
    const url = internalUrl('/persons', { keyword: '张', page: 2, empty: '', nil: null, undef: undefined });
    expect(url.searchParams.get('keyword')).toBe('张');
    expect(url.searchParams.get('page')).toBe('2');
    expect(url.searchParams.has('empty')).toBe(false);
    expect(url.searchParams.has('nil')).toBe(false);
    expect(url.searchParams.has('undef')).toBe(false);
  });

  it('记录 new URL 的陷阱本身（这条红了说明有人把手写拼接改回去了）', () => {
    // 反例：绝对路径会吃掉 base 的路径段，这正是当初的 bug
    expect(new URL('/persons', 'http://127.0.0.1:3000/api').pathname).toBe('/persons');
    // 正解：手写拼接后 /api 保留
    process.env.MCP_INTERNAL_BASE = 'http://127.0.0.1:3000';
    expect(internalUrl('/persons').pathname.startsWith('/api/')).toBe(true);
  });
});

afterEach(() => {
  delete process.env.MCP_PII_MODE;
});
