import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Element Plus 按需引入的守卫测试。
 *
 * 这一组断言针对的都是「改错了不会报错、只在运行时或体积上出问题」的场景：
 *  - 漏配某个 el-* 组件 → Vue 把它当未知标签渲染成空元素，页面看着就是「控件没了」；
 *  - 有人又把 `app.use(ElementPlus)` 加回来 → 产物里重新出现 950KB 的 element chunk；
 *  - `vite.config.ts` 旁边多出个 `vite.config.js`（tsc 产物）→ Vite 优先读 .js，
 *    配置改了却不生效（本项目真实踩过：改了半天断言，构建产物一字未变）。
 */
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRC = path.join(ROOT, 'src');

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), 'utf-8');
}

/**
 * 去掉注释后再做「不含某段代码」的断言。
 * 否则注释里为了解释「为什么不能这么写」而引用那段代码，会把断言自己坑掉。
 */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

/** 模板里实际写到的 el-* 标签 → 对应的 PascalCase 组件名 */
function usedElementComponents(): Map<string, string> {
  const used = new Map<string, string>();
  for (const file of walk(SRC).filter((f) => f.endsWith('.vue'))) {
    const text = fs.readFileSync(file, 'utf-8');
    for (const m of text.matchAll(/<(el-[a-z0-9-]+)(?=[\s/>])/g)) {
      const tag = m[1];
      const pascal = tag
        .split('-')
        .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
        .join('');
      used.set(tag, pascal);
    }
  }
  return used;
}

/** components.d.ts 里由 ElementPlusResolver 登记好的组件名 */
function registeredElementComponents(): Set<string> {
  const dts = read('src/components.d.ts');
  const names = new Set<string>();
  for (const m of dts.matchAll(/^\s+(El\w+): typeof import\('element-plus/gm)) {
    names.add(m[1]);
  }
  return names;
}

describe('Element Plus 按需引入', () => {
  it('模板里用到的每个 el-* 组件都已被解析并登记（漏配会渲染成空标签）', () => {
    const used = usedElementComponents();
    const registered = registeredElementComponents();
    expect(used.size).toBeGreaterThan(30);

    const missing = [...used.entries()]
      .filter(([, pascal]) => !registered.has(pascal))
      .map(([tag, pascal]) => `<${tag}> → ${pascal}`);

    expect(missing, `以下组件未出现在 src/components.d.ts，请检查 vite.config.ts 的 ElementPlusResolver`).toEqual([]);
  });

  it('v-loading 指令已登记（指令不解析时整表不会有加载态）', () => {
    const dts = read('src/components.d.ts');
    expect(dts).toContain('vLoading');
    expect(dts).toContain('ElLoadingDirective');
  });

  it('main.ts 不再全量注册 Element Plus，但仍全量引入样式', () => {
    const main = stripComments(read('src/main.ts'));
    // 全量注册 = 整个组件库进产物，且无法 tree-shaking
    expect(main).not.toMatch(/app\.use\(\s*ElementPlus\s*\)/);
    expect(main).not.toMatch(/import\s+ElementPlus\s+from\s+'element-plus'/);
    // 样式仍走全量 CSS：组件级按需只管 JS，样式漏一个就是肉眼可见的错版
    expect(main).toContain("import 'element-plus/dist/index.css'");
  });

  it('vite.config.ts 的按需配置与全量 CSS 策略保持一致', () => {
    const cfg = stripComments(read('vite.config.ts'));
    expect(cfg).toContain('ElementPlusResolver');
    // 既然样式是全量引入的，插件就不该再逐个注入样式，否则同一个组件样式被两处引用
    expect(cfg).toMatch(/ElementPlusResolver\(\{[^}]*importStyle:\s*false/);
    // manualChunks 里出现 element-plus 会把桶文件变成入口，tree-shaking 立刻失效
    expect(cfg).not.toMatch(/manualChunks[\s\S]{0,200}element-plus/);
  });

  it('项目根目录不应存在 vite.config.js（会遮蔽 vite.config.ts，导致配置改了不生效）', () => {
    const shadow = ['vite.config.js', 'vite.config.mjs', 'vite.config.cjs'].filter((f) =>
      fs.existsSync(path.join(ROOT, f))
    );
    expect(
      shadow,
      'Vite 的配置查找顺序里 .js 优先于 .ts：一旦 tsc 在 vite.config.ts 旁边产出 vite.config.js，' +
        '后续对 vite.config.ts 的任何修改都不会生效。已通过 tsconfig.node.json 的 outDir 规避，' +
        '若本地又出现了该文件，直接删掉即可'
    ).toEqual([]);
  });
});
