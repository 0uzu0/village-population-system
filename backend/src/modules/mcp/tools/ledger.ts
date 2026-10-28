/**
 * 专项台账域：条口记录与费用统计。
 *
 * 台账金额有两列：劳务费与发票费，合计 = 两者相加。模型经常只取其中一个当总额，
 * 所以 note 里必须写明。
 */

import { ParamDef, ToolDef } from '../types';
import { paged, shape } from '../invoke';

const recordFields: ParamDef[] = [
  { key: 'category', type: 'string', desc: '条口编码，先用 ledger_meta 取（如 ENV / ROAD）', required: true },
  { key: 'workType', type: 'string', desc: '工作类型编码，必须属于该条口', required: true },
  { key: 'recordDate', type: 'string', desc: '发生日期 YYYY-MM-DD', required: true },
  { key: 'title', type: 'string', desc: '事项标题', required: true },
  { key: 'location', type: 'string', desc: '地点' },
  { key: 'detail', type: 'string', desc: '详细说明' },
  { key: 'laborCost', type: 'number', desc: '劳务费（元），默认 0', min: 0, default: 0 },
  { key: 'invoiceCost', type: 'number', desc: '发票费（元），默认 0', min: 0, default: 0 },
  { key: 'invoiceNo', type: 'string', desc: '发票号' },
  { key: 'responsible', type: 'string', desc: '负责人' },
  { key: 'remark', type: 'string', desc: '备注' },
  { key: 'attachmentIds', type: 'string', desc: '附件 id，逗号分隔（先通过附件上传接口获得，MCP 不承载文件流）' },
];

/** attachmentIds 在 REST 里是数组，这里把逗号串转过去 */
function withAttachments(args: Record<string, any>): Record<string, any> {
  const { attachmentIds, ...rest } = args;
  if (attachmentIds === undefined) return rest;
  return {
    ...rest,
    attachmentIds: String(attachmentIds)
      .split(',')
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isInteger(n) && n > 0),
  };
}

export const ledgerTools: ToolDef[] = [
  {
    name: 'ledger_meta',
    title: '台账条口字典',
    description: '返回台账的条口分类与每个条口下的工作类型。记账前先取编码，编码传错会被后端拒绝。',
    domain: 'ledger',
    scope: 'read',
    permission: 'ledger:view',
    params: [],
    async exec(ctx) {
      return shape(await ctx.call('/ledgers/meta'));
    },
  },
  {
    name: 'ledger_list',
    title: '查询台账记录',
    description: '按条口、工作类型、关键词、日期区间查询台账记录，返回金额与附件数。',
    domain: 'ledger',
    scope: 'read',
    permission: 'ledger:view',
    note: '单条合计 = laborCost + invoiceCost（totalCost 字段已算好）。',
    params: [
      { key: 'category', type: 'string', desc: '条口编码' },
      { key: 'workType', type: 'string', desc: '工作类型编码' },
      { key: 'keyword', type: 'string', desc: '标题/地点/负责人/发票号关键词' },
      { key: 'start', type: 'string', desc: '起始日期 YYYY-MM-DD（含）' },
      { key: 'end', type: 'string', desc: '结束日期 YYYY-MM-DD（含）' },
      { key: 'page', type: 'integer', desc: '页码，默认 1', default: 1, min: 1 },
      { key: 'pageSize', type: 'integer', desc: '每页条数，默认 20，上限 500', default: 20, min: 1, max: 500 },
    ],
    async exec(ctx, args) {
      return paged(await ctx.call('/ledgers/records', args));
    },
  },
  {
    name: 'ledger_get',
    title: '台账记录详情',
    description: '取单条台账记录及其附件清单（附件只返回 id 与文件名，不返回文件内容）。',
    domain: 'ledger',
    scope: 'read',
    permission: 'ledger:view',
    params: [{ key: 'id', type: 'integer', desc: '台账记录 id', required: true, min: 1 }],
    async exec(ctx, args) {
      return shape(await ctx.call(`/ledgers/records/${args.id}`));
    },
  },
  {
    name: 'ledger_stats',
    title: '台账费用统计',
    description:
      '按筛选条件汇总台账费用：总条数、劳务费、发票费、合计，并按条口、工作类型、月份分组。' +
      '回答「今年环境整治花了多少钱」用它，不要自己把列表金额加起来（会漏掉分页外的数据）。',
    domain: 'ledger',
    scope: 'read',
    permission: 'ledger:view',
    params: [
      { key: 'category', type: 'string', desc: '条口编码' },
      { key: 'workType', type: 'string', desc: '工作类型编码' },
      { key: 'start', type: 'string', desc: '起始日期 YYYY-MM-DD' },
      { key: 'end', type: 'string', desc: '结束日期 YYYY-MM-DD' },
    ],
    async exec(ctx, args) {
      return shape(await ctx.call('/ledgers/stats', args));
    },
  },
  {
    name: 'ledger_create',
    title: '新增台账记录',
    description: '记一笔专项台账。条口与工作类型必须匹配，否则后端拒绝。',
    domain: 'ledger',
    scope: 'write',
    permission: 'ledger:manage',
    params: recordFields,
    async exec(ctx, args) {
      return shape(await ctx.send('POST', '/ledgers/records', withAttachments(args)));
    },
  },
  {
    name: 'ledger_update',
    title: '编辑台账记录',
    description: '修改台账记录。需回传完整字段（条口、工作类型、日期、标题必填），未传的金额按 0 处理。',
    domain: 'ledger',
    scope: 'write',
    permission: 'ledger:manage',
    params: [{ key: 'id', type: 'integer', desc: '台账记录 id', required: true, min: 1 }, ...recordFields],
    async exec(ctx, args) {
      const { id, ...rest } = args;
      return shape(await ctx.send('PUT', `/ledgers/records/${id}`, withAttachments(rest)));
    },
  },
];
