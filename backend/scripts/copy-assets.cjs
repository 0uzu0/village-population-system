/* 构建后复制非 TS 资源（迁移 SQL）到 dist */
const fs = require('fs');
const path = require('path');

const src = path.resolve(__dirname, '../src/db/migrations');
const dst = path.resolve(__dirname, '../dist/db/migrations');

fs.mkdirSync(dst, { recursive: true });
for (const f of fs.readdirSync(src)) {
  fs.copyFileSync(path.join(src, f), path.join(dst, f));
}
console.log('[copy-assets] 迁移脚本已复制到 dist/db/migrations');
