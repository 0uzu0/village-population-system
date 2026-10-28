/**
 * 管理与附件域：审计日志、用户与角色、附件清单。
 *
 * 这一组是「谁改的、谁在用、有没有照片」类问题的入口。
 * 注意附件只返回元数据（文件名、大小、拍摄时间），不返回文件本身——
 * 图片字节进模型上下文既无意义又昂贵。
 */

import { ToolDef } from '../types';
import { paged, shape } from '../invoke';

export const adminTools: ToolDef[] = [
  {
    name: 'audit_search',
    title: '审计日志查询',
    description: '按关键词、动作、结果、时间区间查询操作审计日志（谁在什么时候做了什么、成功与否）。',
    domain: 'audit',
    scope: 'read',
    permission: 'audit:view',
    params: [
      { key: 'keyword', type: 'string', desc: '账号或动作关键词' },
      { key: 'action', type: 'string', desc: '动作，如 POST /api/persons' },
      { key: 'result', type: 'enum', values: ['SUCCESS', 'FAIL'], desc: '结果' },
      { key: 'start', type: 'string', desc: '起始时间 YYYY-MM-DD' },
      { key: 'end', type: 'string', desc: '结束时间 YYYY-MM-DD' },
      { key: 'page', type: 'integer', desc: '页码，默认 1', default: 1, min: 1 },
      { key: 'pageSize', type: 'integer', desc: '每页条数，默认 20，上限 500', default: 20, min: 1, max: 500 },
    ],
    async exec(ctx, args) {
      return paged(await ctx.call('/audit-logs', args));
    },
  },
  {
    name: 'user_list',
    title: '用户列表',
    description: '列出系统账号：用户名、姓名、角色、启用状态、是否管理员。',
    domain: 'admin',
    scope: 'read',
    permission: 'user:view',
    params: [
      { key: 'keyword', type: 'string', desc: '用户名或姓名' },
      { key: 'page', type: 'integer', desc: '页码，默认 1', default: 1, min: 1 },
      { key: 'pageSize', type: 'integer', desc: '每页条数，默认 20，上限 500', default: 20, min: 1, max: 500 },
    ],
    async exec(ctx, args) {
      return paged(await ctx.call('/users', args));
    },
  },
  {
    name: 'role_list',
    title: '角色列表',
    description: '列出系统角色及其权限范围，用于回答「谁能看台账」「网格员有哪些权限」。',
    domain: 'admin',
    scope: 'read',
    permission: 'user:view',
    params: [],
    async exec(ctx) {
      const data = shape(await ctx.call('/users/roles'));
      return { items: Array.isArray(data) ? data : data?.list || data };
    },
  },
  {
    name: 'permission_list',
    title: '权限码清单',
    description: '列出系统全部权限码及其说明，用于解释某个角色能做什么。',
    domain: 'admin',
    scope: 'read',
    permission: 'user:view',
    params: [],
    async exec(ctx) {
      const data = shape(await ctx.call('/users/permissions'));
      return { items: Array.isArray(data) ? data : data?.list || data };
    },
  },
  {
    name: 'file_list',
    title: '附件清单',
    description:
      '列出某个人或某条台账记录关联的附件（文件名、类型、大小、拍摄时间）。' +
      '回答「这个人有没有照片」时用。只返回元数据，不返回图片内容。',
    domain: 'file',
    scope: 'read',
    permission: 'person:view',
    note: 'bizType=PERSON 时 bizId 是人员 id；bizType=LEDGER 时 bizId 是台账记录 id。',
    params: [
      { key: 'bizType', type: 'enum', values: ['PERSON', 'LEDGER'], desc: '归属对象类型', required: true },
      { key: 'bizId', type: 'integer', desc: '归属对象 id', required: true, min: 1 },
      { key: 'page', type: 'integer', desc: '页码，默认 1', default: 1, min: 1 },
      { key: 'pageSize', type: 'integer', desc: '每页条数，默认 100', default: 100, min: 1, max: 200 },
    ],
    async exec(ctx, args) {
      return paged(await ctx.call('/files', args));
    },
  },
];
