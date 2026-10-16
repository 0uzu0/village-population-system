/**
 * 身份证号派生信息（与后端 utils/idcard.ts 口径一致）。
 *
 * 出生日期（决定年龄）以身份证号为权威来源：表单里手填的值只在没有身份证时才生效，
 * 这也是后端 person 模块的规则。这里做前端即时回显，让用户在录入身份证的当下
 * 就能看到带出的出生日期/性别，而不是保存后才发现年龄没变。
 */

/**
 * 从身份证提取出生日期（YYYY-MM-DD）。
 * 月日不存在的号码（如 02-30）返回 null，避免用假日期覆盖真实出生日期。
 */
export function birthFromIdCard(id: string): string | null {
  const value = String(id || '').trim();
  let y: string;
  let m: string;
  let d: string;
  if (value.length === 18) {
    y = value.slice(6, 10);
    m = value.slice(10, 12);
    d = value.slice(12, 14);
  } else if (value.length === 15) {
    y = `19${value.slice(6, 8)}`;
    m = value.slice(8, 10);
    d = value.slice(10, 12);
  } else {
    return null;
  }
  const yi = Number(y);
  const mi = Number(m);
  const di = Number(d);
  if (!/^\d{4}$/.test(y) || !/^\d{2}$/.test(m) || !/^\d{2}$/.test(d)) return null;
  if (yi < 1900 || yi > 2100 || mi < 1 || mi > 12 || di < 1) return null;
  const daysInMonth = new Date(Date.UTC(yi, mi, 0)).getUTCDate();
  if (di > daysInMonth) return null;
  return `${y}-${m}-${d}`;
}

/** 从身份证提取性别：MALE / FEMALE */
export function genderFromIdCard(id: string): 'MALE' | 'FEMALE' | null {
  const value = String(id || '').trim();
  if (value.length !== 18 && value.length !== 15) return null;
  if (!/^[0-9]+$/.test(value.slice(0, value.length - 1))) return null;
  const digit = value.length === 18 ? parseInt(value[16], 10) : parseInt(value[14], 10);
  if (Number.isNaN(digit)) return null;
  return digit % 2 === 1 ? 'MALE' : 'FEMALE';
}
