/**
 * 重点人群域：族群概览与多条件下钻。
 *
 * 这两个工具是「AI 最该用」的入口：用户问「有多少低保、多少残疾人」时，
 * 直接查人员表再自己数会漏掉在册口径与互斥标签，必须走这里。
 */

import { ToolDef } from '../types';
import { paged, shape } from '../invoke';

export const keygroupTools: ToolDef[] = [
  {
    name: 'keygroup_quick',
    title: '重点人群概览',
    description:
      '返回各类重点人群人数：党员、退役军人、优抚对象、低保、特困、残疾、老年人、未成年人等。' +
      '回答「我们村有多少低保户/多少老人」这类问题时优先用它，不要自己按标签统计。',
    domain: 'keygroup',
    scope: 'read',
    permission: 'keygroup:view',
    note: '各人群之间存在交叉（一个人可能既是党员又是退役军人），**不可相加**，也不等于总人口；老年人、未成年人按年龄自动判定，无需打标签。',
    params: [],
    async exec(ctx) {
      const data = shape(await ctx.call('/key-groups/quick'));
      return { groups: data.list || [], note: data.note };
    },
  },
  {
    name: 'keygroup_query',
    title: '重点人群下钻查询',
    description:
      '按标签、网格、村庄、年龄、残疾等级、供养方式、发放金额、监护人等条件查询重点人群名单，返回人员列表与结果分布。' +
      '适合「把 60 岁以上低保老人按村列出来」这类组合筛选。',
    domain: 'keygroup',
    scope: 'read',
    permission: 'keygroup:view',
    note: '默认只统计在册人员。多标签默认取交集（tagMode=ALL）；「党员」这类由多个标签合成的族群应传 tagMode=ANY。',
    params: [
      { key: 'tagIds', type: 'string', desc: '标签 id，逗号分隔' },
      { key: 'tagMode', type: 'enum', values: ['ANY', 'ALL'], desc: '多标签组合：ANY 并集，ALL 交集，默认 ALL' },
      { key: 'gridId', type: 'integer', desc: '网格 id' },
      { key: 'villages', type: 'string', desc: '村庄名，逗号分隔' },
      { key: 'minAge', type: 'integer', desc: '最小年龄（含）', min: 0, max: 150 },
      { key: 'maxAge', type: 'integer', desc: '最大年龄（含）', min: 0, max: 150 },
      { key: 'keyword', type: 'string', desc: '姓名/身份证/手机号关键词' },
      { key: 'activeOnly', type: 'boolean', desc: '只看在册，默认 true', default: true },
      {
        key: 'extremePovertyMode',
        type: 'enum',
        values: ['CENTRALIZED', 'DISPERSED'],
        desc: '特困供养方式：CENTRALIZED 集中供养，DISPERSED 分散供养',
      },
      { key: 'minDisabilityLevel', type: 'enum', values: ['LEVEL_1', 'LEVEL_2', 'LEVEL_3', 'LEVEL_4'], desc: '残疾等级下限（一级最重）' },
      { key: 'maxDisabilityLevel', type: 'enum', values: ['LEVEL_1', 'LEVEL_2', 'LEVEL_3', 'LEVEL_4'], desc: '残疾等级上限' },
      { key: 'disabilityType', type: 'string', desc: '残疾类别，如 肢体残疾' },
      { key: 'minSubsidy', type: 'number', desc: '发放金额下限（元/月）', min: 0 },
      { key: 'maxSubsidy', type: 'number', desc: '发放金额上限（元/月）', min: 0 },
      { key: 'guardian', type: 'enum', values: ['YES', 'NO'], desc: '是否有监护人' },
      { key: 'page', type: 'integer', desc: '页码，默认 1', default: 1, min: 1 },
      { key: 'pageSize', type: 'integer', desc: '每页条数，默认 20，上限 200', default: 20, min: 1, max: 200 },
    ],
    async exec(ctx, args) {
      const data = await ctx.call('/key-groups/query', args);
      const { page, ...rest } = shape(data || {});
      // page 里是 {list,total,page,pageSize}；其余是 filter 与 distribution，
      // 一并返回，模型回答「这些人分布在哪几个村」时不用再查一次。
      return { ...paged(data?.page), ...rest };
    },
  },
];
