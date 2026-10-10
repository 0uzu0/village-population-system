import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    globals: true,
    // 沙箱环境下避免线程池临时目录写入受限，使用单进程 + 本地缓存
    pool: 'forks',
    poolOptions: {
      forks: { singleFork: true },
    },
    cache: {
      dir: '.vitest-cache',
    },
  },
});
