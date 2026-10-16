/**
 * Express 4 异步错误兜底。
 *
 * 背景：Express 4 不会捕获 async 路由的 Promise 拒绝（Express 5 才原生支持），
 * 任何路由里未 try/catch 的异常（SQL 报错、Zod 校验失败等）都会成为
 * unhandledRejection，在 Node 22 下直接打崩整个进程（容器反复重启）。
 *
 * 做法：包装路由层 Layer 的 handle——若返回 Promise 则把拒绝转交 next(err)，
 * 由统一 errorHandler 返回 400/500。四参错误处理中间件保持原样不包装。
 * 用法：在创建 app 之前 import 一次本文件即可（app.ts 顶部已引入）。
 */
/*
 * 这里必须用 require：Express 未导出 Layer，只能按其内部路径加载；
 * 且 this 是运行时才明确的 Layer 实例，只能 any。
 */
/* eslint-disable @typescript-eslint/no-require-imports */
const Layer = require('express/lib/router/layer');

function wrapAsyncHandle(fn: any): any {
  const wrapped = function (this: any, req: any, res: any, next: any) {
    try {
      const ret = fn.apply(this, [req, res, next]);
      if (ret && typeof ret.catch === 'function') ret.catch(next);
    } catch (err) {
      next(err);
    }
  };
  // 保留原函数的 length（Express 依据参数个数判断是否为错误中间件）
  // 与原型（router 函数上挂载的属性），避免影响路由行为
  Object.setPrototypeOf(wrapped, fn);
  Object.defineProperty(wrapped, 'length', { value: fn.length, configurable: true });
  return wrapped;
}

if (!(Layer.prototype as any).__vpAsyncShimApplied) {
  (Layer.prototype as any).__vpAsyncShimApplied = true;
  Object.defineProperty(Layer.prototype, 'handle', {
    enumerable: true,
    configurable: true,
    get(this: any) {
      return this.__handle;
    },
    set(this: any, fn: any) {
      this.__handle =
        typeof fn === 'function' && fn.length !== 4 ? wrapAsyncHandle(fn) : fn;
    },
  });
}

export {};
