/**
 * MCP 开关解析的测试。
 *
 * 这些用例看起来很琐碎（空格、引号、大小写），但它们对应的都是真实故障：
 * 2026-10-29 线上把 MCP_PII_MODE 改成 full 后接口仍返回打码，原因就是
 * `.env` 里的写法没被严格相等比较认出来，而退回的默认值更安全、系统不报错，
 * 于是「改了没生效」只能靠人肉怀疑。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  destructiveAllowed,
  envValue,
  mcpConfigWarnings,
  piiMode,
  switchInfo,
  writeLevel,
} from '../src/modules/mcp/config';

const KEYS = ['MCP_PII_MODE', 'MCP_WRITE_LEVEL', 'MCP_ALLOW_DESTRUCTIVE'] as const;

/** 逐个值跑一遍，避免测试之间互相污染 */
function withEnv(key: string, value: string | undefined, fn: () => void): void {
  const prev = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
  try {
    fn();
  } finally {
    if (prev === undefined) delete process.env[key];
    else process.env[key] = prev;
  }
}

beforeEach(() => {
  for (const k of KEYS) delete process.env[k];
});

afterEach(() => {
  for (const k of KEYS) delete process.env[k];
});

describe('envValue：把 .env 里各种手写写法归一', () => {
  it('原样取值', () => {
    withEnv('MCP_PII_MODE', 'full', () => expect(envValue('MCP_PII_MODE')).toBe('full'));
  });

  it('去掉成对的双引号', () => {
    withEnv('MCP_PII_MODE', '"full"', () => expect(envValue('MCP_PII_MODE')).toBe('full'));
  });

  it('去掉成对的单引号', () => {
    withEnv('MCP_PII_MODE', "'full'", () => expect(envValue('MCP_PII_MODE')).toBe('full'));
  });

  it('去掉引号 + 引号内的空格', () => {
    withEnv('MCP_PII_MODE', '  " full "  ', () => expect(envValue('MCP_PII_MODE')).toBe('full'));
  });

  it('去掉尾随空格（手改 .env 最常见的失误）', () => {
    withEnv('MCP_PII_MODE', 'full  ', () => expect(envValue('MCP_PII_MODE')).toBe('full'));
  });

  it('去掉 CRLF 留下的 \\r（Windows 编辑器保存 .env）', () => {
    withEnv('MCP_PII_MODE', 'full\r', () => expect(envValue('MCP_PII_MODE')).toBe('full'));
  });

  it('大小写归一', () => {
    withEnv('MCP_PII_MODE', 'FULL', () => expect(envValue('MCP_PII_MODE')).toBe('full'));
  });

  it('未设置时是空串', () => {
    expect(envValue('MCP_PII_MODE')).toBe('');
  });
});

describe('piiMode：只有明确写 full 才关打码', () => {
  const toFull = ['full', 'FULL', ' full ', '"full"', "'full'", 'Full', 'full\r', '"full"\r'];

  for (const raw of toFull) {
    it(`认得出 ${JSON.stringify(raw)}`, () => {
      withEnv('MCP_PII_MODE', raw, () => expect(piiMode()).toBe('full'));
    });
  }

  const toMask = [undefined, '', 'mask', 'true', 'yes', 'full2', 'off'];
  for (const raw of toMask) {
    it(`${JSON.stringify(raw)} 仍按 mask`, () => {
      withEnv('MCP_PII_MODE', raw, () => expect(piiMode()).toBe('mask'));
    });
  }
});

describe('writeLevel：写错一律退回最严的 off', () => {
  it('basic', () => {
    withEnv('MCP_WRITE_LEVEL', ' Basic ', () => expect(writeLevel()).toBe('basic'));
  });

  it('full（带引号）', () => {
    withEnv('MCP_WRITE_LEVEL', '"full"', () => expect(writeLevel()).toBe('full'));
  });

  it('未设置 → off', () => {
    expect(writeLevel()).toBe('off');
  });

  it('垃圾值 → off，而不是抛错', () => {
    withEnv('MCP_WRITE_LEVEL', 'fulll', () => expect(writeLevel()).toBe('off'));
  });
});

describe('destructiveAllowed：true/1/yes/on 都算开', () => {
  for (const raw of ['true', 'TRUE', ' true ', '1', 'yes', 'on']) {
    it(`${JSON.stringify(raw)} → true`, () => {
      withEnv('MCP_ALLOW_DESTRUCTIVE', raw, () => expect(destructiveAllowed()).toBe(true));
    });
  }

  for (const raw of [undefined, '', 'false', '0', 'no']) {
    it(`${JSON.stringify(raw)} → false`, () => {
      withEnv('MCP_ALLOW_DESTRUCTIVE', raw, () => expect(destructiveAllowed()).toBe(false));
    });
  }
});

describe('switchInfo / mcpConfigWarnings：配置写错要能自己说出来', () => {
  it('保留原始值，便于一眼看出是写法问题', () => {
    withEnv('MCP_PII_MODE', '"full"', () => {
      const info = switchInfo('MCP_PII_MODE');
      expect(info.raw).toBe('"full"'); // 原样
      expect(info.value).toBe('full'); // 归一
      expect(info.effective).toBe('full');
      expect(info.recognized).toBe(true);
    });
  });

  it('认不出的值要标记 recognized=false 并保留原样', () => {
    withEnv('MCP_PII_MODE', 'full ', () => {
      // 归一后能认出来，所以不算错——这正是不该误报的边界
      expect(switchInfo('MCP_PII_MODE').recognized).toBe(true);
    });
    withEnv('MCP_PII_MODE', 'idential', () => {
      const info = switchInfo('MCP_PII_MODE');
      expect(info.recognized).toBe(false);
      expect(info.effective).toBe('mask');
      expect(info.raw).toBe('idential');
    });
  });

  it('全部写对时没有任何告警', () => {
    process.env.MCP_PII_MODE = 'full';
    process.env.MCP_WRITE_LEVEL = 'off';
    process.env.MCP_ALLOW_DESTRUCTIVE = 'false';
    expect(mcpConfigWarnings()).toEqual([]);
  });

  it('写错时告警里带上原始值、键名与生效值', () => {
    process.env.MCP_WRITE_LEVEL = 'basik';
    const warnings = mcpConfigWarnings();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/MCP_WRITE_LEVEL/);
    expect(warnings[0]).toMatch(/basik/);
    expect(warnings[0]).toMatch(/off/);
  });
});

describe('接线守卫：不许在别处再手写严格比较', () => {
  const SRC = path.resolve(__dirname, '../src');
  const CONFIG = path.join(SRC, 'modules/mcp/config.ts');

  function walk(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) return walk(full);
      return e.name.endsWith('.ts') ? [full] : [];
    });
  }

  it('MCP 的三个开关只在 config.ts 里读 process.env', () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      if (file === CONFIG) continue;
      const src = fs.readFileSync(file, 'utf8');
      // MCP_INTERNAL_BASE 是地址不是开关，允许在 invoke.ts 里直接读
      const hits = src.match(/process\.env\.MCP_(?!INTERNAL_BASE)/g);
      if (hits) offenders.push(`${path.relative(SRC, file)} (${hits.length} 处)`);
    }
    expect(offenders, '开关解析必须走 config.ts，否则又会出现「写法差一点就静默失效」').toEqual([]);
  });

  it('config.ts 自己也不再用 === 直接比环境变量原文', () => {
    const src = fs
      .readFileSync(CONFIG, 'utf8')
      // 注释里写反例是允许的，只检查真正的代码
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');
    // 所有比较都必须经过 envValue/envRaw，不出现裸的严格比较
    expect(src).not.toMatch(/process\.env\.[A-Z_]+\s*===/);
  });
});
