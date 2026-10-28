/**
 * 标签域。
 *
 * 标签是重点人群的底座：绝大多数「有多少人」的问题，本质是某个标签的关联人数。
 * 但标签人数有两条必须说清的口径——只数在册人员、互斥组只数优先级最高的那一枚，
 * 所以不要用 tag_list 的 person_count 自己相加，那会把互斥人群数重。
 */

import { ToolDef } from '../types';
import { paged, shape } from '../invoke';

export const tagTools: ToolDef[] = [
  {
    name: 'tag_list',
    title: '查询标签定义',
    description: '列出全部标签：名称、编码、颜色、所属分类、关联人数、是否系统内建、是否互斥。给人员打标签前先查 id。',
    domain: 'tag',
    scope: 'read',
    permission: 'tag:view',
    note: 'personCount 只统计在册人员；互斥组内被压制的标签不计入。系统标签（isSystem=1）的编码被统计逻辑依赖，不可改。',
    params: [
      { key: 'keyword', type: 'string', desc: '名称、编码或别名关键词' },
      { key: 'categoryId', type: 'integer', desc: '标签分类 id' },
      { key: 'objectType', type: 'enum', values: ['PERSON'], desc: '对象类型，当前仅支持 PERSON' },
      { key: 'enabled', type: 'integer', desc: '1 只看启用，0 只看停用，不传看全部', min: 0, max: 1 },
      { key: 'page', type: 'integer', desc: '页码，默认 1', default: 1, min: 1 },
      { key: 'pageSize', type: 'integer', desc: '每页条数，默认 20，上限 500', default: 20, min: 1, max: 500 },
    ],
    async exec(ctx, args) {
      return paged(await ctx.call('/tags/definitions', args));
    },
  },
  {
    name: 'tag_categories',
    title: '标签分类',
    description: '列出标签分类及其下标签数量，用于理解标签体系结构。',
    domain: 'tag',
    scope: 'read',
    permission: 'tag:view',
    params: [],
    async exec(ctx) {
      const data = shape(await ctx.call('/tags/categories'));
      return { items: Array.isArray(data) ? data : data?.list || data };
    },
  },
  {
    name: 'tag_history',
    title: '标签变更流水',
    description: '查询标签的打上与移除记录（谁、何时、对谁、依据是什么）。核对某人的低保是什么时候取消的之类问题。',
    domain: 'tag',
    scope: 'read',
    permission: 'tag:view',
    params: [
      { key: 'objectType', type: 'enum', values: ['PERSON'], desc: '对象类型，当前仅支持 PERSON' },
      { key: 'objectId', type: 'integer', desc: '人员 id' },
      { key: 'tagId', type: 'integer', desc: '标签 id' },
      { key: 'action', type: 'string', desc: '动作，如 ADD / REMOVE' },
      { key: 'page', type: 'integer', desc: '页码，默认 1', default: 1, min: 1 },
      { key: 'pageSize', type: 'integer', desc: '每页条数，默认 20，上限 500', default: 20, min: 1, max: 500 },
    ],
    async exec(ctx, args) {
      return paged(await ctx.call('/tags/history', args));
    },
  },
];
