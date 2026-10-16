/// <reference types="vite/client" />

/**
 * 构建标识，由 vite.config.ts 的 define 注入（形如 `v1.0.0 · 2026-10-16 15:01`）。
 * 显示在侧边栏底部：更新后先看这里对不对得上，用来区分「镜像没更新 / 缓存了旧包」
 * 和「功能真的没开发」。
 */
declare const __APP_BUILD__: string;

declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent<object, object, any>;
  export default component;
}
