import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ref } from 'vue';

/**
 * vue-router 打桩：useListUrlSync 内部只用到 useRoute().query 与 useRouter().replace，
 * 用 vi.hoisted 提前建好，避免 vi.mock 工厂被提升后访问未初始化的变量。
 */
const h = vi.hoisted(() => ({
  replace: vi.fn(),
  route: { query: {} as Record<string, any> },
}));

vi.mock('vue-router', () => ({
  useRoute: () => h.route,
  useRouter: () => ({ replace: h.replace }),
}));

const { useListUrlSync } = await import('../src/composables/useListUrlSync');

const TAG_MODES = ['ANY', 'ALL'];

function setup() {
  const activeOnly = ref(true);
  const api = useListUrlSync({
    path: '/persons',
    initial: () => ({
      page: 1,
      pageSize: 20,
      keyword: '',
      gridId: null as number | null,
      tagIds: [] as number[],
      tagMode: 'ANY',
    }),
    fields: [
      { key: 'keyword' },
      { key: 'gridId', type: 'number' },
      { key: 'tagIds', type: 'numberArray' },
      { key: 'tagMode', defaultValue: 'ANY', parse: (raw) => (TAG_MODES.includes(raw) ? raw : undefined) },
    ],
    extras: { activeOnly: { ref: activeOnly, defaultValue: true } },
  });
  return { ...api, activeOnly };
}

beforeEach(() => {
  h.replace.mockClear();
  h.route.query = {};
});

/** 取最近一次 router.replace 写入的 query（不用 Array#at，避免 ES2022 lib 要求） */
function lastQuery(): Record<string, any> {
  const calls = h.replace.mock.calls;
  return calls[calls.length - 1][0].query;
}

describe('useListUrlSync', () => {
  it('初值取自 initial()，query 为响应式对象', () => {
    const { query } = setup();
    expect(query.page).toBe(1);
    expect(query.keyword).toBe('');
    expect(query.tagIds).toEqual([]);
    expect(query.tagMode).toBe('ANY');
  });

  it('syncUrl 只写非默认值，链接保持干净', () => {
    const { query, syncUrl } = setup();
    syncUrl();
    expect(h.replace).toHaveBeenCalledWith({ path: '/persons', query: {} });

    query.keyword = '张三';
    query.gridId = 3;
    query.tagIds = [7, 9];
    query.page = 2;
    syncUrl();
    expect(h.replace).toHaveBeenLastCalledWith({
      path: '/persons',
      query: { keyword: '张三', gridId: '3', tagIds: '7,9', page: '2' },
    });
  });

  it('syncUrl 对等于默认值的枚举字段不写入（tagMode=ANY 不出现在地址栏）', () => {
    const { query, syncUrl } = setup();
    query.tagMode = 'ANY';
    syncUrl();
    expect(lastQuery()).toEqual({});

    query.tagMode = 'ALL';
    syncUrl();
    expect(lastQuery()).toEqual({ tagMode: 'ALL' });
  });

  it('extras 仅在偏离默认值时写入，并转成字符串', () => {
    const { activeOnly, syncUrl } = setup();
    syncUrl();
    expect(lastQuery()).toEqual({});

    activeOnly.value = false;
    syncUrl();
    expect(lastQuery()).toEqual({ activeOnly: 'false' });
  });

  it('restoreQuery 从地址栏还原数字 / 数组 / extras', () => {
    h.route.query = { keyword: '李四', gridId: '5', tagIds: '1,2,3', activeOnly: 'false', page: '3' };
    const { query, restoreQuery, activeOnly } = setup();
    restoreQuery();
    expect(query.keyword).toBe('李四');
    expect(query.gridId).toBe(5);
    expect(query.tagIds).toEqual([1, 2, 3]);
    expect(query.page).toBe(3);
    expect(activeOnly.value).toBe(false);
  });

  it('restoreQuery 忽略空串与非法数字', () => {
    h.route.query = { keyword: '', gridId: 'abc', tagIds: 'x,2' };
    const { query, restoreQuery } = setup();
    restoreQuery();
    expect(query.keyword).toBe('');
    expect(query.gridId).toBeNull();
    // 非法片段被丢弃，合法片段保留
    expect(query.tagIds).toEqual([2]);
  });

  it('parse 钩子挡掉白名单外的枚举值（否则非法值会被原样发给后端）', () => {
    h.route.query = { tagMode: 'EVIL' };
    const { query, restoreQuery } = setup();
    restoreQuery();
    expect(query.tagMode).toBe('ANY');

    h.route.query = { tagMode: 'ALL' };
    restoreQuery();
    expect(query.tagMode).toBe('ALL');
  });

  it('buildParams 把数组转逗号串、空数组删掉、布尔转 "true"/"false"', () => {
    const { query, buildParams, activeOnly } = setup();
    let params = buildParams();
    expect(params.tagIds).toBeUndefined();
    expect(params.activeOnly).toBe('true');
    // 非数组字段原样透传（后端 zod 由 queryEnum / nullableStr 兜底）
    expect(params.tagMode).toBe('ANY');

    query.tagIds = [4, 5];
    activeOnly.value = false;
    params = buildParams();
    expect(params.tagIds).toBe('4,5');
    expect(params.activeOnly).toBe('false');
  });

  it('resetQuery 恢复初值（含 extras 回到默认），且不触发请求', () => {
    const { query, activeOnly, resetQuery } = setup();
    query.keyword = '王五';
    query.gridId = 8;
    query.tagIds = [1];
    query.page = 4;
    activeOnly.value = false;

    resetQuery();
    expect(query.keyword).toBe('');
    expect(query.gridId).toBeNull();
    expect(query.tagIds).toEqual([]);
    expect(query.page).toBe(1);
    expect(activeOnly.value).toBe(true);
    // 不负责发请求：由调用方决定是否 load()
    expect(h.replace).not.toHaveBeenCalled();
  });

  it('resetQuery 不会复用 initial() 里的数组引用（否则后续修改会串味）', () => {
    const { query, resetQuery } = setup();
    resetQuery();
    query.tagIds.push(99);
    resetQuery();
    expect(query.tagIds).toEqual([]);
  });
});
