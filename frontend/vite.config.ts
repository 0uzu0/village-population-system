import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';
import Components from 'unplugin-vue-components/vite';
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
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
