import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useColumnVisibility, type ColumnDef } from '../src/composables/useColumnVisibility';

const STORAGE_KEY = 'person:columns';

const DEFAULTS: ColumnDef[] = [
  { prop: 'name', label: '姓名', visible: true },
  { prop: 'age', label: '年龄', visible: true },
  { prop: 'phone', label: '联系电话', visible: true },
];

/** 内存版 localStorage：用例跑在 node 环境，不引 jsdom */
const store = new Map<string, string>();

beforeEach(() => {
  store.clear();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  });
});

describe('useColumnVisibility', () => {
  it('无缓存时使用默认列显隐', () => {
    const { columns, isColVisible } = useColumnVisibility(STORAGE_KEY, DEFAULTS);
    expect(columns.value.map((c) => c.prop)).toEqual(['name', 'age', 'phone']);
    expect(isColVisible('name')).toBe(true);
  });

  it('isColVisible 对不存在的列返回 false（模板里 v-if 不会误显示）', () => {
    const { isColVisible } = useColumnVisibility(STORAGE_KEY, DEFAULTS);
    expect(isColVisible('not_a_column')).toBe(false);
  });

  it('toggleColumn 切换显隐并落盘，下一次创建时读回', () => {
    const first = useColumnVisibility(STORAGE_KEY, DEFAULTS);
    first.toggleColumn('age');
    expect(first.isColVisible('age')).toBe(false);
    expect(JSON.parse(store.get(STORAGE_KEY)!)).toMatchObject({ age: false });

    const second = useColumnVisibility(STORAGE_KEY, DEFAULTS);
    expect(second.isColVisible('age')).toBe(false);
    expect(second.isColVisible('name')).toBe(true);
  });

  it('toggleColumn 对不存在的列不做任何事（不会凭空造列）', () => {
    const { columns, toggleColumn } = useColumnVisibility(STORAGE_KEY, DEFAULTS);
    toggleColumn('ghost');
    expect(columns.value).toHaveLength(DEFAULTS.length);
    expect(store.get(STORAGE_KEY)).toBeUndefined();
  });

  it('读取缓存时以默认列为准归并：新增列按默认值显示，已删列不复活', () => {
    // 模拟旧版本缓存：只有 name/age，且 age 被隐藏
    store.set(STORAGE_KEY, JSON.stringify({ name: true, age: false, removed_col: true }));

    const extended: ColumnDef[] = [...DEFAULTS, { prop: 'village', label: '村庄', visible: true }];
    const { columns, isColVisible } = useColumnVisibility(STORAGE_KEY, extended);

    // 新列按默认值显示，不会被旧缓存判成隐藏
    expect(isColVisible('village')).toBe(true);
    // 缓存里的隐藏状态仍生效
    expect(isColVisible('age')).toBe(false);
    // 缓存中已不存在的列不会复活
    expect(columns.value.some((c) => c.prop === 'removed_col')).toBe(false);
  });

  it('缓存内容损坏（非法 JSON）时回退到默认列而不是抛错', () => {
    store.set(STORAGE_KEY, '{ 这不是 JSON');
    const { columns } = useColumnVisibility(STORAGE_KEY, DEFAULTS);
    expect(columns.value.every((c) => c.visible)).toBe(true);
  });

  it('resetColumns 恢复默认显隐并落盘', () => {
    const { toggleColumn, isColVisible, resetColumns } = useColumnVisibility(STORAGE_KEY, DEFAULTS);
    toggleColumn('name');
    toggleColumn('phone');
    expect(isColVisible('name')).toBe(false);

    resetColumns();
    expect(isColVisible('name')).toBe(true);
    expect(isColVisible('phone')).toBe(true);
    expect(JSON.parse(store.get(STORAGE_KEY)!)).toEqual({ name: true, age: true, phone: true });
  });

  it('不会改到传入的默认列数组（否则第二次调用会被上次的显隐污染）', () => {
    const { toggleColumn } = useColumnVisibility(STORAGE_KEY, DEFAULTS);
    toggleColumn('name');
    expect(DEFAULTS.find((c) => c.prop === 'name')!.visible).toBe(true);
  });
});
