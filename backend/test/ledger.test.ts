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
import { recordSchema } from '../src/modules/ledger';

const ledgerSrc = fs.readFileSync(path.resolve(__dirname, '../src/modules/ledger.ts'), 'utf8');
const migrationSrc = fs.readFileSync(
  path.resolve(__dirname, '../src/db/migrations/V010__ledger_and_files.sql'),
  'utf8'
);
const migrationV011Src = fs.readFileSync(
  path.resolve(__dirname, '../src/db/migrations/V011__ledger_drop_machinery_grid.sql'),
  'utf8'
);

describe('台账配置 LEDGER_CATEGORIES', () => {
  it('水利条口含河道打草/河道小型工程/泵站维修', () => {
    const water = LEDGER_CATEGORIES.find((c) => c.code === 'WATER');
    expect(water).toBeTruthy();
    const codes = water!.workTypes.map((w) => w.code);
    expect(codes).toEqual(['RIVER_MOWING', 'SMALL_PROJECT', 'PUMP_REPAIR']);
  });

  it('民政/卫健条口在交互页面可体现', () => {
    const civil = LEDGER_CATEGORIES.find((c) => c.code === 'CIVIL');
    const health = LEDGER_CATEGORIES.find((c) => c.code === 'HEALTH');
    expect(civil?.name).toBe('民政');
    expect(health?.name).toBe('卫健');
    expect(civil!.workTypes.length).toBeGreaterThan(0);
    expect(health!.workTypes.length).toBeGreaterThan(0);
    // 校验函数应认可新增条口及其工作类型
    expect(isValidCategory('CIVIL')).toBe(true);
    expect(isValidWorkType(civil!.workTypes[0].code)).toBe(true);
    expect(categoryName('CIVIL')).toBe('民政');
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

describe('台账列表/详情 SQL 字段完整性（无机械费/网格）', () => {
  it('列表 SELECT 取出人工费/发票费与附件数，且不含机械费/网格', () => {
    expect(ledgerSrc).toContain('labor_cost');
    expect(ledgerSrc).toContain('invoice_cost');
    expect(ledgerSrc).not.toContain('machinery_cost');
    expect(ledgerSrc).not.toContain('grid_id');
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

describe('台账统计 SQL 聚合完整性（无机械费/网格）', () => {
  it('summary 仅汇总人工费/发票费/合计', () => {
    expect(ledgerSrc).toContain('COALESCE(SUM(labor_cost),0)');
    expect(ledgerSrc).toContain('COALESCE(SUM(invoice_cost),0)');
    expect(ledgerSrc).toContain('COALESCE(SUM(labor_cost + invoice_cost),0)');
    expect(ledgerSrc).not.toContain('machinery_cost');
  });

  it('统计含按条口/工作类型/月份三个维度（无网格维度）', () => {
    expect(ledgerSrc).toContain('GROUP BY category');
    expect(ledgerSrc).toContain('GROUP BY work_type');
    expect(ledgerSrc).toContain("DATE_FORMAT(record_date,'%Y-%m')");
    expect(ledgerSrc).not.toContain('GROUP BY l.grid_id');
  });
});

describe('recordSchema 容忍编辑态空值（修复 Invalid input）', () => {
  it('可选字符串字段为 null（编辑时后端返回 null）也不报错', () => {
    const payload = {
      category: 'WATER', workType: 'RIVER_MOWING', recordDate: '2026-01-01',
      location: null, title: '河道打草', detail: null,
      laborCost: 100, invoiceCost: 0, invoiceNo: null, responsible: null, remark: null,
      attachmentIds: [1, 2],
    };
    expect(() => recordSchema.parse(payload)).not.toThrow();
    const v = recordSchema.parse(payload);
    expect(v.location).toBeNull();
  });

  it('空字符串可选字段同样通过', () => {
    const payload = {
      category: 'WATER', workType: 'RIVER_MOWING', recordDate: '2026-01-01',
      location: '', title: 'x', laborCost: 0, invoiceCost: 0, attachmentIds: [],
    };
    expect(() => recordSchema.parse(payload)).not.toThrow();
  });
});

describe('V010 + V011 迁移脚本完整性', () => {
  it('V010 创建 ledger_record 含三费列与网格列', () => {
    expect(migrationSrc).toContain('CREATE TABLE IF NOT EXISTS `ledger_record`');
    expect(migrationSrc).toContain('`labor_cost`');
    expect(migrationSrc).toContain('`machinery_cost`');
    expect(migrationSrc).toContain('`invoice_cost`');
    expect(migrationSrc).toContain('`grid_id`');
  });

  it('V011 去掉机械费与所属网格列', () => {
    expect(migrationV011Src).toContain('DROP COLUMN `machinery_cost`');
    expect(migrationV011Src).toContain('DROP COLUMN `grid_id`');
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
