import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { buildPersonListQuery, listQuerySchema } from '../src/services/personQuery';

const exportSrc = fs.readFileSync(path.join(__dirname, '../src/modules/excel/export.ts'), 'utf8');

/** 人员列表查询构建：重点盯新条件的口径与参数安全（全部走占位符） */
describe('buildPersonListQuery', () => {
  it('空条件默认按 id 升序，只拼在册过滤', () => {
    const q = listQuerySchema.parse({});
    const { whereSql, params, orderBy, direction } = buildPersonListQuery(q);
    expect(whereSql).toBe("1=1 AND p.status IN ('NORMAL','MOVED_IN')");
    expect(params).toEqual([]);
    expect(orderBy).toBe('p.id');
    expect(direction).toBe('ASC');
  });

  it('keyword 模糊匹配姓名/身份证/手机号/户籍地址/居住地址（6 个占位符）', () => {
    const q = listQuerySchema.parse({ keyword: '张三' });
    const { whereSql, params } = buildPersonListQuery(q);
    expect(whereSql).toContain('p.name LIKE ?');
    expect(whereSql).toContain('p.id_card LIKE ?');
    expect(whereSql).toContain('p.phone LIKE ?');
    expect(whereSql).toContain('p.phone_backup LIKE ?');
    expect(whereSql).toContain('p.hukou_address LIKE ?');
    expect(whereSql).toContain('p.live_address LIKE ?');
    expect(params).toEqual(['%张三%', '%张三%', '%张三%', '%张三%', '%张三%', '%张三%']);
  });

  it('keyword 与网格/村庄条件可叠加', () => {
    const q = listQuerySchema.parse({ keyword: '李', gridId: 3, village: '艾园村' });
    const { whereSql, params } = buildPersonListQuery(q);
    expect(whereSql).toContain('p.name LIKE ?');
    expect(whereSql).toContain('p.grid_id = ?');
    expect(whereSql).toContain('p.village = ?');
    expect(params).toHaveLength(8); // 6（keyword）+ 1 + 1
  });

  it('activeOnly 默认开启：未指定 status 时排除死亡/迁出', () => {
    const q = listQuerySchema.parse({});
    const { whereSql } = buildPersonListQuery(q);
    expect(whereSql).not.toBe('1=1'); // 会拼上 activeSql
  });

  it('activeOnly=false 且无 status 时不拼在册过滤', () => {
    const q = listQuerySchema.parse({ activeOnly: 'false' });
    const { whereSql } = buildPersonListQuery(q);
    expect(whereSql).toBe('1=1');
  });

  it('sortBy 走白名单：非白名单字段回退 p.id，防注入', () => {
    const q = listQuerySchema.parse({ sortBy: '(SELECT 1)', sortOrder: 'desc' });
    const { orderBy, direction } = buildPersonListQuery(q);
    expect(orderBy).toBe('p.id');
    expect(direction).toBe('DESC');
  });
});

/** 导出 /excel/export 与人员列表必须同口径（历史踩坑：筛完导出是另一批人） */
describe('excel 导出与人员列表口径一致', () => {
  it('导出 keyword 搜索口径与列表一致（含户籍/居住地址）', () => {
    expect(exportSrc).toContain(
      '(p.name LIKE ? OR p.id_card LIKE ? OR p.phone LIKE ? OR p.phone_backup LIKE ? OR p.hukou_address LIKE ? OR p.live_address LIKE ?)'
    );
  });

  it('导出支持 village 筛选（列表有、导出也必须有）', () => {
    expect(exportSrc).toContain("village: z.string().max(64).optional()");
    expect(exportSrc).toContain("p.village = ?");
  });
});
