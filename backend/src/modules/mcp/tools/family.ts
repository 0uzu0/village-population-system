/**
 * 家庭域：户列表、户详情、建户与并户。
 *
 * 「在册家庭」是有专门口径的：未停用 **且至少有一名在册成员**。
 * 全户死亡或迁出后，这一户会自动从列表与家庭总数里消失，
 * 但档案还在，改回在册会自动回来。所以家庭数不等于 family 表的行数。
 */

import { ParamDef, ToolDef } from '../types';
import { paged, shape } from '../invoke';

const writeFields: ParamDef[] = [
  { key: 'address', type: 'string', desc: '家庭住址' },
  { key: 'gridId', type: 'integer', desc: '所属网格 id' },
  { key: 'headPersonId', type: 'integer', desc: '户主的人员 id（必须是当前在册人员）' },
];

export const familyTools: ToolDef[] = [
  {
    name: 'family_search',
    title: '查询家庭户',
    description: '按户号、户主姓名、网格查询家庭户，返回户号、住址、户主、在册成员数。',
    domain: 'family',
    scope: 'read',
    permission: 'family:view',
    note: '只返回「在册家庭」：未停用且至少有一名在册成员。全户迁出/死亡后不再出现。',
    params: [
      { key: 'keyword', type: 'string', desc: '户号或户主姓名' },
      { key: 'gridId', type: 'integer', desc: '网格 id' },
      { key: 'page', type: 'integer', desc: '页码，默认 1', default: 1, min: 1 },
      { key: 'pageSize', type: 'integer', desc: '每页条数，默认 20，上限 500', default: 20, min: 1, max: 500 },
    ],
    async exec(ctx, args) {
      return paged(await ctx.call('/families', args));
    },
  },
  {
    name: 'family_get',
    title: '家庭详情',
    description: '取单个家庭户的完整信息与成员名单（含每名成员的状态、与户主关系、是否户主）。',
    domain: 'family',
    scope: 'read',
    permission: 'family:view',
    params: [{ key: 'id', type: 'integer', desc: '家庭 id', required: true, min: 1 }],
    async exec(ctx, args) {
      return shape(await ctx.call(`/families/${args.id}`));
    },
  },
  {
    name: 'family_reconcile',
    title: '家庭成员两表对账',
    description:
      '检查人员档案（family_id / relation）与家庭成员表是否一致，按七类错位分别给出数量与前若干条明细：' +
      '关系值不一致、在户却无家庭归属、有归属却无在户记录、两表指向不同家庭、一人在多户、户主数不是 1、' +
      '已迁出却仍标记在户。只读，可反复执行。',
    domain: 'family',
    scope: 'read',
    permission: 'family:view',
    note: 'family_member 是权威，person.relation 是冗余副本。autoFixable=true 的两类可由迁移修复，其余需人工确认。',
    params: [{ key: 'limit', type: 'integer', desc: '每类返回多少条明细，默认 20，上限 200', default: 20, min: 1, max: 200 }],
    async exec(ctx, args) {
      return shape(await ctx.call('/families/reconcile', { limit: args.limit ?? 20 }));
    },
  },
  {
    name: 'family_create',
    title: '新建家庭户',
    description: '新建一个家庭户。户号由系统生成，不需要填。可同时指定户主，被指定人会挂到该户并置为户主关系。',
    domain: 'family',
    scope: 'write',
    permission: 'family:manage',
    params: writeFields,
    async exec(ctx, args) {
      return shape(await ctx.send('POST', '/families', args));
    },
  },
  {
    name: 'family_add_member',
    title: '把人员加入家庭',
    description: '把一名在册人员加入指定家庭，并设置与户主的关系。设 isHouseholder=true 会同时改该户户主。',
    domain: 'family',
    scope: 'write',
    permission: 'family:manage',
    params: [
      { key: 'id', type: 'integer', desc: '家庭 id', required: true, min: 1 },
      { key: 'personId', type: 'integer', desc: '人员 id', required: true, min: 1 },
      { key: 'relation', type: 'string', desc: '与户主关系，如 配偶 / 子女 / 父母', required: true },
      { key: 'isHouseholder', type: 'boolean', desc: '是否同时设为户主，默认 false', default: false },
    ],
    async exec(ctx, args) {
      const { id, ...body } = args;
      return shape(await ctx.send('POST', `/families/${id}/members`, body));
    },
  },
  {
    name: 'family_auto_group',
    title: '按门牌号自动归户',
    description:
      '把户籍地址或居住地址相同的人员自动归入同一个家庭。**默认只预览不落库**（dryRun=true），' +
      '确认结果无误后再传 dryRun=false 执行。属于批量写操作，请先向用户确认预览结果。',
    domain: 'family',
    scope: 'write',
    permission: 'family:manage',
    params: [
      { key: 'dryRun', type: 'boolean', desc: 'true 仅预览（默认），false 真正落库', default: true },
      { key: 'addressField', type: 'enum', values: ['hukou', 'live'], desc: '按户籍地址还是居住地址归户，默认 hukou', default: 'hukou' },
      { key: 'scope', type: 'enum', values: ['UNFAMILIED', 'ALL'], desc: '只处理未归户人员（默认）还是全部', default: 'UNFAMILIED' },
      { key: 'gridId', type: 'integer', desc: '只处理指定网格' },
    ],
    async exec(ctx, args) {
      return shape(
        await ctx.send('POST', '/families/auto-group', {
          dryRun: args.dryRun === false ? 0 : 1,
          addressField: args.addressField || 'hukou',
          scope: args.scope || 'UNFAMILIED',
          gridId: args.gridId,
        })
      );
    },
  },
];
