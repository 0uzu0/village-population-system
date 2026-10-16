import { ref } from 'vue';

/**
 * 表格列显隐 + 本地持久化。
 *
 * 原先只在人员列表里手写了一份（restoreColumns / isColVisible / toggleColumn /
 * resetColumns，约 60 行），其它列表页想加同样的能力只能复制。
 * 这里抽成通用能力，注意一个关键约定（原实现踩过的坑）：
 * **读取缓存时以「默认列」为准做归并** —— 否则后续版本增删列时，
 * 旧缓存会让新列永远不显示、被删的列残留。
 */
export interface ColumnDef {
  prop: string;
  label: string;
  visible: boolean;
  /** 便于模板里声明 width/min-width 等透传属性 */
  [key: string]: any;
}

export function useColumnVisibility(storageKey: string, defaults: ColumnDef[]) {
  const columns = ref<ColumnDef[]>(restore());

  function restore(): ColumnDef[] {
    const base = defaults.map((c) => ({ ...c }));
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return base;
      const saved: Record<string, boolean> = JSON.parse(raw);
      return base.map((c) => ({
        ...c,
        visible: typeof saved[c.prop] === 'boolean' ? saved[c.prop] : c.visible,
      }));
    } catch {
      return base;
    }
  }

  function persist() {
    try {
      const saved: Record<string, boolean> = {};
      for (const col of columns.value) saved[col.prop] = col.visible;
      localStorage.setItem(storageKey, JSON.stringify(saved));
    } catch {
      /* 隐私模式等写入失败时忽略，不影响当前会话的显隐 */
    }
  }

  function isColVisible(prop: string): boolean {
    return columns.value.find((c) => c.prop === prop)?.visible ?? false;
  }

  function toggleColumn(prop: string) {
    const col = columns.value.find((c) => c.prop === prop);
    if (!col) return;
    col.visible = !col.visible;
    persist();
  }

  /** 恢复默认列显隐（列配置下拉里的「恢复默认」） */
  function resetColumns() {
    columns.value = defaults.map((c) => ({ ...c }));
    persist();
  }

  return { columns, isColVisible, toggleColumn, resetColumns };
}
