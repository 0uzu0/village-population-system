import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * MCP 工具 ↔ 后端路由 的静态一致性校验。
 *
 * 为什么单独有这一条：MCP 工具不直接查库，而是用调用者 token 回请求自己的 REST
 * （`ctx.call('/persons')`）。于是工具里写的是一个**没有类型约束的字符串路径**，
 * 后端改路径、或工具手滑写错，编译不报错、单测全绿（单测在 ctx.call 那层就 mock 掉了），
 * 只有真打一次 tools/call 才会暴露。
 *
 * 这个坑真实发生过两次：
 *   1. 所有工具统一 404 —— 内部转发漏了 `/api` 前缀（见 `MCP 内部转发地址` 那组测试）；
 *   2. 单个工具 404 —— 路径与后端声明不一致。
 * 第 2 类就靠这里拦住：把工具里出现的每个路径，与 `app.use('/api/<前缀>', 模块)` +
 * 模块内 `router.get/post/...` 的真实路由表逐条比对。
 *
 * 只校验「路径 + 方法」存在，不校验权限码与响应形状。
 */

const BACKEND = path.resolve(__dirname, '..');
const REPO = path.resolve(BACKEND, '..');
const APP_TS = path.join(BACKEND, 'src/app.ts');
const TOOLS_DIR = path.join(BACKEND, 'src/modules/mcp/tools');

interface Route {
  method: string;
  segments: string[];
  file: string;
}

interface Call {
  method: string;
  raw: string;
  segments: string[];
  where: string;
}

function walk(dir: string, exts: string[], out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, exts, out);
    else if (exts.some((e) => entry.name.endsWith(e))) out.push(full);
  }
  return out;
}

/**
 * 拆成路径段，并统一「参数段」表示。
 * `:id`（后端声明）与 `${args.id}`（工具里的模板串）都算通配，便于两端对齐。
 */
function segments(p: string): string[] {
  return p
    .split('/')
    .filter(Boolean)
    .map((seg) => (seg.startsWith(':') || seg.includes('${') ? '*' : seg));
}

/** app.ts 的 `app.use('/api/<前缀>', <模块>)` → 前缀到模块路径 */
function moduleMounts(): Map<string, string> {
  const src = fs.readFileSync(APP_TS, 'utf8');
  const imported = new Map<string, string>();
  for (const m of src.matchAll(/import\s+(\w+)\s+from\s+'(\.\/modules\/[^']+)'/g)) {
    imported.set(m[1], path.join(BACKEND, 'src', m[2]));
  }

  const mounts = new Map<string, string>();
  for (const m of src.matchAll(/app\.use\(\s*'\/api\/([^']+)'\s*,\s*(\w+)\s*\)/g)) {
    const target = imported.get(m[2]);
    if (!target) throw new Error(`app.ts 挂载了未 import 的模块：${m[2]}`);
    mounts.set(m[1], target);
  }
  return mounts;
}

/** 递归收集模块路由，认 `router.use('/前缀', 子router)` 这种子挂载 */
function collectRoutes(target: string, prefix: string, seen: Set<string>): Route[] {
  const single = `${target}.ts`;
  const files = fs.existsSync(single) ? [single] : walk(target, ['.ts']);
  const routes: Route[] = [];

  for (const file of files) {
    if (seen.has(file)) continue;
    const src = fs.readFileSync(file, 'utf8');

    const local = new Map<string, string>();
    for (const m of src.matchAll(/import\s+(\w+)\s+from\s+'(\.[^']+)'/g)) {
      local.set(m[1], path.resolve(path.dirname(file), m[2]));
    }

    for (const m of src.matchAll(/\brouter\w*\.(get|post|put|delete|patch)\(\s*['"]([^'"]+)['"]/gi)) {
      routes.push({
        method: m[1].toUpperCase(),
        segments: segments(`${prefix}/${m[2]}`),
        file: path.relative(REPO, file),
      });
    }

    for (const m of src.matchAll(/\brouter\w*\.use\(\s*['"]([^'"]+)['"]\s*,\s*(\w+)\s*\)/g)) {
      const sub = local.get(m[2]);
      if (!sub || seen.has(sub)) continue;
      seen.add(sub);
      routes.push(...collectRoutes(sub, `${prefix}/${m[1]}`, seen));
    }
  }
  return routes;
}

function allRoutes(): Route[] {
  const routes: Route[] = [];
  for (const [prefix, target] of moduleMounts()) {
    routes.push(...collectRoutes(target, prefix, new Set()));
  }
  return routes;
}

/**
 * 工具里的内部调用。
 * `ctx.call('/persons', args)` 是 GET；`ctx.send('PUT', '/persons/1', body)` 显式带方法。
 * 模板字符串里的 `${...}` 会被保留成通配段。
 */
function toolCalls(): Call[] {
  const calls: Call[] = [];
  for (const file of walk(TOOLS_DIR, ['.ts'])) {
    const src = fs.readFileSync(file, 'utf8');
    const where = path.relative(REPO, file);

    for (const m of src.matchAll(/ctx\.call\(\s*([`'"])([\s\S]*?)\1/g)) {
      calls.push({ method: 'GET', raw: m[2], segments: segments(m[2]), where });
    }
    for (const m of src.matchAll(/ctx\.send\(\s*'(\w+)'\s*,\s*([`'"])([\s\S]*?)\2/g)) {
      calls.push({ method: m[1].toUpperCase(), raw: m[3], segments: segments(m[3]), where });
    }
  }
  return calls;
}

/** id 的形状：纯数字或 UUID。用来判断「这段到底是字面量还是被 :param 兜住了」 */
const ID_LIKE = /^(\d+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

/**
 * 路由匹配。分两轮，先严格后宽松：
 *
 * 1. **完全一致**：任何一段都不许靠 `:param` 兜住，最可信。
 * 2. **允许通配**：但只有在「通配位置上的字面量本身像 id」时才认。
 *
 * 第 2 轮的限制是必须的：后端有 `GET /grids/:id`，它能把 `/grids/village-list`
 * 这种写错的路径照单全收，于是测试会误判为「存在」。早先就吃过这个亏——
 * 故意把 `/grids/villages` 改成 `/grids/village-list`，测试依然是绿的。
 * 反过来，工具里 `${args.id}` 这种模板段在 call.segments 里已经是 `*`，不受此限。
 */
function matches(route: Route, call: Call): boolean {
  if (route.method !== call.method) return false;
  if (route.segments.length !== call.segments.length) return false;

  const exact = route.segments.every((seg, i) => seg !== '*' && seg === call.segments[i]);
  if (exact) return true;

  return route.segments.every((seg, i) => {
    const mine = call.segments[i];
    if (mine === '*') return true; // 工具侧是模板，天然合法
    if (seg === '*') return ID_LIKE.test(mine); // 后端侧是参数，要求字面量像 id
    return seg === mine;
  });
}

describe('MCP 工具调用的后端路径必须真实存在', () => {
  it('至少扫到了一批调用（防止正则失效后静默全绿）', () => {
    expect(toolCalls().length).toBeGreaterThan(40);
  });

  it('每个 ctx.call / ctx.send 的路径都能在后端路由表里找到', () => {
    const routes = allRoutes();
    const missing = toolCalls()
      .filter((c) => !routes.some((r) => matches(r, c)))
      .map((c) => `${c.method} /api${c.raw}  ← ${c.where}`);

    expect(missing, `以下工具调用的接口在后端不存在：\n${missing.join('\n')}`).toEqual([]);
  });
});
