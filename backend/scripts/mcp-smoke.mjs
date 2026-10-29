#!/usr/bin/env node
/**
 * MCP 线上冒烟：把当前账号能看到的**每个工具**真打一次，报告成功/失败。
 *
 * 为什么需要它：这个项目的 MCP 工具不查库，而是用调用者身份回请求自己的 REST，
 * 单测在 `ctx.call` 那层就 mock 掉了，所以「路径拼错、前缀漏了、后端没这个接口」
 * 这类问题在单测里一律表现为绿色。曾真实发生：内部转发漏了 /api 前缀，
 * 37 个工具全部 404，而 490 条单测全绿。
 *
 * 所以上线后必须跑这一遍。它不是替代单测，而是补上单测结构上够不到的那一层。
 *
 * 用法：
 *   MCP_URL=https://work.example.com/api/mcp \
 *   MCP_TOKEN=vpm_xxx \
 *   node scripts/mcp-smoke.mjs
 *
 * 只读令牌即可运行；写入工具不会出现在清单里，自然也不会被调用。
 * 退出码：全部通过 0，有失败 1（可直接接进部署后的检查步骤）。
 */

const URL_ = process.env.MCP_URL;
const TOKEN = process.env.MCP_TOKEN;

if (!URL_ || !TOKEN) {
  console.error('缺少环境变量：需要 MCP_URL 与 MCP_TOKEN');
  process.exit(2);
}

const HEADERS = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };

/** 发一次 JSON-RPC，返回原始响应（不抛业务错，交给调用方判断） */
async function rpc(body) {
  const res = await fetch(URL_, { method: 'POST', headers: HEADERS, body: JSON.stringify(body) });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { parseError: true, status: res.status, body: text.slice(0, 300) };
  }
}

/** 调一个工具，把 content[0].text 解析回对象，并保留 isError 标记 */
async function callTool(name, args) {
  const d = await rpc({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });
  if (d.error) return { _rpcError: d.error };
  const r = d.result || {};
  const text = (r.content || [{}])[0]?.text ?? '';
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = { _raw: text.slice(0, 200) };
  }
  payload._isError = Boolean(r.isError);
  return payload;
}

const first = (arr) => (Array.isArray(arr) && arr.length ? arr[0] : {});

/**
 * 采集真实 id：带必填 id 的工具（person_get 等）不能瞎填，
 * 否则测的是「id 不存在」而不是「这个工具通不通」。
 */
async function harvest() {
  const ids = {};
  ids.person = first((await callTool('person_search', { pageSize: 1 })).items).id;
  ids.family = first((await callTool('family_search', { pageSize: 1 })).items).id;
  ids.grid = first((await callTool('grid_list', { pageSize: 1 })).items).id;
  ids.ledger = first((await callTool('ledger_list', { pageSize: 1 })).items).id;
  ids.pending = first((await callTool('pending_list', { pageSize: 1 })).items).id;
  ids.import = first((await callTool('import_task_list', { pageSize: 1 })).items).id;
  ids.tag = first((await callTool('tag_list', { pageSize: 1 })).items).id;
  return ids;
}

/** 工具名 → 它的 id 参数该用哪个业务对象 */
const ID_OF = {
  person_get: 'person',
  person_changes: 'person',
  family_get: 'family',
  grid_get: 'grid',
  ledger_get: 'ledger',
  pending_get: 'pending',
  import_task_errors: 'import',
};

/** 少数工具需要具体取值，靠通用规则填不出来 */
const override = (ids) => ({
  dict_lookup: { type: 'person_status' },
  tag_history: { objectType: 'PERSON', objectId: ids.person, tagId: ids.tag },
  file_list: { bizType: 'PERSON', bizId: ids.person },
  audit_search: { result: 'SUCCESS' },
});

/** 按参数声明补默认值：分页取小值，枚举取第一个，必填整数兜底 1 */
function buildArgs(tool, ids) {
  const args = { ...(override(ids)[tool.name] || {}) };
  for (const p of tool.params || []) {
    const { key, type, required, default: def, values } = p;
    if (def !== undefined && args[key] === undefined) continue; // 让后端用自己的默认值
    if (args[key] !== undefined) continue;

    if (type === 'integer') {
      if (key === 'page') args.page = 1;
      else if (key === 'pageSize') args.pageSize = 2;
      else if (key === 'id') {
        const id = ids[ID_OF[tool.name]];
        if (id != null) args.id = id;
        else return { args, missing: 'id' };
      } else if (required) args[key] = 1;
    } else if (type === 'enum' && required) {
      args[key] = (values || [])[0];
    }
  }
  // 值为空的对象不要发，让后端报它自己的参数错误，别被我们伪造的 null 干扰
  for (const k of Object.keys(args)) if (args[k] == null) delete args[k];
  return { args };
}

async function main() {
  // 1) 能力清单：顺带确认写入档位与脱敏档位，这两项配错比工具坏更难发现
  const mfRes = await fetch(`${URL_}/manifest`, { headers: HEADERS });
  if (!mfRes.ok) {
    console.error(`manifest 请求失败：HTTP ${mfRes.status}`);
    process.exit(1);
  }
  const mf = await mfRes.json();
  if (mf.code !== 0) {
    console.error('manifest 异常：', JSON.stringify(mf).slice(0, 300));
    process.exit(1);
  }
  const meta = mf.data;
  console.log(`服务 ${meta.server.name} v${meta.server.version}`);
  console.log(
    `协议 ${meta.protocol}｜写入档位 ${meta.writeLevel}（实际 ${meta.effectiveWriteLevel}）｜脱敏 ${meta.piiMode}`
  );
  console.log(`令牌 ${meta.token ? `#${meta.token.id} ${meta.token.name} / ${meta.token.scope}` : '（JWT 登录态）'}`);
  console.log(`可见工具 ${meta.total} 个\n`);

  // 2) 采 id，3) 逐个真打
  const ids = await harvest();
  console.log('采集到 id：', JSON.stringify(ids), '\n');

  const rows = [];
  let failed = 0;
  for (const tool of meta.tools) {
    const { args, missing } = buildArgs(tool, ids);
    if (missing) {
      rows.push([tool.name, 'SKIP', `缺 ${missing}`]);
      continue;
    }
    const r = await callTool(tool.name, args);
    if (r._rpcError) {
      failed++;
      rows.push([tool.name, 'FAIL', `${r._rpcError.code} ${r._rpcError.message}`]);
    } else if (r._isError) {
      failed++;
      rows.push([tool.name, 'FAIL', `${r.code || '-'} ${String(r.error).slice(0, 70)}`]);
    } else if (Array.isArray(r.items)) {
      rows.push([tool.name, 'OK', `${r.items.length} 条 / total=${r.total}`]);
    } else if (r.total !== undefined) {
      rows.push([tool.name, 'OK', `total=${r.total}`]);
    } else {
      rows.push([
        tool.name,
        'OK',
        `keys=${Object.keys(r)
          .filter((k) => k !== '_isError')
          .slice(0, 6)}`,
      ]);
    }
  }

  const w = Math.max(...rows.map((r) => r[0].length));
  for (const [name, status, info] of rows) console.log(`${status.padEnd(5)} ${name.padEnd(w)}  ${info}`);

  const ok = rows.filter((r) => r[1] === 'OK').length;
  const skip = rows.filter((r) => r[1] === 'SKIP').length;
  console.log(`\n汇总：OK ${ok} / FAIL ${failed} / SKIP ${skip} / 共 ${rows.length}`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error('冒烟脚本异常：', e);
  process.exit(1);
});
