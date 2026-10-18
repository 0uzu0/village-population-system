import { FLOATING_POP_CODE, HUKOU_POP_CODE } from '../config/tagCodes';
import { allFocusTagCodes } from './focusGroups';

/**
 * 系统内建标签编码 —— 统计口径的对外契约。
 *
 * 背景（2026-10-18 线上问题）：标签管理页允许手填编码，且只校验「编码全局唯一」，
 * 不校验名称重复。于是有人建了一个「流动人口」（编码 `FLOATING_PERSON`）并给人打上：
 *
 *   - 标签页正常显示人数（它按 `tag_id` 数，谁挂上都算）
 *   - 工作台流动人口恒为 0（它按 `td.code = 'FLOATING_POP'` 数，认不出这个编码）
 *
 * 这类错配**不会报错、不会告警**，只会静静少一个数字，是最难发现的一类问题。
 * 所以把「哪些编码是系统内建的」收敛到这里：
 *   1. 工作台 / 重点人群 / 导出按这些编码取数（已有逻辑不变）；
 *   2. 写入侧据此拦住「同名的第二个标签」和「改系统标签的编码」。
 *
 * ⚠️ 往这里加编码 = 对外口径变更，必须同步：
 *    - 迁移里给该标签设好 `exclusive_group`（如参与互斥）
 *    - `docs/数据字典` 与导出模板
 */
export const SYSTEM_TAG_CODES: readonly string[] = Object.freeze([
  // 户籍 / 流动（工作台单独两个卡片）
  HUKOU_POP_CODE,
  FLOATING_POP_CODE,
  // 重点人群（工作台卡片 + 快捷入口 + 导出标志列）
  ...allFocusTagCodes(),
  // 家庭维度（工作台「低保」按家庭标签统计）
  'LOW_INCOME_FAMILY',
  'EXTREME_POVERTY_FAMILY',
]);

/** 系统编码集合，供高频判断用（比数组 includes 快，且不受调用方误改影响） */
const SYSTEM_TAG_CODE_SET = new Set<string>(SYSTEM_TAG_CODES);

/**
 * 历史编码 / 常见误写 → 规范编码。
 *
 * `RESIDENT_POP` 是 v2.1.0 之前「常住人口」的编码（V016 已改名）；
 * 另外两条是「按中文名直译」的常见误写（户籍人口 → HUKOU_PERSON）。
 * 新建标签时命中这张表会被直接拒绝，并告知正确的编码——
 * 与其让用户建出一个「看着对、统计不到」的标签，不如当场说清楚。
 */
const LEGACY_CODE_ALIASES: Record<string, string> = {
  RESIDENT_POP: FLOATING_POP_CODE,
  FLOATING_PERSON: FLOATING_POP_CODE,
  HUKOU_PERSON: HUKOU_POP_CODE,
};

/** 是否为系统内建标签编码（参与统计口径） */
export function isSystemTagCode(code: string): boolean {
  return SYSTEM_TAG_CODE_SET.has(code);
}

/**
 * 该编码是否为某个系统编码的历史写法/别名。
 * @returns 规范编码；不是别名则返回 null
 */
export function aliasedSystemCode(code: string): string | null {
  return LEGACY_CODE_ALIASES[code] ?? null;
}

/** 编码规则被拒的原因（路由层转成 AppError 的 errorCode） */
export interface TagCodeViolation {
  ok: false;
  errorCode: 'TAG_CODE_ALIAS' | 'SYSTEM_TAG_CODE_IMMUTABLE';
  message: string;
}

export type TagCodeCheck = { ok: true } | TagCodeViolation;

/**
 * 新建标签时的编码校验（不含「编码是否已存在」——那需要查库）。
 *
 * 只拦别名：允许用户重新建一枚已删除的系统标签（编码仍是规范编码），
 * 因为「系统标签被物理删除后重建」是合法路径。
 */
export function checkNewTagCode(code: string): TagCodeCheck {
  const canonical = aliasedSystemCode(code);
  if (canonical) {
    return {
      ok: false,
      errorCode: 'TAG_CODE_ALIAS',
      message: `编码 ${code} 是系统标签的旧写法/别名，请直接使用 ${canonical}（或启用列表里已有的同名标签）`,
    };
  }
  return { ok: true };
}

/**
 * 编辑标签时的编码变更校验。
 *
 * 唯一不可改的是**系统内建标签的编码**：工作台卡片、重点人群、导出标志列全按编码取数，
 * 改完不会报错，只会让对应统计静默变成 0（2026-10-18 那次线上问题就是同类）。
 * 名称、颜色、说明、分类都可以随便改。
 */
export function checkTagCodeChange(oldCode: string, newCode: string, tagName = ''): TagCodeCheck {
  if (isSystemTagCode(oldCode) && oldCode !== newCode) {
    return {
      ok: false,
      errorCode: 'SYSTEM_TAG_CODE_IMMUTABLE',
      message:
        `「${tagName || oldCode}」是系统内建标签，编码 ${oldCode} 参与统计口径，不能修改` +
        `（改了工作台与重点人群统计会立刻变成 0）。如需停用请用启用开关。`,
    };
  }
  const canonical = aliasedSystemCode(newCode);
  if (canonical && canonical !== oldCode) {
    return {
      ok: false,
      errorCode: 'TAG_CODE_ALIAS',
      message: `编码 ${newCode} 是系统标签的旧写法/别名，请使用 ${canonical}`,
    };
  }
  return { ok: true };
}
