/**
 * 工具注册表。
 *
 * 新增一个工具的唯一动作：在 tools/ 下写一个 ToolDef 并加进对应数组。
 * 这里不写任何业务逻辑，只做三件事——汇总、按开关过滤、按可见性过滤。
 */

import { ToolDef, ToolScope } from './types';
import { metaTools } from './tools/meta';
import { personTools } from './tools/person';
import { keygroupTools } from './tools/keygroup';
import { familyTools } from './tools/family';
import { gridTools } from './tools/grid';
import { tagTools } from './tools/tag';
import { statisticsTools } from './tools/statistics';
import { ledgerTools } from './tools/ledger';
import { pendingTools } from './tools/pending';
import { excelTools } from './tools/excel';
import { adminTools } from './tools/admin';

/** 全部工具，顺序即 tools/list 的返回顺序：按「先看全局，再看明细，最后动数据」排 */
export const ALL_TOOLS: ToolDef[] = [
  ...metaTools,
  ...statisticsTools,
  ...personTools,
  ...keygroupTools,
  ...familyTools,
  ...gridTools,
  ...tagTools,
  ...ledgerTools,
  ...pendingTools,
  ...excelTools,
  ...adminTools,
];

/** 写入开关。默认 off：绝大多数使用场景是「查」，写操作应当由部署方显式开启 */
export type WriteLevel = 'off' | 'basic' | 'full';

export function writeLevel(): WriteLevel {
  const raw = (process.env.MCP_WRITE_LEVEL || 'off').toLowerCase();
  return raw === 'basic' || raw === 'full' ? raw : 'off';
}

/**
 * 危险操作是否放行。
 *
 * 与 MCP_WRITE_LEVEL 分开成两个开关是刻意的：删除人员、删台账、批量改状态这类
 * 动作（danger）一旦误触发无法撤销。只开 basic/full 表示「允许 AI 建档、记账」，
 * 不等于「允许它删数据」。要删必须再显式写一行 MCP_ALLOW_DESTRUCTIVE=true。
 */
function destructiveAllowed(): boolean {
  return process.env.MCP_ALLOW_DESTRUCTIVE === 'true';
}

/** 该等级下是否注册此工具 */
export function isEnabled(tool: ToolDef, level: WriteLevel = writeLevel()): boolean {
  if (tool.scope === 'read') return true;
  if (tool.scope === 'write') return level === 'basic' || level === 'full';
  return level === 'full' && destructiveAllowed();
}

/** 当前部署实际开放的工具 */
export function enabledTools(level: WriteLevel = writeLevel()): ToolDef[] {
  return ALL_TOOLS.filter((t) => isEnabled(t, level));
}

/**
 * 当前账号可见的工具。
 *
 * 看不到 = 调不到：没权限的工具直接从 tools/list 里消失，而不是列出来再报 403。
 * 这样模型不会反复尝试一个注定失败的调用，也不会向用户描述「系统有但我不能用」的
 * 功能清单——那种回答只会让人困惑。
 */
export function visibleTools(
  user: { isAdmin: boolean; permissions: Set<string> },
  level: WriteLevel = writeLevel()
): ToolDef[] {
  return enabledTools(level).filter((t) => user.isAdmin || user.permissions.has(t.permission));
}

/** 按数据域分组，供 manifest 与文档使用 */
export function groupByDomain(tools: ToolDef[]): Record<string, Array<{ name: string; title: string; scope: ToolScope }>> {
  const out: Record<string, Array<{ name: string; title: string; scope: ToolScope }>> = {};
  for (const t of tools) {
    if (!out[t.domain]) out[t.domain] = [];
    out[t.domain].push({ name: t.name, title: t.title, scope: t.scope });
  }
  return out;
}
