/**
 * 网格与村庄域。
 *
 * 网格是行政区划单元，村庄是人员档案里的「所属村庄」字段聚合出的自然村。
 * 两者不是父子关系：一个网格可以覆盖多个自然村。回答「按村统计」时必须用 village_list，
 * 用 grid_list 会把几个村合并成一个数。
 */

import { ParamDef, ToolDef } from '../types';
import { paged, shape } from '../invoke';

const gridFields: ParamDef[] = [
  { key: 'gridNo', type: 'string', desc: '网格编号，唯一', required: true },
  { key: 'name', type: 'string', desc: '网格名称', required: true },
  { key: 'manager', type: 'string', desc: '网格长姓名' },
  { key: 'staff', type: 'string', desc: '网格员' },
  { key: 'description', type: 'string', desc: '说明' },
  { key: 'status', type: 'integer', desc: '1 启用 / 0 停用', min: 0, max: 1, default: 1 },
];

export const gridTools: ToolDef[] = [
  {
    name: 'grid_list',
    title: '查询网格',
    description: '列出网格及其在册人口数、在册家庭数与各类重点人群人数。回答「各网格人口分布」时用。',
    domain: 'grid',
    scope: 'read',
    permission: 'grid:view',
    note: '人口与家庭数均为在册口径（排除已迁出、已死亡）。',
    params: [
      { key: 'keyword', type: 'string', desc: '网格名称或编号' },
      { key: 'page', type: 'integer', desc: '页码，默认 1', default: 1, min: 1 },
      { key: 'pageSize', type: 'integer', desc: '每页条数，默认 20，上限 500', default: 20, min: 1, max: 500 },
    ],
    async exec(ctx, args) {
      return paged(await ctx.call('/grids', args));
    },
  },
  {
    name: 'grid_get',
    title: '网格详情',
    description: '取单个网格的详细信息。',
    domain: 'grid',
    scope: 'read',
    permission: 'grid:view',
    params: [{ key: 'id', type: 'integer', desc: '网格 id', required: true, min: 1 }],
    async exec(ctx, args) {
      return shape(await ctx.call(`/grids/${args.id}`));
    },
  },
  {
    name: 'village_list',
    title: '按自然村统计',
    description:
      '按人员档案的「所属村庄」字段汇总：每个村的人口数、家庭数、所属网格、负责人与联系电话，以及各类重点人群人数。' +
      '回答「哪个村老人最多」「某村的低保有多少」必须用这个工具。',
    domain: 'grid',
    scope: 'read',
    permission: 'grid:view',
    note: '村庄来自 person.village，是导入时由户籍地址推导的；不属于任何网格的层级关系，不要与网格混用。',
    params: [{ key: 'keyword', type: 'string', desc: '村庄名关键词' }],
    async exec(ctx, args) {
      const data = shape(await ctx.call('/grids/villages', args));
      // 接口返回数组（每村一行），统一成 items 便于模型遍历
      return { items: Array.isArray(data) ? data : data?.list || data };
    },
  },
  {
    name: 'grid_create',
    title: '新建网格',
    description: '新建一个网格。编号不可重复。',
    domain: 'grid',
    scope: 'write',
    permission: 'grid:manage',
    params: gridFields,
    async exec(ctx, args) {
      return shape(await ctx.send('POST', '/grids', args));
    },
  },
  {
    name: 'grid_update',
    title: '编辑网格',
    description: '修改网格信息。需回传完整字段（编号与名称必填）。',
    domain: 'grid',
    scope: 'write',
    permission: 'grid:manage',
    params: [{ key: 'id', type: 'integer', desc: '网格 id', required: true, min: 1 }, ...gridFields],
    async exec(ctx, args) {
      const { id, ...body } = args;
      return shape(await ctx.send('PUT', `/grids/${id}`, body));
    },
  },
  {
    name: 'grid_transfer_person',
    title: '跨网格转移人员',
    description: '把一名或多名人员转移到另一个网格，会记录原网格、新网格、操作人与原因。',
    domain: 'grid',
    scope: 'write',
    permission: 'person:edit',
    params: [
      { key: 'personIds', type: 'string', desc: '人员 id，逗号分隔', required: true },
      { key: 'targetGridId', type: 'integer', desc: '目标网格 id', required: true, min: 1 },
      { key: 'reason', type: 'string', desc: '转移原因' },
    ],
    async exec(ctx, args) {
      const personIds = String(args.personIds)
        .split(',')
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isInteger(n) && n > 0);
      return shape(
        await ctx.send('POST', '/grids/transfer-person', {
          personIds,
          targetGridId: args.targetGridId,
          reason: args.reason,
        })
      );
    },
  },
  {
    name: 'village_contact_update',
    title: '维护村庄负责人',
    description: '保存某个自然村的负责人与联系电话。负责人与电话同时为空时清除该村联系人记录。',
    domain: 'grid',
    scope: 'write',
    permission: 'grid:manage',
    params: [
      { key: 'villageName', type: 'string', desc: '村庄名（必须已存在于人员档案）', required: true },
      { key: 'manager', type: 'string', desc: '负责人姓名' },
      { key: 'phone', type: 'string', desc: '联系电话' },
    ],
    async exec(ctx, args) {
      return shape(await ctx.send('PUT', '/grids/villages/contact', args));
    },
  },
];
