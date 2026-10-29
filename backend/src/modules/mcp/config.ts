/**
 * MCP 运行时开关的解析。
 *
 * 为什么要单独一个文件、而不是各处直接拿环境变量和 'full' 做严格相等比较：
 * 这些值来自部署机上的 `deploy/.env`，是**人手工写**的。写法稍有出入——
 * `MCP_PII_MODE="full"`（带引号）、`=full `（尾随空格）、Windows 编辑器留下的
 * `=full\r`、或者写成 `FULL`——严格相等比较就会静默地判为「没配」，退回默认值。
 *
 * 这种失败特别恶心：退回的默认值（mask / off）都是更安全的一侧，所以系统不报错、
 * 日志没有异常、工具照常工作，只有人肉发现「我明明改了它怎么还是打码」。
 * 2026-10-29 线上就撞了一次：用户把 .env 改成 full，接口仍返回打码。
 *
 * 所以这里做三件事：
 * 1. **归一**：去空白、去包裹引号、转小写，四种写法都能认；
 * 2. **单点**：所有开关从这一处读，不再散落各模块各写一个三元表达式；
 * 3. **可自查**：把「原始值 + 是否被识别」暴露给 /api/mcp/manifest，
 *    并在启动时对无法识别的取值打一条 warn——下次不用猜。
 */

/** 允许的 MCP 环境变量，集中声明便于启动自检遍历 */
const MCP_ENV_KEYS = ['MCP_WRITE_LEVEL', 'MCP_PII_MODE', 'MCP_ALLOW_DESTRUCTIVE'] as const;

export type PiiMode = 'mask' | 'full';
export type WriteLevel = 'off' | 'basic' | 'full';

/** 取原始字符串（未做任何处理），用于诊断展示 */
export function envRaw(name: string): string {
  return process.env[name] ?? '';
}

/**
 * 归一后的取值：去首尾空白 → 去掉成对包裹的引号 → 再去空白 → 转小写。
 *
 * 只剥一层引号：`.env` 里没人会写三层，写多了反而可能吃掉合法字符。
 * 换行符 \r 属于空白字符，`trim()` 一并处理掉，所以 CRLF 的 .env 也能用。
 */
export function envValue(name: string): string {
  let v = envRaw(name).trim();
  const quoted = (v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"));
  if (quoted) v = v.slice(1, -1).trim();
  return v.toLowerCase();
}

/** 生效的脱敏模式：只有明确写成 full 才关掉打码，其余一切（含空、含写错）都是 mask */
export function piiMode(): PiiMode {
  return envValue('MCP_PII_MODE') === 'full' ? 'full' : 'mask';
}

/** 生效的写入等级：off / basic / full 三档，写错一律按最严的 off 处理 */
export function writeLevel(): WriteLevel {
  const v = envValue('MCP_WRITE_LEVEL');
  return v === 'basic' || v === 'full' ? v : 'off';
}

/**
 * 删除类操作是否放行。
 * 与 MCP_WRITE_LEVEL 分开是刻意的：允许 AI 建档不代表允许它删人。
 * 接受 true/1/yes —— 这几种写法都表达同一个意思，没必要因为写了 1 就判成关。
 */
export function destructiveAllowed(): boolean {
  const v = envValue('MCP_ALLOW_DESTRUCTIVE');
  return v === 'true' || v === '1' || v === 'yes' || v === 'on';
}

/** 各开关的原始值与识别结果，给 /manifest 与启动自检用 */
export interface SwitchInfo {
  /** 归一前的原样字符串（含可能的引号/空白），便于一眼看出写法问题 */
  raw: string;
  /** 归一后的值 */
  value: string;
  /** 是否落在允许取值内；false 表示「写了但没认出来」，实际生效的是默认值 */
  recognized: boolean;
  /** 实际生效值 */
  effective: string;
}

const ALLOWED: Record<(typeof MCP_ENV_KEYS)[number], string[]> = {
  // 空串 = 没配，按默认值处理，算合法
  MCP_WRITE_LEVEL: ['', 'off', 'basic', 'full'],
  MCP_PII_MODE: ['', 'mask', 'full'],
  MCP_ALLOW_DESTRUCTIVE: ['', 'true', 'false', '1', '0', 'yes', 'no', 'on', 'off'],
};

export function switchInfo(name: (typeof MCP_ENV_KEYS)[number]): SwitchInfo {
  const value = envValue(name);
  const effective =
    name === 'MCP_WRITE_LEVEL' ? writeLevel() : name === 'MCP_PII_MODE' ? piiMode() : String(destructiveAllowed());
  return { raw: envRaw(name), value, recognized: ALLOWED[name].includes(value), effective };
}

/**
 * 启动自检：把「写了但没认出来」的开关喊出来。
 *
 * 为什么值得单独一条日志：这类配置错误的表现是「功能按默认值运行」，
 * 而不是崩溃，所以不看日志永远发现不了。返回问题列表也便于单测断言。
 */
export function mcpConfigWarnings(): string[] {
  const warnings: string[] = [];
  for (const key of MCP_ENV_KEYS) {
    const info = switchInfo(key);
    if (!info.recognized) {
      warnings.push(`${key} 的取值 ${JSON.stringify(info.raw)} 无法识别，已按默认值 ${info.effective} 运行`);
    }
  }
  return warnings;
}
