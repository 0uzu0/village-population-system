/**
 * 导入导出域：任务状态、错误明细、模板目录、导出。
 *
 * MCP 不承载文件流（Excel 二进制不进模型上下文）。这里的工具只负责「发起」与「查询状态」，
 * 下载仍由客户端用返回的 taskId 走既有下载接口。
 */

import { ParamDef, ToolDef } from '../types';
import { paged, shape } from '../invoke';
import { PERSON_STATUSES } from '../../../utils/personStatus';

const exportFilterFields: ParamDef[] = [
  { key: 'keyword', type: 'string', desc: '姓名/身份证/手机号/地址关键词' },
  { key: 'villages', type: 'string', desc: '村庄名，逗号分隔' },
  { key: 'gridId', type: 'integer', desc: '网格 id' },
  { key: 'familyId', type: 'integer', desc: '家庭 id' },
  { key: 'gender', type: 'enum', values: ['MALE', 'FEMALE'], desc: '性别' },
  { key: 'status', type: 'enum', values: PERSON_STATUSES, desc: '人员状态' },
  { key: 'activeOnly', type: 'boolean', desc: '只导出在册，默认 true', default: true },
  { key: 'minAge', type: 'integer', desc: '最小年龄（含）', min: 0, max: 150 },
  { key: 'maxAge', type: 'integer', desc: '最大年龄（含）', min: 0, max: 150 },
  { key: 'tagIds', type: 'string', desc: '标签 id，逗号分隔' },
  { key: 'tagMode', type: 'enum', values: ['ANY', 'ALL'], desc: '多标签组合，默认 ANY', default: 'ANY' },
];

export const excelTools: ToolDef[] = [
  {
    name: 'import_task_list',
    title: '导入任务列表',
    description: '查询历史 Excel 导入任务：批次号、状态、总行数、成功/失败/转待核查条数、操作人。',
    domain: 'excel',
    scope: 'read',
    permission: 'excel:import',
    params: [
      { key: 'taskType', type: 'string', desc: '任务类型编码，不传为全部' },
      { key: 'page', type: 'integer', desc: '页码，默认 1', default: 1, min: 1 },
      { key: 'pageSize', type: 'integer', desc: '每页条数，默认 20，上限 500', default: 20, min: 1, max: 500 },
    ],
    async exec(ctx, args) {
      return paged(await ctx.call('/excel/import-tasks', args));
    },
  },
  {
    name: 'import_task_errors',
    title: '导入错误明细',
    description: '取某次导入的逐行错误（行号、错误原因、原始数据）。排查「为什么这批人没导进去」时用。',
    domain: 'excel',
    scope: 'read',
    permission: 'excel:import',
    params: [{ key: 'id', type: 'integer', desc: '导入任务 id', required: true, min: 1 }],
    async exec(ctx, args) {
      const data = shape(await ctx.call(`/excel/import-tasks/${args.id}/errors`));
      return { items: Array.isArray(data) ? data : data?.list || data };
    },
  },
  {
    name: 'import_template_catalog',
    title: '导入模板目录',
    description: '返回可用的导入类型：人员名单、重点人群名单，以及残疾/特困/低保三类专项台账，含各自的必填列与填写说明。',
    domain: 'excel',
    scope: 'read',
    permission: 'excel:import',
    params: [],
    async exec(ctx) {
      const [special, keyGroup] = await Promise.allSettled([
        ctx.call('/excel/special/types'),
        ctx.call('/excel/key-group/types'),
      ]);
      return {
        special: special.status === 'fulfilled' ? shape(special.value) : [],
        keyGroup: keyGroup.status === 'fulfilled' ? shape(keyGroup.value) : [],
      };
    },
  },
  {
    name: 'export_field_catalog',
    title: '导出可选字段',
    description: '返回人员导出支持的全部列（key 与中文名）。构造 export_create 的 fields 前先查它，避免传了后端不认的字段。',
    domain: 'excel',
    scope: 'read',
    permission: 'excel:export',
    params: [],
    async exec(ctx) {
      const data = shape(await ctx.call('/excel/export-fields'));
      return { items: Array.isArray(data) ? data : data?.list || data };
    },
  },
  {
    name: 'export_task_list',
    title: '导出任务列表',
    description: '查询历史导出任务及其状态。',
    domain: 'excel',
    scope: 'read',
    permission: 'excel:export',
    params: [],
    async exec(ctx) {
      const data = shape(await ctx.call('/excel/export-tasks'));
      return { items: Array.isArray(data) ? data : data?.list || data };
    },
  },
  {
    name: 'export_create',
    title: '发起人员导出',
    description:
      '按筛选条件生成人员 Excel 并登记导出任务，返回 taskId。**只返回任务信息，不返回文件内容**；' +
      '需要文件时由用户到「Excel 导入导出」页面下载，或在客户端用 taskId 调下载接口。' +
      '筛选条件与人口档案列表同口径。',
    domain: 'excel',
    scope: 'write',
    permission: 'excel:export',
    params: [
      ...exportFilterFields,
      { key: 'fields', type: 'string', desc: '要导出的列 key，逗号分隔；不传则导出全部字段（先用 export_field_catalog 查看）' },
    ],
    async exec(ctx, args) {
      const { fields, ...rest } = args;
      const body: Record<string, any> = { ...rest };
      if (typeof fields === 'string' && fields.trim()) {
        body.fields = fields.split(',').map((s) => s.trim()).filter(Boolean);
      }
      return shape(await ctx.send('POST', '/excel/export', body));
    },
  },
];
