import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';
import Components from 'unplugin-vue-components/vite';
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers';
import { fileURLToPath, URL } from 'node:url';
import { readFileSync } from 'node:fs';

/**
 * 构建标识，注入到 `__APP_BUILD__`，显示在侧边栏底部。
 *
 * 为什么要有这个：前端是「index.html + 哈希文件名资源」的静态包，
 * 部署更新后如果看到的还是旧功能，最先要回答的问题就是
 * **「我现在跑的到底是哪一版」**——是镜像没更新、还是浏览器/代理缓存了旧包。
 * 版本号 + 构建时间摆在那里，一眼就能对上或对不上。
 *
 * 强制用 Asia/Shanghai 格式化：镜像构建在 UTC 的容器里跑，
 * 直接用本地时间会出现「构建于今天早上 7 点」这种跟人对不上的时间。
 */
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8')) as { version: string };
const buildLabel = `v${pkg.version} · ${new Date()
  .toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' })
  .slice(0, 16)}`;

export default defineConfig({
  define: {
    __APP_BUILD__: JSON.stringify(buildLabel),
  },
  plugins: [
    vue(),
    /**
     * Element Plus 按需引入。
     *
     * 之前 `app.use(ElementPlus)`（main.ts）会把整个组件库注册进去，
     * 产物里固定出现一个 950KB、完全无法 tree-shaking 的 element chunk，
     * 而且因为它是入口的静态依赖，首屏就被 preload。
     *
     * 现在改成模板里出现哪个 el-* 就自动 import 哪个。两个关键细节：
     *
     *  - `importStyle: false`：样式仍由 main.ts 里的 `element-plus/dist/index.css`
     *    一次性引入。全量 CSS 只有 ~50KB(gzip)，换来的是「不可能漏某个组件的样式」
     *    这类只在运行时才暴露的问题；JS 才是大头。
     *  - `directives: true`（默认）：`v-loading` 依赖它解析成 ElLoadingDirective，
     *    只配组件解析是不够的。
     */
    Components({
      resolvers: [ElementPlusResolver({ importStyle: false })],
      dts: 'src/components.d.ts',
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
    },
  },
  build: {
    // 目前最大的 chunk 是 echarts（~520KB，仅工作台/台账统计按需加载）。
    // 阈值定在 600KB：再出现「整个库被静态打进产物」这类回归能立刻在构建日志里看到
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['vue', 'vue-router', 'pinia', 'axios'],
          // 刻意不列 element-plus：manualChunks 的对象写法会把列出的模块当成 chunk 入口，
          // 桶文件一旦成为入口，按需引入与 tree-shaking 就全部失效。
          // 交给 rollup 自动分包，未用到的组件才会被摇掉。
        },
      },
    },
  },
  test: {
    // 只测纯逻辑（composables / utils），因此不引 jsdom：
    // 用例里用到 localStorage 时手动打桩，启动更快、依赖更少
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // 串行跑文件：用例总共不到 20 个、耗时不足 1s，并行没有收益，
    // 反而会让多个 worker 抢同一个临时缓存目录（Vitest 把转译结果写进
    // os.tmpdir()/<projectId>/ssr），偶发 EPERM 让整轮测试以非 0 退出
    fileParallelism: false,
  },
});
