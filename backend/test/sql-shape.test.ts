import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const SRC_DIR = path.resolve(__dirname, '../src');

/** 递归收集目录下所有 .ts 文件 */
function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

/** 从 openIdx（指向 '('）开始读取一对平衡括号，返回括号内的内容与结束下标；跳过字符串字面量内的括号 */
function readBalanced(src: string, openIdx: string): { content: string; endIdx: number } {
  let depth = 0;
  let i = openIdx;
  let inQuote: string | null = null;
  for (; i < src.length; i++) {
    const c = src[i];
    if (inQuote) {
      if (c === inQuote) {
        // '' 或 "" 表示转义，不当作结束
        if (src[i + 1] === inQuote) { i++; continue; }
        inQuote = null;
      }
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { inQuote = c; continue; }
    if (c === '(') depth++;
    else if (c === ')') {
      depth--;
      if (depth === 0) return { content: src.slice(openIdx + 1, i), endIdx: i };
    }
  }
  throw new Error('括号未闭合');
}

/** 按顶层逗号切分（忽略引号内与嵌套括号内的逗号） */
function splitTopLevel(src: string): string[] {
  const items: string[] = [];
  let depth = 0;
  let buf = '';
  let inQuote: string | null = null;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuote) {
      buf += c;
      if (c === inQuote) {
        if (src[i + 1] === inQuote) { buf += src[i + 1]; i++; continue; }
        inQuote = null;
      }
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { inQuote = c; buf += c; continue; }
    if (c === '(' || c === '[') depth++;
    if (c === ')' || c === ']') depth--;
    if (c === ',' && depth === 0) { items.push(buf.trim()); buf = ''; continue; }
    buf += c;
  }
  if (buf.trim()) items.push(buf.trim());
  return items;
}

interface InsertStmt {
  file: string;
  table: string;
  columns: string[];
  rows: string[][];
}

/** 提取形如 INSERT [IGNORE] INTO t (cols) VALUES (...)[,(...)] 的语句（只取带列清单的） */
function extractInserts(file: string, src: string): InsertStmt[] {
  const stmts: InsertStmt[] = [];
  const re = /INSERT\s+(?:IGNORE\s+)?INTO\s+`?([A-Za-z_]\w*)`?\s*\(/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const table = m[1];
    let cols: string[];
    let endIdx: number;
    try {
      const balanced = readBalanced(src, m.index + m[0].length - 1);
      cols = splitTopLevel(balanced.content);
      endIdx = balanced.endIdx;
    } catch {
      continue;
    }
    if (!cols.length || cols.some((c) => !c)) continue; // 非列清单（如函数调用）跳过

    // VALUES 的查找必须限制在当前 SQL 字符串字面量之内。
    // 批量写入的 VALUES 是运行时拼接的（`VALUES ${rows.map(...)}`），若不加边界，
    // 搜索会一路向后跑到下一条语句的 VALUES 上，导致张冠李戴的误报。
    const nextTick = src.indexOf('`', endIdx);
    const windowEnd = nextTick === -1 ? src.length : nextTick;
    const rest = src.slice(endIdx, windowEnd);

    const vIdx = rest.search(/\bVALUES\s*\(/i);
    if (vIdx < 0) continue; // 运行时拼接的 VALUES / INSERT ... SELECT 不做检查
    const openParen = endIdx + vIdx + rest.slice(vIdx).indexOf('(');
    let values: string;
    try {
      values = readBalanced(src, openParen).content;
    } catch {
      continue;
    }

    const top = splitTopLevel(values);
    // VALUES (a,b),(c,d) 多行写法：顶层项本身是括号组
    const rows: string[][] = [];
    if (top.length === 1 && top[0].startsWith('(')) {
      for (const row of top) rows.push(splitTopLevel(row.slice(1, -1)));
    } else {
      rows.push(top);
    }
    stmts.push({ file, table, columns: cols, rows });
  }
  return stmts;
}

describe('INSERT 语句形状校验（列数 = 值数）', () => {
  const files = walk(SRC_DIR);

  it('扫描到源码文件', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it('每条 INSERT 的列数与每行的值数一致', () => {
    const problems: string[] = [];
    for (const file of files) {
      const src = fs.readFileSync(file, 'utf8');
      for (const st of extractInserts(file, src)) {
        for (const row of st.rows) {
          if (row.length !== st.columns.length) {
            problems.push(
              `${path.relative(SRC_DIR, file)} :: INSERT INTO ${st.table}\n` +
                `  列 ${st.columns.length} 个（${st.columns.join(', ')}）\n` +
                `  值 ${row.length} 个（${row.join(', ')}）`
            );
          }
        }
      }
    }
    // 一次性输出全部问题，便于批量修复
    if (problems.length) {
      throw new Error(`发现 ${problems.length} 处列数/值数不一致：\n\n${problems.join('\n\n')}`);
    }
  });

  it('人口导入的人员 INSERT 列清单与行模板对齐（本次事故回归）', () => {
    const src = fs.readFileSync(path.join(SRC_DIR, 'modules/excel/importPerson.ts'), 'utf8');
    // 批量写入后 VALUES 部分是运行时拼接的，这里分别校验「列清单」与「单行值模板」
    const mCols = src.match(/\bINSERT INTO person \(([\s\S]*?)\)\s*VALUES/);
    expect(mCols, '未找到 person 的 INSERT 列清单').toBeTruthy();
    const cols = splitTopLevel(mCols![1]).map((c) => c.trim());
    expect(cols).toEqual([
      'person_no', 'name', 'gender', 'birth_date', 'id_card', 'phone', 'phone_backup',
      'hukou_address', 'live_address', 'village', 'grid_id', 'family_id', 'relation',
      'status', 'data_source', 'created_by', 'updated_by',
    ]);

    // 单行值模板 PERSON_ROW_VALUES：16 个占位符 + data_source 一个字面量
    const m = src.match(/const PERSON_ROW_VALUES\s*=\s*`([^`]+)`/);
    expect(m).toBeTruthy();
    const rowValues = m![1];
    const placeholders = (rowValues.match(/\?/g) || []).length;
    const literals = rowValues.split(',').filter((v) => v.trim() && !v.includes('?')).length;
    // v2.3 起 status 从字面量改成占位符（导入模板新增「人员状态」列），
    // 所以占位符 15 → 16、字面量 2 → 1，合计仍是 17 列。
    expect(placeholders).toBe(16);
    expect(literals).toBe(1);
    expect(placeholders + literals).toBe(cols.length);
  });

  it('批量写入的占位符个数与对应列数一致（分片拼接回归）', () => {
    // 拆分后这两条写入语句分处不同文件：人口导入写 import_pending，名单导入写 person_tag
    const src = [
      fs.readFileSync(path.join(SRC_DIR, 'modules/excel/importPerson.ts'), 'utf8'),
      fs.readFileSync(path.join(SRC_DIR, 'modules/excel/importKeyGroup.ts'), 'utf8'),
    ].join('\n');
    // import_pending 20 列 → 单行模板 20 个占位符；person_tag 6 列；tag_change_log 6 列
    // （v2.3 给 import_pending 追加了 person_status / tag_ids 两列，18 → 20）
    const cases: { cols: number; re: RegExp }[] = [
      { cols: 20, re: /import_pending \(batch_no[\s\S]*?VALUES \$\{chunk\.map\(\(\) => '(\([^']*\))'\)/ },
      { cols: 6, re: /person_tag \(person_id, tag_id, effect_date, status, basis, created_by\)\s*\n\s*VALUES \$\{chunk\.map\(\(\) => '(\([^']*\))'\)/ },
    ];
    for (const c of cases) {
      const m = src.match(c.re);
      expect(m, `未匹配到批量写入语句: ${c.re}`).toBeTruthy();
      const ph = (m![1].match(/\?/g) || []).length;
      expect(ph).toBe(c.cols);
    }
  });
});
