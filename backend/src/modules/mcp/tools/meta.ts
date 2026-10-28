/**
 * 元数据域：系统自描述、下拉字典、字典项查询。
 *
 * 这一组工具的价值不在「多查一个接口」，而在**降低模型的试错成本**：
 * 先拿到网格/家庭/标签的真实 id，再去做筛选，比让模型猜 id 靠谱得多。
 */

import { ToolDef } from '../types';
import { shape } from '../invoke';

export const metaTools: ToolDef[] = [
  {
    name: 'system_capabilities',
    title: '系统能力与当前账号',
    description:
      '返回当前登录账号（姓名、角色、权限码）、本 MCP 服务版本与当前可用的工具清单。' +
      '开始一段新对话、或不确定自己能用哪些功能时先调用它。',
    domain: 'meta',
    scope: 'read',
    permission: 'person:view',
    params: [],
    async exec(ctx) {
      const me = await ctx.call('/auth/me');
      return {
        user: shape(me),
        server: { name: 'village-population-mcp', version: '1.0.0', protocol: '2025-03-26' },
        toolCount: ctx.catalog.length,
        tools: ctx.catalog,
        note: '工具清单已按当前账号权限过滤：清单里没有的，就是本账号无权使用的。',
      };
    },
  },
  {
    name: 'meta_options',
    title: '基础字典（网格/家庭/标签分类）',
    description:
      '一次性拿到建档与筛选所需的全部基础数据：网格列表（id、名称、编号）、家庭列表（id、户号、户主）、标签分类。' +
      '要按网格或家庭筛选人员前，先用它取 id。',
    domain: 'meta',
    scope: 'read',
    permission: 'person:view',
    params: [],
    async exec(ctx) {
      // 三个接口的权限码不同（person:view / ledger:view / tag:view），
      // 用 allSettled 而不是 all：缺哪个就少返回一块，不让整次调用失败——
      // 网格员往往没有 ledger:view，但取网格列表对他是刚需。
      const [options, ledgerMeta, categories] = await Promise.allSettled([
        ctx.call('/persons/meta/options'),
        ctx.call('/ledgers/meta'),
        ctx.call('/tags/categories'),
      ]);

      const unavailable: string[] = [];
      if (options.status === 'rejected') unavailable.push('网格与家庭（需要 person:view）');
      if (ledgerMeta.status === 'rejected') unavailable.push('台账条口（需要 ledger:view）');
      if (categories.status === 'rejected') unavailable.push('标签分类（需要 tag:view）');

      return {
        ...(options.status === 'fulfilled' ? shape(options.value) : {}),
        ledgerCategories: ledgerMeta.status === 'fulfilled' ? shape(ledgerMeta.value) : undefined,
        tagCategories: categories.status === 'fulfilled' ? shape(categories.value) : undefined,
        ...(unavailable.length ? { unavailable } : {}),
      };
    },
  },
  {
    name: 'dict_lookup',
    title: '字典项查询',
    description: '按类型查询系统字典（sys_dict），用于解释界面上的枚举值含义。type 例如 person_status、gender。',
    domain: 'meta',
    scope: 'read',
    permission: 'dashboard:view',
    params: [{ key: 'type', type: 'string', desc: '字典类型编码', required: true }],
    async exec(ctx, args) {
      return shape(await ctx.call(`/audit-logs/dicts/${encodeURIComponent(args.type)}`));
    },
  },
];
