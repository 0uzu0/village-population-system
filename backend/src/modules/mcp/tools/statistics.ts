/**
 * 统计域：工作台口径、分布、近期变更、导入概况。
 *
 * 这几个工具是「总数类问题」的唯一正确入口。用 person_search 的 total 加总去
 * 回答「全村多少人」会出错——分页接口的 total 受筛选条件影响，且不含口径说明。
 */

import { ToolDef } from '../types';
import { shape } from '../invoke';

export const statisticsTools: ToolDef[] = [
  {
    name: 'stats_dashboard',
    title: '工作台总览',
    description:
      '返回总人口、户籍人口、流动人口、家庭户数、网格数，以及党员、退役军人、优抚对象、特困等重点人群人数。' +
      '回答「全村有多少人」这类问题必须用它。',
    domain: 'statistics',
    scope: 'read',
    permission: 'dashboard:view',
    note: '总人口 = 户籍人口 + 流动人口（两者互斥）。重点人群之间**存在交叉**，各卡片人数不可相加，也不等于总人口。仅统计在册人员（正常/迁入）。',
    params: [],
    async exec(ctx) {
      return shape(await ctx.call('/statistics/dashboard'));
    },
  },
  {
    name: 'stats_distributions',
    title: '人口分布',
    description: '返回年龄分段、性别、网格、标签四个维度的分布人数。用于回答「人口结构」「哪个年龄段最多」。',
    domain: 'statistics',
    scope: 'read',
    permission: 'statistics:view',
    note: '年龄分段固定为 0-17 / 18-35 / 36-59 / 60-79 / 80+；仅统计在册人员；标签 Top 15 按人数降序。',
    params: [],
    async exec(ctx) {
      const d = shape(await ctx.call('/statistics/distributions'));
      return {
        age: d.age || [],
        gender: d.gender || [],
        grids: d.grids || [],
        topTags: d.tags || [],
      };
    },
  },
  {
    name: 'stats_changes',
    title: '近期档案变更',
    description: '最近 10 条人口档案变更记录（新建、修改、状态变更、删除），含操作人与时间。回答「最近谁动过数据」时用。',
    domain: 'statistics',
    scope: 'read',
    permission: 'dashboard:view',
    params: [],
    async exec(ctx) {
      const data = shape(await ctx.call('/statistics/changes'));
      return { items: Array.isArray(data) ? data : data?.list || data };
    },
  },
  {
    name: 'stats_imports',
    title: '最近导入任务',
    description: '最近 5 次 Excel 导入任务的状态与成功/失败/转待核查条数。回答「上次导入成功了吗」时用。',
    domain: 'statistics',
    scope: 'read',
    permission: 'dashboard:view',
    params: [],
    async exec(ctx) {
      const data = shape(await ctx.call('/statistics/imports'));
      return { items: Array.isArray(data) ? data : data?.list || data };
    },
  },
];
