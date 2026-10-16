import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * 前端调用 ↔ 后端路由 的静态一致性校验。
 *
 * 为什么要这个测试：前端 `api/index.ts` 里的接口路径是写死的字符串，
 * 后端少了一条路由既不会编译报错，也不会被任何单测发现——只有真点进那个页面
 * 才会 404（"接口不存在: GET /api/xxx"）。后端把巨石模块拆成多个文件的机械搬迁
 * 尤其容易踩：路由一条条挪，漏掉几条从 diff 上完全看不出来。
 *
 * 这里不启服务、不连数据库，纯静态比对：
 *   app.ts 的 `app.use('/api/<前缀>', <模块>)` 建立「前缀 → 模块文件」的映射，
 *   再从模块文件里收集 `router.get/post/put/delete` 声明的路由，与前端调用逐条对齐。
 *
 * 它只保证「路径 + 方法」存在，不保证权限码 / 参数 / 响应形状——那些靠联调与其它测试。
 */

const BACKEND = path.resolve(__dirname, '..');
const REPO = path.resolve(BACKEND, '..');
const APP_TS = path.join(BACKEND, 'src/app.ts');
const FRONTEND_SRC = path.join(REPO, 'frontend/src');
const API_INDEX = path.join(FRONTEND_SRC, 'api/index.ts');

/** 前端 `get/post/put/del` 帮助函数与 axios 方法名 → HTTP 方法 */
const METHOD_OF: Record<string, string> = {
  get: 'GET',
  post: 'POST',
  put: 'PUT',
  del: 'DELETE',
  delete: 'DELETE',
};

interface Route {
  method: string;
  path: string;
  file: string;
}

interface Call {
  method: string;
  path: string;
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
 * 统一成「/段/段」形式：去掉首尾斜杠与空段。
 * 这样 `/grids`、`grids/`、`/grids/` 都是同一个键，`/` 也仍然是 `/`。
 */
function canonical(p: string): string {
  return `/${p.split('/').filter(Boolean).join('/')}`;
}

/** 把模板字符串里的 `${...}` 换成一个普通路径段，便于与后端 `:param` 对齐 */
function normalizeTemplate(p: string): string {
  return canonical(p.replace(/\$\{[^}]*\}/g, '1'));
}

/** 后端路由路径 → 匹配具体请求路径的正则（:param 匹配任意单个路径段） */
function routeRegex(routePath: string): RegExp {
  const pattern = canonical(routePath)
    .split('/')
    .map((seg) => (seg.startsWith(':') ? '[^/]+' : seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    .join('/');
  return new RegExp(`^${pattern}$`);
}

/** app.ts 里 `app.use('/api/<前缀>', <模块变量>)` → 前缀到模块文件/目录的映射 */
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

/** 模块（单文件，或拆分后的目录）里声明的全部路由 */
function routesOf(target: string): Route[] {
  const single = `${target}.ts`;
  const files = fs.existsSync(single) ? [single] : walk(target, ['.ts']);
  const routes: Route[] = [];
  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8');
    for (const m of src.matchAll(/\brouter\w*\.(get|post|put|delete|patch)\(\s*['"]([^'"]+)['"]/gi)) {
      routes.push({ method: m[1].toUpperCase(), path: m[2], file: path.relative(REPO, file) });
    }
  }
  return routes;
}

function lineOf(src: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) if (src[i] === '\n') line++;
  return line;
}

/**
 * 收集前端发出的请求。
 *
 * api/index.ts 是唯一的接口清单，里面的 `get(...)` / `request.get(...)` 都算；
 * 其余源码只认显式的 `request.xxx('/path')`——若在那里也认裸 `get(`，
 * 会把 Map.get / 各种同名工具函数一起抓进来。
 */
function frontendCalls(): Call[] {
  const calls: Call[] = [];

  const collect = (file: string, re: RegExp) => {
    const src = fs.readFileSync(file, 'utf8');
    const rel = path.relative(REPO, file);
    for (const m of src.matchAll(re)) {
      const [, fn, , rawPath] = m;
      calls.push({
        method: METHOD_OF[fn.toLowerCase()],
        path: normalizeTemplate(rawPath),
        where: `${rel}:${lineOf(src, m.index)}`,
      });
    }
  };

  collect(API_INDEX, /\b(?:request\.)?(get|post|put|del|delete)(?:<[^>]*>)?\(\s*([`'"])(\/[^`'"]*)\2/g);

  for (const file of walk(FRONTEND_SRC, ['.ts', '.vue'])) {
    if (file === API_INDEX) continue;
    collect(file, /\brequest\.(get|post|put|delete)\(\s*([`'"])(\/[^`'"]*)\2/g);
  }

  return calls;
}

/** 按第一段路径找挂载的模块，返回 { 前缀, 模块内剩余路径 } */
function splitMount(p: string): { prefix: string; rest: string } {
  const segs = p.split('/').filter(Boolean);
  const [prefix, ...rest] = segs;
  return { prefix, rest: `/${rest.join('/')}` };
}

describe('前端接口调用与后端路由一致性', () => {
  const mounts = moduleMounts();
  const calls = frontendCalls();

  it('解析出全部模块与足量接口（防止解析器失效导致空断言静默通过）', () => {
    expect(mounts.size).toBeGreaterThanOrEqual(10);

    let routeCount = 0;
    for (const target of mounts.values()) routeCount += routesOf(target).length;
    expect(routeCount).toBeGreaterThanOrEqual(60);

    expect(calls.length).toBeGreaterThanOrEqual(50);
  });

  it('前端引用的每个接口，后端都有对应的「方法 + 路径」路由', () => {
    const missing: string[] = [];

    for (const call of calls) {
      const { prefix, rest } = splitMount(call.path);
      const target = mounts.get(prefix);
      if (!target) {
        missing.push(`${call.method} /api${call.path} —— 后端没有挂载 /api/${prefix}（${call.where}）`);
        continue;
      }
      const hit = routesOf(target).some((r) => r.method === call.method && routeRegex(r.path).test(rest));
      if (!hit) {
        const declared = routesOf(target)
          .filter((r) => r.method === call.method)
          .map((r) => `      ${r.method} ${canonical(r.path)}   ← ${r.file}`)
          .join('\n');
        missing.push(
          `${call.method} /api${call.path}（${call.where}）\n    该模块已声明的同方法路由：\n${declared || '      （无）'}`
        );
      }
    }

    expect(missing, `前端调用了后端不存在的接口：\n${missing.join('\n')}`).toEqual([]);
  });
});
