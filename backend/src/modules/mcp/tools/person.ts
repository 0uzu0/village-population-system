/**
 * 人员域：查询、详情、变更留痕，以及建档/编辑/状态/标签四类写入。
 *
 * 口径提醒写在每个工具的 note 里而不是只写在文档里——因为模型只读得到 tools/list
 * 的 description，读不到项目文档。
 */

import { ParamDef, ToolDef } from '../types';
import { paged, shape } from '../invoke';
import { PERSON_STATUSES } from '../../../utils/personStatus';

/** 建档与编辑共用的字段。抽出来是为了「加一个字段只改一处」，避免新增字段时只补了 create 忘了 update */
const personFields: ParamDef[] = [
  { key: 'name', type: 'string', desc: '姓名', required: true },
  { key: 'idCard', type: 'string', desc: '身份证号（18 位）。与 birthDate 至少提供一个；都不提供会转入待核查而非正式建档' },
  { key: 'gender', type: 'enum', values: ['MALE', 'FEMALE'], desc: '性别。不传时由身份证推算' },
  { key: 'birthDate', type: 'string', desc: '出生日期 YYYY-MM-DD。以身份证为准，两者冲突时按身份证' },
  { key: 'phone', type: 'string', desc: '本人手机号' },
  { key: 'phoneBackup', type: 'string', desc: '备用手机号' },
  { key: 'hukouAddress', type: 'string', desc: '户籍地址' },
  { key: 'liveAddress', type: 'string', desc: '实际居住地址' },
  { key: 'village', type: 'string', desc: '所属村庄（自然村名，如 艾园村）。统计按村庄汇总时依赖此字段' },
  { key: 'gridId', type: 'integer', desc: '所属网格 id，先用 meta_options 取' },
  { key: 'familyId', type: 'integer', desc: '所属家庭 id，先用 meta_options 取' },
  { key: 'relation', type: 'string', desc: '与户主关系，如 户主 / 配偶 / 子女' },
  { key: 'status', type: 'enum', values: PERSON_STATUSES, desc: '初始状态，默认 NORMAL。日常变更请用 person_change_status（会留痕）' },
  { key: 'remark', type: 'string', desc: '备注' },
  { key: 'bankAccount', type: 'string', desc: '银行账号（重点人群台账）' },
  { key: 'subsidyAmount', type: 'number', desc: '当前应发金额（元/月）', min: 0, max: 999999.99 },
  { key: 'familyCondition', type: 'string', desc: '家庭情况描述' },
  { key: 'healthAssessment', type: 'string', desc: '身体评估结果' },
  { key: 'tagIds', type: 'string', desc: '标签 id，逗号分隔，如 "3,7"。语义是**全量覆盖**：传了就以此为准，传空串清空；不传则不动标签' },
  { key: 'disability', type: 'object', desc: '残疾专项档案对象：{ disabilityType, disabilityLevel(LEVEL_1~LEVEL_4), disabilityCard, guardianName, guardianPhone, remark }' },
  { key: 'changeReason', type: 'string', desc: '变更原因（写入变更留痕）' },
];

/** 只把真正传了的字段放进请求体：后端 PUT 是 partial 语义（未传 = 保持原值），
 *  但显式传 null 表示「清空该字段」，所以不能把 null 过滤掉。 */
function bodyOf(args: Record<string, any>, keys: string[]): Record<string, any> {
  const out: Record<string, any> = {};
  for (const k of keys) {
    if (args[k] === undefined) continue;
    if (k === 'tagIds' && typeof args[k] === 'string') {
      out[k] = args[k]
        .split(',')
        .map((s: string) => Number(s.trim()))
        .filter((n: number) => Number.isInteger(n) && n > 0);
      continue;
    }
    out[k] = args[k];
  }
  return out;
}

const FIELD_KEYS = personFields.map((f) => f.key);

export const personTools: ToolDef[] = [
  {
    name: 'person_search',
    title: '查询人员',
    description:
      '按姓名/身份证/手机号关键词、性别、网格、家庭、村庄、状态、年龄区间、标签组合查询人员，分页返回。' +
      '这是最常用的取数工具：先查清楚有哪些人，再决定是否要看详情或做汇总。',
    domain: 'person',
    scope: 'read',
    permission: 'person:view',
    note: '默认只返回在册人员（NORMAL / MOVED_IN）。要查已迁出、已死亡的历史档案，传 activeOnly=false。',
    params: [
      { key: 'keyword', type: 'string', desc: '关键词，匹配姓名、身份证号、手机号、备用手机号、户籍地址' },
      { key: 'gender', type: 'enum', values: ['MALE', 'FEMALE'], desc: '性别' },
      { key: 'gridId', type: 'integer', desc: '网格 id' },
      { key: 'familyId', type: 'integer', desc: '家庭 id' },
      { key: 'villages', type: 'string', desc: '村庄名，多个用逗号分隔，任一命中即返回' },
      { key: 'status', type: 'enum', values: PERSON_STATUSES, desc: '精确状态。传了它则以它为准，activeOnly 不再生效' },
      { key: 'activeOnly', type: 'boolean', desc: '只看在册，默认 true', default: true },
      { key: 'minAge', type: 'integer', desc: '最小年龄（含）', min: 0, max: 150 },
      { key: 'maxAge', type: 'integer', desc: '最大年龄（含）。「18 岁以下」应传 17', min: 0, max: 150 },
      { key: 'tagIds', type: 'string', desc: '标签 id，逗号分隔' },
      { key: 'tagMode', type: 'enum', values: ['ANY', 'ALL'], desc: '多标签组合方式：ANY 任一命中，ALL 全部命中，默认 ANY' },
      { key: 'sortBy', type: 'enum', values: ['id', 'name', 'personNo', 'age', 'gender', 'gridId', 'status', 'updatedAt'], desc: '排序字段，默认 id' },
      { key: 'sortOrder', type: 'enum', values: ['asc', 'desc'], desc: '排序方向，默认 asc' },
      { key: 'page', type: 'integer', desc: '页码，从 1 开始', default: 1, min: 1 },
      { key: 'pageSize', type: 'integer', desc: '每页条数，默认 20，上限 200', default: 20, min: 1, max: 200 },
    ],
    async exec(ctx, args) {
      return paged(await ctx.call('/persons', args));
    },
  },
  {
    name: 'person_get',
    title: '人员详情',
    description: '按 id 取单个人员完整档案：基本信息、户籍与居住地址、标签、残疾档案、重点人群台账字段、变更历史。',
    domain: 'person',
    scope: 'read',
    permission: 'person:view',
    params: [{ key: 'id', type: 'integer', desc: '人员 id', required: true, min: 1 }],
    async exec(ctx, args) {
      return shape(await ctx.call(`/persons/${args.id}`));
    },
  },
  {
    name: 'person_changes',
    title: '人员变更留痕',
    description: '查询某人档案的全部变更记录（谁、什么时候、把什么改成了什么）。核对「这个人为什么状态变了」时用。',
    domain: 'person',
    scope: 'read',
    permission: 'person:view',
    params: [{ key: 'id', type: 'integer', desc: '人员 id', required: true, min: 1 }],
    async exec(ctx, args) {
      return shape(await ctx.call(`/persons/${args.id}/changes`));
    },
  },

  // ---------------------------------------------------------------------
  // 写操作。默认不注册（MCP_WRITE_LEVEL=off），需部署方显式开启。
  // ---------------------------------------------------------------------
  {
    name: 'person_create',
    title: '新增人员',
    description:
      '为一位村民建档。填了身份证或出生日期即正式进入人口档案；两者都没有会被转入「待核查」而不是建档失败——这是系统的既定流程，不是错误。',
    domain: 'person',
    scope: 'write',
    permission: 'person:create',
    params: personFields,
    async exec(ctx, args) {
      return shape(await ctx.send('POST', '/persons', bodyOf(args, FIELD_KEYS)));
    },
  },
  {
    name: 'person_update',
    title: '编辑人员',
    description:
      '修改人员档案。**只传要改的字段**，未传的字段保持原值（后端是 partial 更新）；要清空某字段请显式传 null。' +
      '建议带上 rowVersion（来自 person_get）：版本对不上说明有人在之前改过，后端会拒绝并提示刷新。',
    domain: 'person',
    scope: 'write',
    permission: 'person:edit',
    note: '局部更新：不传的字段不动，传 null 才清空。rowVersion 不一致会返回 VERSION_CONFLICT。',
    params: [
      { key: 'id', type: 'integer', desc: '人员 id', required: true, min: 1 },
      { key: 'rowVersion', type: 'integer', desc: '乐观锁版本号，取自 person_get 返回的 rowVersion', min: 0 },
      ...personFields,
    ],
    async exec(ctx, args) {
      const body = bodyOf(args, [...FIELD_KEYS, 'rowVersion']);
      return shape(await ctx.send('PUT', `/persons/${args.id}`, body));
    },
  },
  {
    name: 'person_change_status',
    title: '变更人员状态',
    description:
      '把人员状态改为迁出、死亡或迁回在册。档案与标签全部保留，只在人口统计中排除。' +
      '迁出/死亡会同时停用「户籍人口」「流动人口」这类归属标签，改回在册时自动恢复。',
    domain: 'person',
    scope: 'write',
    permission: 'person:status',
    note: '状态变更不可通过再次变更以外的任何方式撤销，原因会写入留痕。',
    params: [
      { key: 'id', type: 'integer', desc: '人员 id', required: true, min: 1 },
      { key: 'status', type: 'enum', values: PERSON_STATUSES, desc: '目标状态', required: true },
      { key: 'statusDate', type: 'string', desc: '生效日期 YYYY-MM-DD。迁出/死亡不传则取当天；改回在册不传则清空' },
      { key: 'reason', type: 'string', desc: '变更原因，写入留痕' },
    ],
    async exec(ctx, args) {
      return shape(
        await ctx.send('POST', `/persons/${args.id}/status`, {
          status: args.status,
          statusDate: args.statusDate,
          reason: args.reason,
        })
      );
    },
  },
  {
    name: 'person_tag_add',
    title: '给人员打标签',
    description: '给一位在册人员添加标签（党员、低保、残疾、退役军人类）。互斥组内已存在更高优先级标签时会被拒绝。',
    domain: 'person',
    scope: 'write',
    permission: 'tag:manage',
    params: [
      { key: 'id', type: 'integer', desc: '人员 id', required: true, min: 1 },
      { key: 'tagId', type: 'integer', desc: '标签 id，先用 tag_list 取', required: true, min: 1 },
      { key: 'basis', type: 'string', desc: '认定依据' },
      { key: 'effectDate', type: 'string', desc: '生效日期 YYYY-MM-DD' },
      { key: 'expireDate', type: 'string', desc: '失效日期 YYYY-MM-DD' },
    ],
    async exec(ctx, args) {
      const { id, ...body } = args;
      return shape(await ctx.send('POST', `/persons/${id}/tags`, body));
    },
  },
  {
    name: 'person_tag_remove',
    title: '移除人员标签',
    description: '移除某人的一个标签关联。linkId 来自 person_get 返回的 tags[].linkId（注意不是标签本身的 id）。',
    domain: 'person',
    scope: 'write',
    permission: 'tag:manage',
    params: [
      { key: 'id', type: 'integer', desc: '人员 id', required: true, min: 1 },
      { key: 'linkId', type: 'integer', desc: '标签关联 id（tags[].linkId）', required: true, min: 1 },
    ],
    async exec(ctx, args) {
      return shape(await ctx.send('DELETE', `/persons/${args.id}/tags/${args.linkId}`));
    },
  },
];
