/**
 * 图标清单自检：核对「源码中引用的图标」与「icons.ts 中注册的图标」是否一致。
 *
 * 侧边菜单与统计卡片用字符串动态渲染（<component :is="'Grid'">），
 * 漏注册不会报错、只会渲染成空白，因此用脚本兜底。
 * 用法：node scripts/check-icons.cjs
 */
const fs = require('fs');
const path = require('path');

const SRC = path.resolve(__dirname, '../src');
const icons = require('@element-plus/icons-vue');
const allNames = Object.keys(icons);

const src = fs.readFileSync(path.join(SRC, 'icons.ts'), 'utf8');
const block = src.match(/export const ICONS = \{([\s\S]*?)\} as const/);
if (!block) {
  console.error('未能在 icons.ts 中定位 ICONS 定义');
  process.exit(1);
}
const registered = block[1]
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(vue|ts)$/.test(e.name)) out.push(p);
  }
  return out;
}

const used = new Set();
for (const f of walk(SRC)) {
  if (f.endsWith('icons.ts')) continue;
  const text = fs.readFileSync(f, 'utf8');
  for (const n of allNames) {
    const asTag = new RegExp('<' + n + '(\\s|/|>)');
    const asString = new RegExp("'" + n + "'");
    if (asTag.test(text) || asString.test(text)) used.add(n);
  }
}

const missing = [...used].filter((n) => !registered.includes(n)).sort();
const redundant = registered.filter((n) => !used.has(n)).sort();

console.log(`图标库总数: ${allNames.length}`);
console.log(`已注册: ${registered.length}`);
console.log(`源码引用: ${used.size}`);
console.log(`引用但未注册（会渲染空白）: ${missing.length ? missing.join(', ') : '无'}`);
console.log(`注册但未引用（可删）: ${redundant.length ? redundant.join(', ') : '无'}`);

process.exit(missing.length ? 1 : 0);
