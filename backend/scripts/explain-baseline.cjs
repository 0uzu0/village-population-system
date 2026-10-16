#!/usr/bin/env node
/**
 * 慢查询基线排查脚本（人工按需运行，不进 CI、不需要数据库在测试环境里）。
 *
 * 用途：把系统里最重的几条查询跑一遍 EXPLAIN，一眼看出有没有退化成全表扫描。
 * 背景：统计查询大量依赖 JOIN 与标签聚合，改 SQL 时很容易悄悄丢掉索引命中；
 *      EXPLAIN 是唯一能快速发现的手段，但把真实数据库塞进单测成本太高，
 *      因此做成独立脚本，部署后或改动 SQL 后手动跑一次即可。
 *
 * 用法（在 backend 目录）：
 *   DB_HOST=127.0.0.1 DB_USER=village DB_PASSWORD=xxx DB_NAME=village_population \
 *     node scripts/explain-baseline.cjs
 *
 * 退出码：发现对 person / person_tag / ledger_record 的全表扫描时返回 1。
 */
const path = require('path');
const fs = require('fs');
const mysql = require('mysql2/promise');

// 复用后端同款 .env 解析（项目未引 dotenv，config/env.ts 里是自研的简易实现）
(function loadEnvFile() {
  const envPath = path.resolve(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf-8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
})();

const CHECKS = [
  {
    name: '人员列表筛选（关键词 + 在册）',
    sql: `EXPLAIN SELECT p.* FROM person p
          WHERE (p.name LIKE ? OR p.id_card LIKE ? OR p.phone LIKE ? OR p.phone_backup LIKE ?)
            AND p.status IN ('NORMAL','MOVED_IN')
          ORDER BY p.id LIMIT 20`,
    params: ['%张%', '%张%', '%张%', '%张%'],
  },
  {
    name: '重点人群标签筛选（EXISTS 子查询）',
    sql: `EXPLAIN SELECT p.id FROM person p
          WHERE p.status IN ('NORMAL','MOVED_IN')
            AND EXISTS (SELECT 1 FROM person_tag pt WHERE pt.person_id = p.id AND pt.status = 'ACTIVE' AND pt.tag_id IN (1,2,3))`,
    params: [],
  },
  {
    name: '网格重点人群聚合（条件聚合，本次优化点）',
    sql: `EXPLAIN SELECT g.id,
            COUNT(DISTINCT CASE WHEN td.code IN ('PARTY_MEMBER','PARTY_PROBATIONARY') THEN p.id END) AS party_count
          FROM grid g
          LEFT JOIN person p ON p.grid_id = g.id AND p.status IN ('NORMAL','MOVED_IN')
          LEFT JOIN person_tag pt ON pt.person_id = p.id AND pt.status = 'ACTIVE'
          LEFT JOIN tag_definition td ON td.id = pt.tag_id
          WHERE g.id IN (1,2,3)
          GROUP BY g.id`,
    params: [],
  },
  {
    name: '村庄维度统计',
    sql: `EXPLAIN SELECT p.village, COUNT(DISTINCT p.id) AS person_count
          FROM person p
          LEFT JOIN person_tag pt ON pt.person_id = p.id AND pt.status = 'ACTIVE'
          LEFT JOIN tag_definition td ON td.id = pt.tag_id
          WHERE p.village IS NOT NULL AND p.village <> '' AND p.status IN ('NORMAL','MOVED_IN')
          GROUP BY p.village`,
    params: [],
  },
  {
    name: '台账列表（条口 + 时间区间）',
    sql: `EXPLAIN SELECT * FROM ledger_record
          WHERE category = ? AND record_date >= ? AND record_date <= ?
          ORDER BY record_date DESC LIMIT 20`,
    params: ['WATER', '2026-01-01', '2026-12-31'],
  },
];

/** 大表全表扫描即视为退化（小表如 grid / tag_definition 允许 ALL） */
const BIG_TABLES = new Set(['person', 'person_tag', 'ledger_record', 'family_member']);

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'village',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'village_population',
  });

  let degraded = 0;
  for (const check of CHECKS) {
    console.log(`\n=== ${check.name} ===`);
    const [rows] = await conn.query(check.sql, check.params);
    for (const r of rows) {
      const flag = r.type === 'ALL' && BIG_TABLES.has(r.table) ? '  <== 全表扫描！' : '';
      if (flag) degraded++;
      console.log(
        `  ${String(r.table).padEnd(18)} type=${String(r.type).padEnd(8)} key=${String(r.key || '-').padEnd(28)} rows=${String(r.rows).padEnd(9)} extra=${r.Extra || ''}${flag}`
      );
    }
  }

  await conn.end();

  console.log(`\n共发现 ${degraded} 处大表全表扫描`);
  if (degraded > 0) {
    console.log('建议：检查相关 WHERE/JOIN 列是否有索引（参考 V006__perf_indexes.sql），必要时补迁移。');
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('[explain-baseline] 执行失败:', err.message);
  console.error('请确认已设置 DB_HOST / DB_USER / DB_PASSWORD / DB_NAME 环境变量。');
  process.exit(1);
});
