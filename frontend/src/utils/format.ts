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
