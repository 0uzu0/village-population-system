/**
 * 工作台单独展示的两个口径所对应的标签编码。
 *
 * 注意与 utils/tagExclusive.ts 的分工：
 * - **互斥规则**是数据驱动的（exclusive_group / exclusive_priority），代码不认识具体标签；
 * - 但「工作台要单独展示户籍人口、流动人口这两个数字」是产品定义，
 *   必须指名道姓地引用这两枚标签，所以把编码收敛在这里，避免散落在各个 SQL 里。
 *
 * 这些常量只用于「统计哪几枚标签」，不参与「谁压制谁」的裁决。
 */
export const HUKOU_POP_CODE = 'HUKOU_POP';
export const FLOATING_POP_CODE = 'FLOATING_POP';
