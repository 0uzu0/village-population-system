import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { villageContactSchema } from '../src/modules/grid';

const gridSrc = fs.readFileSync(path.resolve(__dirname, '../src/modules/grid.ts'), 'utf8');
const migSrc = fs.readFileSync(
  path.resolve(__dirname, '../src/db/migrations/V012__village_contact.sql'),
  'utf8'
);
const pageSrc = fs.readFileSync(
  path.resolve(__dirname, '../../frontend/src/views/grid/index.vue'),
  'utf8'
);

/**
 * 村庄负责人 / 手机号落库回归。
 *
 * 起因：该信息原先只存在浏览器 localStorage（换设备即丢失、无法多人共享），
 * 用户要求「村庄、手机号负责人变更要写到后端」→ 新增 village_contact 表 + 保存接口。
 * 这组断言防止有人再把它改回前端本地存储。
 */
describe('V012 村庄联系人迁移', () => {
  it('建表 village_contact，含村庄名唯一键（upsert 幂等的基础）', () => {
    expect(migSrc).toContain('CREATE TABLE IF NOT EXISTS `village_contact`');
    expect(migSrc).toContain('`village_name`');
    expect(migSrc).toContain('`manager`');
    expect(migSrc).toContain('`phone`');
    expect(migSrc).toContain('UNIQUE KEY `uk_vc_village` (`village_name`)');
  });

  it('不显式插入 id（AUTO_INCREMENT，可重复执行）', () => {
    expect(/INSERT\s+INTO\s+`?village_contact`?\s*\(\s*`?id`?/i.test(migSrc)).toBe(false);
  });

  it('两个目录的迁移文件内容一致', () => {
    const other = path.resolve(__dirname, '../../database/migrations/V012__village_contact.sql');
    expect(fs.existsSync(other), 'database/migrations 下缺少 V012').toBe(true);
    expect(fs.readFileSync(other, 'utf8').trim()).toBe(migSrc.trim());
  });
});

describe('村庄列表接口带出负责人/手机号', () => {
  const handler = gridSrc.slice(
    gridSrc.indexOf("router.get('/villages'"),
    gridSrc.indexOf("router.put('/villages/contact'")
  );

  it('/villages 的负责人/手机号取自 village_contact，且无条件带出', () => {
    expect(handler.length).toBeGreaterThan(0);
    // 整表取回后按村庄名映射，不做任何过滤：否则前端要展示的列会静默空白（本项目已踩过两次）
    expect(handler).toContain('SELECT village_name, manager, phone FROM village_contact');
    expect(handler).toContain('const contact = contactMap.get(r.name)');
    expect(handler).toContain('manager: contact?.manager ?? null');
    expect(handler).toContain('phone: contact?.phone ?? null');
  });

  it('/villages 不再把标签连接并进主查询（那是「按小村庄查询很慢」的根因）', () => {
    // 人口数必须是与标签无关的普通 COUNT(*)：一旦重新 JOIN person_tag，
    // 行数会被标签放大，只能在同一个 GROUP BY 里堆 COUNT(DISTINCT)，慢查询就回来了
    expect(handler).toContain('COUNT(*) AS person_count');
    expect(handler).not.toContain('COUNT(DISTINCT p.id) AS person_count');
    expect(handler).not.toContain('GROUP BY p.village, vc.manager, vc.phone');
  });
});

describe('保存接口 PUT /grids/villages/contact', () => {
  it('用 grid:manage 权限，且注册顺序早于 /:id 通配路由', () => {
    const contactIdx = gridSrc.indexOf("router.put('/villages/contact'");
    const wildcardIdx = gridSrc.indexOf("router.put('/:id'");
    expect(contactIdx).toBeGreaterThan(-1);
    expect(wildcardIdx).toBeGreaterThan(-1);
    expect(contactIdx).toBeLessThan(wildcardIdx);
    expect(gridSrc.slice(contactIdx, contactIdx + 200)).toContain("requirePermission('grid:manage')");
  });

  it('按村名 upsert（唯一索引 + ON DUPLICATE KEY UPDATE），不被列清单/值错位坑到', () => {
    expect(gridSrc).toContain('INSERT INTO village_contact (village_name, manager, phone, created_by, updated_by)');
    expect(gridSrc).toContain('ON DUPLICATE KEY UPDATE manager = VALUES(manager)');
  });

  it('两字段皆空时删除该行（回到未维护状态，不留空记录）', () => {
    expect(gridSrc).toContain('DELETE FROM village_contact WHERE village_name = ?');
  });

  it('村庄必须仍存在于人员档案（不再按所谓的「数据范围」过滤——那个机制已整体删除）', () => {
    expect(gridSrc).toContain('VILLAGE_NOT_FOUND');
    const putIdx = gridSrc.indexOf("router.put('/villages/contact'");
    expect(putIdx).toBeGreaterThan(-1);
    // 反向断言：网格员数据范围机制已彻底删除，不能再有残留
    expect(gridSrc.includes('buildGridFilter')).toBe(false);
    expect(gridSrc.slice(putIdx)).toContain('SELECT 1 AS ok FROM person p WHERE');
  });
});

describe('villageContactSchema 容忍编辑态空值', () => {
  it('manager/phone 为 null（编辑态回显）可通过', () => {
    expect(() => villageContactSchema.parse({ villageName: '艾园村', manager: null, phone: null })).not.toThrow();
  });

  it('空字符串可通过，且缺 villageName 被拒', () => {
    expect(() => villageContactSchema.parse({ villageName: '艾园村', manager: '', phone: '' })).not.toThrow();
    expect(() => villageContactSchema.parse({ manager: '张三' })).toThrow();
  });
});

describe('前端不再使用 localStorage 存村庄联系人', () => {
  it('网格页走接口而非浏览器本地存储', () => {
    expect(pageSrc).not.toContain('localStorage');
    expect(pageSrc).not.toContain('grid:villageContacts');
    expect(pageSrc).toContain('gridApi.saveVillageContact(');
    // 展示字段直接取接口返回的行数据
    expect(pageSrc).toContain("负责人：{{ v.manager || '—' }}，手机号：{{ v.phone || '—' }}");
  });
});
