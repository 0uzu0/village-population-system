/**
 * 「与户主关系」的唯一归一实现。
 *
 * 为什么需要它：这个字段有两个互相冲突的事实来源——
 *   - 枚举写入口（网页下拉、家庭成员添加）：只产出 HEAD/SPOUSE/CHILD/...
 *   - Excel 导入：户籍表里写的是「妻」「长女」「儿媳」「其他非亲属」这类自然语言
 * 早先的导入逻辑只把「户主」换成 HEAD，其余中文原样入库，于是同一列里混着
 * 56% 的中文和 44% 的枚举码。前端按枚举渲染时中文只能原样透出，
 * 「户主判定（relation === 'HEAD'）」也会漏掉「本人」这类写法。
 *
 * 归一规则：中文按语义并入受控枚举；无法归类的落 OTHER，不保留原始写法
 * （原始写法在导入批次里仍可追溯，且「长女/二女」的信息由性别 + 出生日期承载）。
 *
 * ⚠️ 新增枚举值时要同步三处：本文件的 CODES/LABELS、migration 里的 sys_dict、
 * 前端 utils/format.ts 的 RELATION_OPTIONS。relation.test.ts 会校验前后端一致。
 */

/** 受控枚举码，顺序即字典排序 */
export const RELATION_CODES = [
  'HEAD',
  'SPOUSE',
  'CHILD',
  'CHILD_IN_LAW',
  'GRANDCHILD',
  'PARENT',
  'SIBLING',
  'OTHER',
] as const;

export type RelationCode = (typeof RELATION_CODES)[number];

/** 码 → 中文标签 */
export const RELATION_LABELS: Record<RelationCode, string> = {
  HEAD: '户主',
  SPOUSE: '配偶',
  CHILD: '子女',
  CHILD_IN_LAW: '儿媳女婿',
  GRANDCHILD: '孙辈',
  PARENT: '父母',
  SIBLING: '兄弟姐妹',
  OTHER: '其他',
};

/**
 * 中文（及常见变体）→ 枚举码。
 *
 * 只收录实际见过的写法（2026-10 抽样 1200 人统计），不追求穷举亲属称谓：
 * 多一个映射不会出错，但每加一条就多一处要维护的口径。
 */
const ALIASES: Record<string, RelationCode> = {
  // 户主
  户主: 'HEAD',
  本人: 'HEAD',
  户主本人: 'HEAD',
  // 配偶
  配偶: 'SPOUSE',
  妻: 'SPOUSE',
  夫: 'SPOUSE',
  妻子: 'SPOUSE',
  丈夫: 'SPOUSE',
  爱人: 'SPOUSE',
  // 子女
  子: 'CHILD',
  女: 'CHILD',
  儿子: 'CHILD',
  女儿: 'CHILD',
  长子: 'CHILD',
  次子: 'CHILD',
  三子: 'CHILD',
  四子: 'CHILD',
  长女: 'CHILD',
  次女: 'CHILD',
  二女: 'CHILD',
  三女: 'CHILD',
  四女: 'CHILD',
  子女: 'CHILD',
  养子: 'CHILD',
  养女: 'CHILD',
  继子: 'CHILD',
  继女: 'CHILD',
  养子或继子: 'CHILD',
  养女或继女: 'CHILD',
  独生子: 'CHILD',
  独生女: 'CHILD',
  // 儿媳 / 女婿
  儿媳: 'CHILD_IN_LAW',
  儿媳妇: 'CHILD_IN_LAW',
  媳妇: 'CHILD_IN_LAW',
  女婿: 'CHILD_IN_LAW',
  // 孙辈
  孙: 'GRANDCHILD',
  孙子: 'GRANDCHILD',
  孙女: 'GRANDCHILD',
  外孙: 'GRANDCHILD',
  外孙子: 'GRANDCHILD',
  外孙女: 'GRANDCHILD',
  // 父母
  父: 'PARENT',
  母: 'PARENT',
  父亲: 'PARENT',
  母亲: 'PARENT',
  父母: 'PARENT',
  岳父: 'PARENT',
  岳母: 'PARENT',
  公公: 'PARENT',
  婆婆: 'PARENT',
  // 兄弟姐妹
  兄: 'SIBLING',
  弟: 'SIBLING',
  姐: 'SIBLING',
  妹: 'SIBLING',
  哥哥: 'SIBLING',
  弟弟: 'SIBLING',
  姐姐: 'SIBLING',
  妹妹: 'SIBLING',
  兄弟: 'SIBLING',
  姐妹: 'SIBLING',
  // 其他
  其他: 'OTHER',
  其它: 'OTHER',
  其他非亲属: 'OTHER',
  非亲属: 'OTHER',
};

/**
 * 把任意输入收敛成受控枚举码。
 *
 * - `null` / `undefined` / 空串 → `null`（表示「没填」，由调用方决定落库默认值；
 *   family_member.relation 是 NOT NULL，调用方要用 `?? 'OTHER'`）
 * - 已是枚举码（大小写不敏感、允许前后空格）→ 归一成大写的码
 * - 认识的中文 → 对应码
 * - 不认识的中文 → OTHER（不抛错：导入要能跑完，脏值不该阻断整批）
 */
export function normalizeRelation(raw: unknown): RelationCode | null {
  if (raw === null || raw === undefined) return null;
  const text = String(raw).trim();
  if (!text) return null;

  const upper = text.toUpperCase();
  if ((RELATION_CODES as readonly string[]).includes(upper)) return upper as RelationCode;

  return ALIASES[text] ?? 'OTHER';
}

/** 码 → 展示文案；未知值原样返回，避免界面出现空白 */
export function relationLabel(code?: string | null): string {
  if (!code) return '—';
  return RELATION_LABELS[code as RelationCode] ?? code;
}
