/**
 * 待核查域：导入时身份证缺失/非法的行会落到这里，补齐后才进正式档案。
 *
 * 这一组工具解决的是「导入了但人没进系统」——村里最常见的困惑。
 * 先 pending_summary 看总量，再 pending_list 定位具体是谁。
 */

import { ParamDef, ToolDef } from '../types';
import { paged, shape } from '../invoke';

const updateFields: ParamDef[] = [
  { key: 'name', type: 'string', desc: '姓名' },
  { key: 'idCard', type: 'string', desc: '身份证号。补录后系统会自动派生出生日期与性别' },
  { key: 'gender', type: 'enum', values: ['MALE', 'FEMALE'], desc: '性别' },
  { key: 'birthDate', type: 'string', desc: '出生日期 YYYY-MM-DD' },
  { key: 'phone', type: 'string', desc: '手机号' },
  { key: 'phoneBackup', type: 'string', desc: '备用手机号' },
  { key: 'hukouAddress', type: 'string', desc: '户籍地址' },
  { key: 'liveAddress', type: 'string', desc: '居住地址' },
  { key: 'village', type: 'string', desc: '所属村庄' },
  { key: 'gridNo', type: 'string', desc: '网格编号（导入文件里的原始值）' },
  { key: 'familyNo', type: 'string', desc: '家庭户号' },
  { key: 'relation', type: 'string', desc: '与户主关系' },
  { key: 'personStatus', type: 'string', desc: '人员状态（原始值）' },
  { key: 'handleNote', type: 'string', desc: '处理备注' },
];

export const pendingTools: ToolDef[] = [
  {
    name: 'pending_summary',
    title: '待核查概览',
    description: '返回待核查记录总数，以及按状态、按原因的数量分布。回答「导入后有多少人要补身份证」用它。',
    domain: 'pending',
    scope: 'read',
    permission: 'excel:import',
    params: [],
    async exec(ctx) {
      return shape(await ctx.call('/pending/summary'));
    },
  },
  {
    name: 'pending_list',
    title: '查询待核查记录',
    description: '按状态、原因、批次号、关键词分页查询待核查人员。',
    domain: 'pending',
    scope: 'read',
    permission: 'excel:import',
    params: [
      { key: 'status', type: 'string', desc: '状态：PENDING 待处理 / RESOLVED 已入库 / IGNORED 已忽略' },
      { key: 'reason', type: 'string', desc: '原因编码，如 MISSING_ID_CARD / INVALID_ID_CARD' },
      { key: 'batchNo', type: 'string', desc: '导入批次号' },
      { key: 'keyword', type: 'string', desc: '姓名/身份证/手机号关键词' },
      { key: 'page', type: 'integer', desc: '页码，默认 1', default: 1, min: 1 },
      { key: 'pageSize', type: 'integer', desc: '每页条数，默认 20，上限 500', default: 20, min: 1, max: 500 },
    ],
    async exec(ctx, args) {
      return paged(await ctx.call('/pending', args));
    },
  },
  {
    name: 'pending_get',
    title: '待核查记录详情',
    description: '取单条待核查记录的完整字段（含导入行号与失败原因）。',
    domain: 'pending',
    scope: 'read',
    permission: 'excel:import',
    params: [{ key: 'id', type: 'integer', desc: '记录 id', required: true, min: 1 }],
    async exec(ctx, args) {
      return shape(await ctx.call(`/pending/${args.id}`));
    },
  },
  {
    name: 'pending_update',
    title: '补录待核查信息',
    description: '修改待核查记录（通常是补身份证）。补录身份证后出生日期与性别会自动派生。已入库的记录不可再改。',
    domain: 'pending',
    scope: 'write',
    permission: 'excel:import',
    params: [{ key: 'id', type: 'integer', desc: '记录 id', required: true, min: 1 }, ...updateFields],
    async exec(ctx, args) {
      const { id, ...body } = args;
      return shape(await ctx.send('PUT', `/pending/${id}`, body));
    },
  },
  {
    name: 'pending_confirm',
    title: '确认入库',
    description:
      '把待核查记录正式写入人员档案。要求身份证已补录且校验通过、且不与现有人员重复。' +
      '这是**不可撤销**的建档动作，执行前请向用户复述姓名与身份证。',
    domain: 'pending',
    scope: 'write',
    permission: 'excel:import',
    params: [{ key: 'id', type: 'integer', desc: '记录 id', required: true, min: 1 }],
    async exec(ctx, args) {
      return shape(await ctx.send('POST', `/pending/${args.id}/confirm`));
    },
  },
  {
    name: 'pending_ignore',
    title: '忽略待核查记录',
    description: '把记录标记为「无需入库」，保留痕迹便于以后追溯。',
    domain: 'pending',
    scope: 'write',
    permission: 'excel:import',
    params: [
      { key: 'id', type: 'integer', desc: '记录 id', required: true, min: 1 },
      { key: 'note', type: 'string', desc: '忽略原因' },
    ],
    async exec(ctx, args) {
      return shape(await ctx.send('POST', `/pending/${args.id}/ignore`, { note: args.note }));
    },
  },
];
