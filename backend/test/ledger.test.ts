import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  LEDGER_CATEGORIES,
  isValidCategory,
  isValidWorkType,
  isWorkTypeUnderCategory,
  categoryName,
  workTypeName,
} from '../src/utils/ledger';

const ledgerSrc = fs.readFileSync(path.resolve(__dirname, '../src/modules/ledger.ts'), 'utf8');
const migrationSrc = fs.readFileSync(
  path.resolve(__dirname, '../src/db/migrations/V010__ledger_and_files.sql'),
  'utf8'
);

describe('台账配置 LEDGER_CATEGORIES', () => {
  it('水利条口含河道打草/河道小型工程/泵站维修', () => {
    const water = LEDGER_CATEGORIES.find((c) => c.code === 'WATER');
    expect(water).toBeTruthy();
    const codes = water!.workTypes.map((w) => w.code);
    expect(codes).toEqual(['RIVER_MOWING', 'SMALL_PROJECT', 'PUMP_REPAIR']);
  });

  it('编码校验与名称映射', () => {
    expect(isValidCategory('WATER')).toBe(true);
    expect(isValidCategory('NOPE')).toBe(false);
    expect(isValidWorkType('RIVER_MOWING')).toBe(true);
    expect(isValidWorkType('NOPE')).toBe(false);
    expect(isWorkTypeUnderCategory('WATER', 'RIVER_MOWING')).toBe(true);
    expect(isWorkTypeUnderCategory('WATER', 'PUMP_REPAIR_WRONG')).toBe(false);
    expect(categoryName('WATER')).toBe('水利');
    expect(workTypeName('RIVER_MOWING')).toBe('河道打草');
    // 未知编码回退原值
    expect(categoryName('FOO')).toBe('FOO');
  });
});

describe('台账列表/详情 SQL 字段完整性', () => {
  it('列表 SELECT 显式取出三费列与附件数', () => {
    expect(ledgerSrc).toContain('labor_cost');
    expect(ledgerSrc).toContain('machinery_cost');
    expect(ledgerSrc).toContain('invoice_cost');
    // 附件数：子查询别名 attachment_count
    expect(ledgerSrc).toContain('AS attachment_count');
  });

  it('列表映射补齐 totalCost / categoryName / workTypeName / attachmentCount', () => {
    expect(ledgerSrc).toContain('totalCost:');
    expect(ledgerSrc).toContain('categoryName: categoryName(');
    expect(ledgerSrc).toContain('workTypeName: workTypeName(');
    expect(ledgerSrc).toContain('attachmentCount: Number(r.attachment_count');
  });

  it('详情接口返回 attachments 列表（含 id/fileName/contentType）', () => {
    expect(ledgerSrc).toContain('biz_type = ? AND biz_id = ?');
    expect(ledgerSrc).toContain('fileName: a.file_name');
    expect(ledgerSrc).toContain('contentType: a.content_type');
  });
});

describe('台账统计 SQL 聚合完整性', () => {
  it('summary 汇总人工/机械/发票/合计', () => {
    expect(ledgerSrc).toContain('COALESCE(SUM(labor_cost),0)');
    expect(ledgerSrc).toContain('COALESCE(SUM(machinery_cost),0)');
    expect(ledgerSrc).toContain('COALESCE(SUM(invoice_cost),0)');
    expect(ledgerSrc).toContain('COALESCE(SUM(labor_cost + machinery_cost + invoice_cost),0)');
  });

  it('统计含按条口/工作类型/月份/网格四个维度', () => {
    expect(ledgerSrc).toContain('GROUP BY category');
    expect(ledgerSrc).toContain('GROUP BY work_type');
    expect(ledgerSrc).toContain("DATE_FORMAT(record_date,'%Y-%m')");
    expect(ledgerSrc).toContain('GROUP BY l.grid_id');
  });
});

describe('V010 迁移脚本完整性', () => {
  it('创建 ledger_record 并含三费列', () => {
    expect(migrationSrc).toContain('CREATE TABLE IF NOT EXISTS `ledger_record`');
    expect(migrationSrc).toContain('`labor_cost`');
    expect(migrationSrc).toContain('`machinery_cost`');
    expect(migrationSrc).toContain('`invoice_cost`');
  });

  it('file_info 增加 biz_type / biz_id 及索引', () => {
    expect(migrationSrc).toContain('ADD COLUMN `biz_type`');
    expect(migrationSrc).toContain('ADD COLUMN `biz_id`');
    expect(migrationSrc).toContain('idx_file_biz');
  });

  it('种子 ledger:view(MENU) 与 ledger:manage(ACTION) 权限', () => {
    expect(migrationSrc).toContain("('ledger:view',  '专项台账', 'MENU',   90)");
    expect(migrationSrc).toContain("('ledger:manage','台账管理', 'ACTION', 91)");
  });
});
