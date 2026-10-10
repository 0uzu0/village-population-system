import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { splitStatements } from '../src/db/migrate';

const MIGRATIONS_DIR = path.resolve(__dirname, '../src/db/migrations');

describe('迁移 SQL 解析器 splitStatements', () => {
  it('字符串字面量内的分号不会被误当语句分隔符', () => {
    const sql = `INSERT INTO t (remark) VALUES ('含分号;的内容');
INSERT INTO t (remark) VALUES ('含转义引号 \\' 的内容');
UPDATE t SET remark = 'it''s fine';`;
    const stmts = splitStatements(sql);
    expect(stmts.length).toBe(3);
    expect(stmts[0]).toContain("'含分号;的内容'");
    expect(stmts[1]).toContain("\\'");
    expect(stmts[2]).toContain("it''s fine");
  });

  it('行注释/块注释被剥离，其后的语句保留（V001 事故回归）', () => {
    // 旧实现按 ';' 拆分后丢弃以 -- 开头的块，导致下面这条 CREATE TABLE 被整体丢弃
    const sql = `-- 1. 系统用户表
-- -------------------------------------------------------------
CREATE TABLE sys_user (id BIGINT);
/* 块注释 */ INSERT INTO t VALUES (1);`;
    const stmts = splitStatements(sql);
    expect(stmts.length).toBe(2);
    expect(stmts[0].startsWith('CREATE TABLE sys_user')).toBe(true);
    expect(stmts[1].startsWith('INSERT INTO t')).toBe(true);
  });

  it('真实迁移文件：每份 SQL 均解析出非零语句，且不含注释残留', () => {
    const files = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter((f) => /^V\d+__.+\.sql$/.test(f))
      .sort();
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf-8');
      const stmts = splitStatements(sql);
      // 旧实现在 V001/V002 上分别丢弃 23/25 与 14/14 块；修复后必须全部保留
      expect(stmts.length, `${f} 语句数异常`).toBeGreaterThan(5);
      for (const s of stmts) {
        expect(s.startsWith('--'), `${f} 语句仍以注释开头`).toBe(false);
        expect(s.length, `${f} 存在空语句`).toBeGreaterThan(3);
      }
    }
  });

  it('V001 必须包含 sys_user 建表语句（当前启动依赖）', () => {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, 'V001__init_schema.sql'), 'utf-8');
    const stmts = splitStatements(sql);
    expect(stmts.some((s) => /CREATE TABLE .*`sys_user`/i.test(s.replace(/\s+/g, ' ')))).toBe(true);
  });
});
