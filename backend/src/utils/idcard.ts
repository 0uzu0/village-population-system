/**
 * 中国居民身份证号码校验（GB 11643-1999）
 * - 18 位：前 17 位数字 + 校验码（0-9 或 X）
 * - 15 位旧版：作为格式校验通过（提示可升级），不做加权校验
 */

const WEIGHTS = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
const CHECK_CODES = ['1', '0', 'X', '9', '8', '7', '6', '5', '4', '3', '2'];

export interface IdCardResult {
  valid: boolean;
  message?: string;
  /** 归一化后的 18 位号码（15 位升位，简化处理） */
  normalized?: string;
}

export function validateIdCard(id: string): IdCardResult {
  const value = (id || '').trim().toUpperCase();
  if (value.length === 15) {
    if (!/^\d{15}$/.test(value)) {
      return { valid: false, message: '15位身份证必须为数字' };
    }
    // 简化升位：补充年份世纪位与校验码省略，仍视为格式合法
    const normalized = value.slice(0, 6) + '19' + value.slice(6);
    return { valid: true, normalized: normalizeChecksum(normalized) };
  }
  if (value.length !== 18) {
    return { valid: false, message: '身份证号码必须为18位（或15位旧版）' };
  }
  if (!/^\d{17}[\dX]$/.test(value)) {
    return { valid: false, message: '身份证号码格式不正确' };
  }
  const sum = WEIGHTS.reduce((acc, w, i) => acc + w * parseInt(value[i], 10), 0);
  const check = CHECK_CODES[sum % 11];
  if (check !== value[17]) {
    return { valid: false, message: '身份证号码校验位错误' };
  }
  return { valid: true, normalized: value };
}

/** 补全 17 位号码的校验位（用于 15 位升位） */
function normalizeChecksum(prefix17: string): string {
  if (prefix17.length !== 17) return prefix17;
  const sum = WEIGHTS.reduce((acc, w, i) => acc + w * parseInt(prefix17[i], 10), 0);
  return prefix17 + CHECK_CODES[sum % 11];
}

/**
 * 从身份证提取出生日期（YYYY-MM-DD）。
 * 校验位合法只说明「号码格式对」，不代表月日真实存在——如某号段出现 02-30。
 * 这类情况返回 null，交由调用方回退到其它来源（报表出生日期/手填值），
 * 避免把不存在的日期写进 birth_date（年龄会因此算错）。
 */
export function birthFromIdCard(id: string): string | null {
  const value = (id || '').trim();
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
  // 该月实际天数（含闰年 2 月）
  const daysInMonth = new Date(Date.UTC(yi, mi, 0)).getUTCDate();
  if (di > daysInMonth) return null;
  return `${y}-${m}-${d}`;
}

/** 从身份证提取性别：MALE / FEMALE */
export function genderFromIdCard(id: string): string | null {
  const value = (id || '').trim();
  if (value.length !== 18 && value.length !== 15) return null;
  const digit = value.length === 18 ? parseInt(value[16], 10) : parseInt(value[14], 10);
  return digit % 2 === 1 ? 'MALE' : 'FEMALE';
}
