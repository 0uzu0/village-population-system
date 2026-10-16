import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * 待核查人员·批量操作。
 *
 * 批量忽略原先由前端逐条调 /pending/:id/ignore 实现——选 50 条就打 50 个请求，
 * 中途失败还会留下「一半忽略、一半没忽略」的中间状态。改为后端一次 UPDATE 后，
 * 这里守住三件事：接口存在、前端走批量接口、别再退回逐条循环。
 */
const backend = fileURLToPath(new URL('..', import.meta.url));
const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

const read = (p: string) => fs.readFileSync(p, 'utf-8');

describe('待核查·批量忽略', () => {
  const moduleSrc = read(`${backend}/src/modules/pending.ts`);

  it('后端提供 POST /batch-ignore', () => {
    expect(moduleSrc).toMatch(/router\.post\(\s*'\/batch-ignore'/);
  });

  it('批量忽略会在一次 UPDATE 里处理整批，而不是按 id 逐条更新', () => {
    // 截取 batch-ignore 处理函数本体（到下一个 router. 注册为止）
    const start = moduleSrc.indexOf("router.post('/batch-ignore'");
    expect(start, '未找到 /batch-ignore 路由').toBeGreaterThan(-1);
    const nextRoute = moduleSrc.indexOf('router.', start + 10);
    const handler = moduleSrc.slice(start, nextRoute === -1 ? undefined : nextRoute);

    // 用 WHERE id IN (...) 一次更新
    expect(handler).toMatch(/UPDATE import_pending SET status = 'IGNORED'/);
    expect(handler).toMatch(/WHERE id IN \(/);
    // 单条更新（/:id/ignore 那条路由）是另一回事，不应出现在批量处理里
    expect(handler).not.toMatch(/WHERE id = \?/);
  });

  it('已入库（RESOLVED）的记录会被跳过，而不是让整批操作失败', () => {
    expect(moduleSrc).toContain('NOTHING_TO_IGNORE');
    expect(moduleSrc).toMatch(/r\.status !== 'RESOLVED'/);
  });

  it('批量删除与批量忽略都写审计日志', () => {
    expect(moduleSrc).toContain("action: 'pending:batch_delete'");
    expect(moduleSrc).toContain("action: 'pending:batch_ignore'");
  });

  it('前端 API 暴露 batchIgnore，且视图不再逐条循环调用 ignore', () => {
    const api = read(`${repoRoot}/frontend/src/api/index.ts`);
    expect(api).toMatch(/batchIgnore:\s*\(ids: number\[\]\)/);

    const view = read(`${repoRoot}/frontend/src/views/pending/index.vue`);
    expect(view).toContain('pendingApi.batchIgnore');
    // 逐条循环会重新引入 N 个请求
    expect(view).not.toMatch(/for \(const r of selected\.value\) await pendingApi\.ignore/);
  });
});
