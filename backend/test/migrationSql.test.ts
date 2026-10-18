import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const MIG_DIR = path.resolve(__dirname, '../src/db/migrations');
const read = (f: string) => fs.readFileSync(path.join(MIG_DIR, f), 'utf8');

/**
 * 迁移 SQL 的静态回归。
 *
 * 事故：V009 曾写成
 *   INSERT INTO sys_permission (id, ...) VALUES ((SELECT MAX(id)+1 FROM sys_permission), ...)
 *   ON DUPLICATE KEY UPDATE ...
 * MySQL 不允许在 INSERT 的 VALUES 子查询中引用目标表自身（即便带 ON DUPLICATE KEY），
 * 报 ER_UPDATE_TABLE_USED(1093)：You can't specify target table 'sys_permission'
 * for update in FROM clause。导致容器反复崩溃重启、服务完全不可用。
 *
 * 该类错误只能在真实 MySQL 上暴露，本地无库时靠静态规则兜底。
 */

describe('V009 人员删除权限', () => {
  const sql = read('V009__person_delete_permission.sql');

  it('新增 person:delete 权限', () => {
    expect(sql).toContain("'person:delete'");
    expect(sql).toContain('删除人员');
  });

  /**
   * 核心回归：不得出现「INSERT ... VALUES ((SELECT ... FROM 目标表)」。
   * sys_permission.id 是 AUTO_INCREMENT，完全不需要显式给 id。
   */
  it('不在VALUES 中用子查询读取目标表自身的 id（MySQL 1093）', () => {
    // 匹配形如 VALUES ((SELECT ... FROM `sys_permission`
    expect(
      /VALUES\s*\(\s*\(\s*SELECT[^)]*FROM\s+`?sys_permission`?/i.test(sql),
      'VALUES 里用子查询读 sys_permission 会触发 ER_UPDATE_TABLE_USED'
    ).toBe(false);
  });

  it('依赖 AUTO_INCREMENT，不显式插入 id 列', () => {
    expect(
      /INSERT\s+INTO\s+`?sys_permission`?\s*\(\s*`?id`?/i.test(sql),
      'sys_permission.id 是 AUTO_INCREMENT，显式插入 id 是多余且易错的'
    ).toBe(false);
  });

  it('靠唯一索引 + ON DUPLICATE KEY 保证幂等（迁移可重复执行）', () => {
    expect(sql).toContain('ON DUPLICATE KEY');
  });

  it('角色授权用 INSERT IGNORE（uk_rp 唯一索引防重复插入）', () => {
    expect(sql).toMatch(/INSERT\s+IGNORE\s+INTO/i);
    expect(sql).toContain('SYSTEM_ADMIN');
  });

  it('是纯 DML，无 DDL —— 迁移器事务回滚对它有效，不会留半完成状态', () => {
    expect(
      /^\s*(ALTER|CREATE|DROP|TRUNCATE|RENAME)\s/im.test(sql),
      '含 DDL 时 MySQL 会隐式提交，迁移失败无法回滚'
    ).toBe(false);
  });

  it('两个目录的迁移文件内容一致', () => {
    const other = path.resolve(__dirname, '../../database/migrations/V009__person_delete_permission.sql');
    expect(fs.existsSync(other), 'database/migrations 下缺少 V009').toBe(true);
    expect(fs.readFileSync(other, 'utf8').trim()).toBe(sql.trim());
  });
});

describe('全部迁移的自引用子查询检查', () => {
  /**
   * 通配扫描所有迁移：任何 INSERT 的VALUES 里用子查询读它自己的目标表，
   * 在 MySQL 上一律报 1093。这一类错误会让服务起不来，必须静态拦住。
   */
  it('任何迁移都不在 INSERT VALUES 中引用目标表自身', () => {
    const files = fs.readdirSync(MIG_DIR).filter((f) => /^V\d+__.+\.sql$/.test(f));
    const violations: string[] = [];
    for (const f of files) {
      const sql = read(f);
      // 抓取 INSERT INTO <table> ... VALUES ((SELECT ... FROM <同表>
      const re = /INSERT\s+(?:IGNORE\s+)?INTO\s+`?(\w+)`?[^;]*?VALUES\s*\(\s*\(\s*SELECT\b[^;]*?\bFROM\b\s*`?(\w+)`?/gis;
      let m: RegExpExecArray | null;
      while ((m = re.exec(sql)) !== null) {
        if (m[1].toLowerCase() === m[2].toLowerCase()) {
          violations.push(`${f}: ${m[1]}`);
        }
      }
    }
    expect(violations, '存在 INSERT VALUES 引用目标表自身的迁移（MySQL 1093）').toEqual([]);
  });

  it('权限/角色相关迁移均有幂等保障', () => {
    const v009 = read('V009__person_delete_permission.sql');
    expect(v009).toMatch(/ON DUPLICATE KEY|INSERT\s+IGNORE/i);
  });
});

describe('V024 人口标签随状态联动', () => {
  const sql = read('V024__population_tags_status_sync.sql');

  it('给 import_pending 补 person_status，且带「列已存在则跳过」守卫', () => {
    expect(sql).toContain('`import_pending`');
    expect(sql).toContain('`person_status`');
    // 可重跑：MySQL 8.0 没有 ADD COLUMN IF NOT EXISTS，必须查元数据
    expect(sql).toContain('information_schema.COLUMNS');
    expect(sql).toMatch(/PREPARE\s+\w+\s+FROM/i);
  });

  it('先留痕再停用（顺序错了就追溯不到本来要动哪些行）', () => {
    const logAt = sql.indexOf('INSERT INTO tag_change_log');
    const updateAt = sql.indexOf('UPDATE person_tag pt');
    expect(logAt).toBeGreaterThan(-1);
    expect(updateAt).toBeGreaterThan(logAt);
  });

  it('只处理非在册人员，且按编码定位而不是硬编码主键', () => {
    expect(sql).toMatch(/p\.status\s+IN\s*\('MOVED_OUT',\s*'DEAD'\)/);
    expect(sql).toContain("td.code IN ('HUKOU_POP', 'FLOATING_POP')");
    // 硬编码标签 id 会在换了环境（自增序列不同）后静默改错标签
    expect(sql).not.toMatch(/tag_id\s*=\s*\d+/);
    expect(sql).not.toMatch(/pt\.tag_id\s*IN\s*\(\s*\d/);
  });

  it('停用条件收敛到 ACTIVE，重复执行影响 0 行', () => {
    expect(sql).toMatch(/WHERE pt\.status = 'ACTIVE'/);
  });
});