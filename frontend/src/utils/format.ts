/**
 * 展示层格式化函数——**唯一来源**。
 *
 * 为什么单独抽出来：性别文案此前在 5 个页面里各写一遍
 *（person 列表/详情、重点人群、工作台图表、家庭），金额格式化在台账与台账统计里
 * 各写一遍。改一处口径（比如「未知」要显示成「未登记」）就得全项目搜一遍，
 * 漏掉一个页面就出现同一份数据两种写法。
 */

/** 性别。未知不写成空串：详情页留白会让人以为加载失败 */
export function genderLabel(gender?: string | null): string {
  if (gender === 'MALE') return '男';
  if (gender === 'FEMALE') return '女';
  return '未知';
}

/** 时间戳 → 本地日期时间。空值统一用破折号，避免表格里出现 "Invalid Date" */
export function formatTime(value?: string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('zh-CN', { hour12: false });
}

/** 金额 → ¥1,234.00。台账的劳务费与发票费都是两位小数，统一在这里定 */
export function formatMoney(value?: number | null): string {
  return `¥${Number(value || 0).toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * 「与户主关系」的受控枚举——**前端唯一来源**。
 *
 * 必须与后端 `backend/src/utils/relation.ts` 的 RELATION_CODES 一致：
 * 后端负责把「妻 / 长女 / 儿媳」这类自然语言（Excel 导入的原始写法）归一成这些码，
 * 前端只认码、按这张表转中文。此前 3 个页面各自维护一份 5 项映射，
 * 后端新增「孙辈 / 儿媳女婿 / 兄弟姐妹」后前端会直接显示英文码。
 */
export const RELATION_OPTIONS = [
  { value: 'HEAD', label: '户主' },
  { value: 'SPOUSE', label: '配偶' },
  { value: 'CHILD', label: '子女' },
  { value: 'CHILD_IN_LAW', label: '儿媳女婿' },
  { value: 'GRANDCHILD', label: '孙辈' },
  { value: 'PARENT', label: '父母' },
  { value: 'SIBLING', label: '兄弟姐妹' },
  { value: 'OTHER', label: '其他' },
] as const;

/**
 * 与户主关系 → 中文。未知码原样返回（便于发现后端加了码前端没跟上），
 * 空值给破折号，不留空白。
 */
export function relationLabel(code?: string | null): string {
  if (!code) return '—';
  return RELATION_OPTIONS.find((o) => o.value === code)?.label ?? code;
}

/**
 * HTML 转义——只用于 ElMessageBox 的 `dangerouslyUseHTMLString` 提示。
 *
 * 姓名、地址都是村里录进来的自由文本，拼进 HTML 不做转义等于给录入员
 * 留了一个改页面的口子。纯文本提示（不加 HTML）不需要它。
 */
export function escapeHtml(v: unknown): string {
  const map: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return String(v ?? '').replace(/[&<>"']/g, (c) => map[c] as string);
}
