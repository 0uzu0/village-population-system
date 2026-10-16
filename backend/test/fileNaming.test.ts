import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  BIZ_TYPES,
  attachmentPermissions,
  buildFileNames,
  normalizeCapturedAt,
  sanitizeDisplayName,
  sanitizeStorageName,
  stampOf,
} from '../src/modules/file';

const fileSrc = fs.readFileSync(path.resolve(__dirname, '../src/modules/file.ts'), 'utf8');

/**
 * 现场照片的命名与归属。
 *
 * 这一组用例守的是两件在真实环境里会出事的事：
 *  1. **文件名的时间戳必须是「拍照时间」而不是「上传时间」**。
 *     村里经常是走完一圈回到村委才有信号，离线补传时上传时间会全挤在同一分钟，
 *     按上传时间命名等于把「哪天去谁家拍的」这条线索抹掉。
 *  2. **照片必须挂得住人**。挂着 bizType/bizId 才谈得上「这个人有哪些现场照片」，
 *     而一旦命名里带上了人员编号，直接在服务器上翻目录也能对上人。
 */

// ---------------------------------------------------------------------------
// 时间戳：一律按北京时间
// ---------------------------------------------------------------------------

describe('stampOf：北京时间 yyyyMMdd-HHmmss', () => {
  it('UTC 11:30 对应北京时间 19:30', () => {
    expect(stampOf(new Date('2026-10-16T11:30:12Z'))).toBe('20261016-193012');
  });

  it('跨零点按北京时间换日（UTC 17:00 已是次日 01:00）', () => {
    expect(stampOf(new Date('2026-10-16T17:00:00Z'))).toBe('20261017-010000');
  });

  it('不依赖容器时区与本机 ICU：手工加 8 小时，输出固定宽度', () => {
    // 三位月份/日期/时分秒都必须补零，否则文件名长度不一、排序会乱
    expect(stampOf(new Date('2026-01-02T00:00:00Z'))).toMatch(/^\d{8}-\d{6}$/);
    expect(stampOf(new Date('2026-01-02T00:00:00Z'))).toBe('20260102-080000');
  });
});

describe('normalizeCapturedAt：容忍手机上报的三种写法', () => {
  const at1930 = Date.UTC(2026, 9, 16, 11, 30, 12);

  it('13 位毫秒', () => {
    const parsed = normalizeCapturedAt(at1930);
    expect(parsed).not.toBeNull();
    expect(stampOf(parsed!)).toBe('20261016-193012');
  });

  it('10 位秒（不能当成毫秒用，否则会落到 1970 而被判越界）', () => {
    const parsed = normalizeCapturedAt(Math.floor(at1930 / 1000));
    expect(parsed).not.toBeNull();
    expect(stampOf(parsed!)).toBe('20261016-193012');
  });

  it('纯数字字符串同样按位数区分秒/毫秒', () => {
    expect(stampOf(normalizeCapturedAt(String(at1930))!)).toBe('20261016-193012');
    expect(stampOf(normalizeCapturedAt(String(Math.floor(at1930 / 1000)))!)).toBe('20261016-193012');
  });

  it('带时区的 ISO 字符串', () => {
    expect(stampOf(normalizeCapturedAt('2026-10-16T19:30:12+08:00')!)).toBe('20261016-193012');
  });

  it('空值一律视为「没给」，不是错误', () => {
    for (const raw of [undefined, null, '', '   ']) {
      expect(normalizeCapturedAt(raw)).toBeNull();
    }
  });

  it('乱值/越界一律降级为 null（手机时钟被改乱是常事，不能因此传不上照片）', () => {
    expect(normalizeCapturedAt('not-a-date')).toBeNull();
    expect(normalizeCapturedAt(Date.UTC(1999, 0, 1))).toBeNull(); // 2000 年前
    expect(normalizeCapturedAt(Date.now() + 2 * 24 * 60 * 60 * 1000)).toBeNull(); // 超过明天
  });

  it('「明天」这个上界留了余量：差几小时仍接受（跨时区上报）', () => {
    expect(normalizeCapturedAt(Date.now() + 60 * 60 * 1000)).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 两种名字：给人看的（入库）与落盘的
// ---------------------------------------------------------------------------

describe('sanitizeDisplayName：保留中文，只挡危险字符', () => {
  it('去掉路径分隔符与控制字符，中文原样保留', () => {
    expect(sanitizeDisplayName('张三/李四\\2026:*?"<>|')).toBe('张三李四2026');
    expect(sanitizeDisplayName('张三\u0000\u001f照片')).toBe('张三照片');
  });

  it('折叠多余空白并裁剪到 120 字', () => {
    expect(sanitizeDisplayName('  张   三  ')).toBe('张 三');
    expect(sanitizeDisplayName('x'.repeat(200))).toHaveLength(120);
  });

  it('全被清空时给个兜底名，绝不返回空串（空文件名会让下载失败）', () => {
    expect(sanitizeDisplayName('///')).toBe('file');
    expect(sanitizeDisplayName('   ')).toBe('file');
  });
});

describe('sanitizeStorageName：落盘名只留 ASCII', () => {
  it('中文与特殊字符统一换成连字符，防路径穿越', () => {
    expect(sanitizeStorageName('../../etc/passwd')).toBe('etc-passwd');
    // 「张三」整段被替换成连字符后，开头的 ./- 前缀会被剥掉，只剩扩展名主体
    expect(sanitizeStorageName('张三.jpg')).toBe('jpg');
    // 连续分隔符折叠，且不允许以点/连字符开头（否则会是隐藏文件）
    expect(sanitizeStorageName('.__a--b..c.jpg')).toMatch(/^[A-Za-z0-9_]/);
    expect(sanitizeStorageName('..\\..\\x.jpg')).not.toContain('..');
  });

  it('长度上限 100，兜底名非空', () => {
    expect(sanitizeStorageName('a'.repeat(300))).toHaveLength(100);
    expect(sanitizeStorageName('中文')).not.toBe('');
  });
});

describe('buildFileNames：两个名字都以拍照时间开头', () => {
  const at = new Date('2026-10-16T11:30:12Z'); // 北京时间 19:30:12

  it('人员照片：展示名带姓名与人员编号，落盘名带 P<id>', () => {
    const names = buildFileNames(
      { at, ext: '.jpg', bizType: 'PERSON', bizId: 123, personName: '张三', personNo: 'P000123' },
      'a1b2'
    );
    expect(names.displayName).toBe('20261016-193012-张三-P000123.jpg');
    expect(names.storageName).toBe('20261016-193012-P123-a1b2.jpg');
  });

  it('拿不到姓名/编号时退化成「人员<id>」，不会生成空的一段', () => {
    const names = buildFileNames(
      { at, ext: '.jpg', bizType: 'PERSON', bizId: 7, personName: null, personNo: null },
      'zzzz'
    );
    expect(names.displayName).toBe('20261016-193012-人员7.jpg');
    expect(names.storageName).toBe('20261016-193012-P7-zzzz.jpg');
  });

  it('台账与未关联附件各有自己的段，不会互相混淆', () => {
    expect(
      buildFileNames({ at, ext: '.pdf', bizType: 'LEDGER', bizId: 9 }, 'q1q1').displayName
    ).toBe('20261016-193012-台账9.pdf');
    expect(
      buildFileNames({ at, ext: '.png', bizType: null, bizId: null }, 'q1q1').displayName
    ).toBe('20261016-193012-未关联.png');
  });

  it('按文件名排序 = 按拍照时间排序（服务器上直接翻目录也能看懂）', () => {
    const early = buildFileNames({ at: new Date('2026-10-16T01:00:00Z'), ext: '.jpg', bizType: 'PERSON', bizId: 1 }, 'aaaa');
    const late = buildFileNames({ at: new Date('2026-10-16T02:00:00Z'), ext: '.jpg', bizType: 'PERSON', bizId: 1 }, 'bbbb');
    expect(early.displayName < late.displayName).toBe(true);
    expect(early.storageName < late.storageName).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 归属与权限
// ---------------------------------------------------------------------------

describe('附件归属', () => {
  it('只允许挂在人员或台账上', () => {
    expect([...BIZ_TYPES]).toEqual(['PERSON', 'LEDGER']);
  });

  it('权限跟随归属对象，不再一律用台账权限卡着', () => {
    // 现场照片是「给某个人员留痕」，拍照的人持有的是人员类权限；
    // 若一张人员照片要人先证明自己有台账权限才能看/传，这件事在权限配置上说不通。
    expect(attachmentPermissions('PERSON', 'view')).toContain('person:view');
    expect(attachmentPermissions('PERSON', 'manage')).toContain('person:edit');
    expect(attachmentPermissions('LEDGER', 'view')).toEqual(['ledger:view']);
    expect(attachmentPermissions('LEDGER', 'manage')).toEqual(['ledger:manage']);
    // 未关联（PC 先传后认领）走台账权限：那条路径本来就是台账在用
    expect(attachmentPermissions(null, 'manage')).toEqual(['ledger:manage']);
  });

  it('人员权限里兼容台账权限，改版前传的照片仍归同一批人管', () => {
    expect(attachmentPermissions('PERSON', 'view')).toContain('ledger:view');
    expect(attachmentPermissions('PERSON', 'manage')).toContain('ledger:manage');
  });
});

// ---------------------------------------------------------------------------
// 实现层面的约束（防止改回去）
// ---------------------------------------------------------------------------

describe('上传实现约束', () => {
  it('captured_at 入库：拍照时间要留下来，供列表排序与追溯', () => {
    expect(fileSrc).toContain('captured_at');
    expect(fileSrc).toContain('biz_type, biz_id, captured_at');
    expect(fileSrc).toContain('COALESCE(captured_at, created_at) DESC');
  });

  it('有拍照时间才改名；PC 传合同/发票（无 capturedAt）保留原文件名', () => {
    expect(fileSrc).toContain('capturedAt ? named.displayName : sanitizeDisplayName(file.originalname)');
  });

  it('归属对象必须真实存在，不留查不到的孤儿附件', () => {
    expect(fileSrc).toContain('PERSON_NOT_FOUND');
    expect(fileSrc).toContain('LEDGER_NOT_FOUND');
  });

  it('multer 先落临时名，handler 再 rename 成正式名（字段解析晚于 filename 回调）', () => {
    expect(fileSrc).toContain('fs.renameSync(file.path, finalPath)');
  });

  it('GET / 列表必须先于 GET /:id 注册，否则被参数路由捕获', () => {
    const listIdx = fileSrc.indexOf("router.get('/',");
    const idIdx = fileSrc.indexOf("router.get('/:id'");
    expect(listIdx).toBeGreaterThan(-1);
    expect(idIdx).toBeGreaterThan(listIdx);
  });
});

// ---------------------------------------------------------------------------
// 迁移文件
// ---------------------------------------------------------------------------

describe('迁移脚本', () => {
  const dirs = [
    path.resolve(__dirname, '../src/db/migrations'),
    path.resolve(__dirname, '../../database/migrations'),
  ];

  it('V014（captured_at）在两个迁移目录都存在且内容一致', () => {
    const contents = dirs.map((d) => fs.readFileSync(path.join(d, 'V014__file_capture_time.sql'), 'utf8'));
    expect(contents[0]).toBe(contents[1]);
    expect(contents[0]).toContain('captured_at');
  });

  it('V015（删除 data_scope）在两个迁移目录都存在且内容一致', () => {
    const contents = dirs.map((d) => fs.readFileSync(path.join(d, 'V015__drop_role_data_scope.sql'), 'utf8'));
    expect(contents[0]).toBe(contents[1]);
    expect(contents[0]).toContain('DROP COLUMN `data_scope`');
    // DROP COLUMN IF EXISTS 是 MariaDB 的扩展语法，MySQL 8 会直接语法报错
    expect(contents[0]).not.toMatch(/DROP\s+COLUMN\s+IF\s+EXISTS/i);
  });
});
