import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  BIZ_TYPES,
  attachmentPermissions,
  buildFileNames,
  folderOf,
  normalizeCapturedAt,
  sanitizeDisplayName,
  sanitizeFolderName,
  stampOf,
} from '../src/modules/file';

const fileSrc = fs.readFileSync(path.resolve(__dirname, '../src/modules/file.ts'), 'utf8');

/**
 * 现场照片的命名与归属。
 *
 * 这一组用例守的是两件在真实环境里会出事的事：
 *  1. **文件名必须是「拍照时间」而不是「上传时间」**。
 *     村里经常是走完一圈回到村委才有信号，离线补传时上传时间会全挤在同一分钟，
 *     按上传时间命名等于把「哪天去谁家拍的」这条线索抹掉。
 *  2. **照片必须挂得住人**。挂着 bizType/bizId 才谈得上「这个人有哪些现场照片」，
 *     而目录名就是人名，在服务器上翻目录、在备份里拷走这个人，都不需要查数据库。
 */

// ---------------------------------------------------------------------------
// 时间戳：一律按北京时间
// ---------------------------------------------------------------------------

describe('stampOf：北京时间 yyyy-MM-dd-HHmmss', () => {
  it('UTC 11:30 对应北京时间 19:30', () => {
    expect(stampOf(new Date('2026-10-16T11:30:12Z'))).toBe('2026-10-16-19-30-12');
  });

  it('跨零点按北京时间换日（UTC 17:00 已是次日 01:00）', () => {
    expect(stampOf(new Date('2026-10-16T17:00:00Z'))).toBe('2026-10-17-01-00-00');
  });

  it('不依赖容器时区与本机 ICU：手工加 8 小时，输出固定宽度', () => {
    // 月份/日期/时分秒都必须补零，否则文件名长度不一、排序会乱
    expect(stampOf(new Date('2026-01-02T00:00:00Z'))).toBe('2026-01-02-08-00-00');
    expect(stampOf(new Date('2026-01-02T00:00:00Z'))).toMatch(/^\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}$/);
  });

  /**
   * 时刻用 `-` 而不是 `:`。`:` 在 Windows / NTFS 上是非法字符——
   * 村委的办公机是 Windows，解开备份或直接从磁盘拷照片时会拿不到文件。
   * 「日期-详细时间」是用户点名要的形状，兼容性由分隔符这条用例守住。
   */
  it('不含冒号（Windows / NTFS 非法字符）', () => {
    expect(stampOf(new Date('2026-10-16T11:30:12Z'))).not.toContain(':');
  });

  it('精确到秒：同一分钟内连拍的多张不撞名', () => {
    const a = stampOf(new Date('2026-10-16T11:30:12Z'));
    const b = stampOf(new Date('2026-10-16T11:30:45Z'));
    expect(a).not.toBe(b);
  });
});

describe('normalizeCapturedAt：容忍手机上报的三种写法', () => {
  const at1930 = Date.UTC(2026, 9, 16, 11, 30, 12);

  it('13 位毫秒', () => {
    const parsed = normalizeCapturedAt(at1930);
    expect(parsed).not.toBeNull();
    expect(stampOf(parsed!)).toBe('2026-10-16-19-30-12');
  });

  it('10 位秒（不能当成毫秒用，否则会落到 1970 而被判越界）', () => {
    const parsed = normalizeCapturedAt(Math.floor(at1930 / 1000));
    expect(parsed).not.toBeNull();
    expect(stampOf(parsed!)).toBe('2026-10-16-19-30-12');
  });

  it('纯数字字符串同样按位数区分秒/毫秒', () => {
    // multipart 表单字段拿到的永远是字符串，这条是真实路径
    expect(stampOf(normalizeCapturedAt(String(at1930))!)).toBe('2026-10-16-19-30-12');
    expect(stampOf(normalizeCapturedAt(String(Math.floor(at1930 / 1000)))!)).toBe('2026-10-16-19-30-12');
  });

  it('带时区的 ISO 字符串', () => {
    expect(stampOf(normalizeCapturedAt('2026-10-16T19:30:12+08:00')!)).toBe('2026-10-16-19-30-12');
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

describe('sanitizeFolderName：目录名就是人名，挡下路径穿越与系统非法字符', () => {
  it('保留中文——「人名文件夹」这件事本身就是要求', () => {
    expect(sanitizeFolderName('张三')).toBe('张三');
    expect(sanitizeFolderName('买买提·艾力')).toBe('买买提·艾力');
  });

  it('去掉路径分隔符：人名来自数据库，一旦混进 ../ 就能把文件写到上传目录之外', () => {
    expect(sanitizeFolderName('../../etc')).toBe('etc');
    expect(sanitizeFolderName('a\\b/c')).toBe('abc');
    expect(sanitizeFolderName('张三')).not.toContain('/');
  });

  it('去掉 Windows 非法字符（村委的办公机要能解开备份）', () => {
    expect(sanitizeFolderName('张.三')).toBe('张三'); // 顺带把 .. 打散
    expect(sanitizeFolderName('李:四*')).toBe('李四');
    expect(sanitizeFolderName('王|五<>"?')).toBe('王五');
  });

  it('控制字符会破坏日志与终端输出，一并清掉', () => {
    expect(sanitizeFolderName('张三\u0000\u001f')).toBe('张三');
  });

  it('长度上限 40，被洗空时走兜底名而不是返回空串', () => {
    expect(sanitizeFolderName('x'.repeat(200))).toHaveLength(40);
    expect(sanitizeFolderName('///')).toBe('unknown');
    expect(sanitizeFolderName('   ')).toBe('unknown');
  });
});

describe('folderOf：目录按「这张照片属于谁」分', () => {
  it('人员照片放进人名目录', () => {
    const f = folderOf({ at: new Date(), ext: '.jpg', bizType: 'PERSON', bizId: 1, personName: '张三' });
    expect(f).toBe('张三');
  });

  it('拿不到姓名时退化成 person-<id>，仍能对上人', () => {
    const f = folderOf({ at: new Date(), ext: '.jpg', bizType: 'PERSON', bizId: 7, personName: null });
    expect(f).toBe('person-7');
  });

  it('台账与未关联附件各有自己的一层，不会混进人名目录', () => {
    expect(folderOf({ at: new Date(), ext: '.pdf', bizType: 'LEDGER', bizId: 9 })).toBe('台账9');
    expect(folderOf({ at: new Date(), ext: '.png', bizType: null, bizId: null })).toBe('未关联');
  });

  it('不含路径分隔符：单层目录，不需要按村庄再分一层', () => {
    for (const name of ['张三', '../../etc', '李.四']) {
      expect(folderOf({ at: new Date(), ext: '.jpg', bizType: 'PERSON', bizId: 1, personName: name })).not.toContain('/');
    }
  });
});

describe('buildFileNames：人名目录 + 拍摄时刻文件名', () => {
  const at = new Date('2026-10-16T11:30:12Z'); // 北京时间 19:30:12

  it('人员照片：展示名带姓名与编号，落盘路径是「张三/2026-10-16-19-30-12.jpg」', () => {
    const names = buildFileNames({
      at,
      ext: '.jpg',
      bizType: 'PERSON',
      bizId: 123,
      personName: '张三',
      personNo: 'P000123',
    });
    expect(names.displayName).toBe('2026-10-16-19-30-12-张三-P000123.jpg');
    expect(names.relPath).toBe('张三/2026-10-16-19-30-12.jpg');
  });

  it('落盘路径的形态严格符合「人名文件夹 / 日期-详细时间」', () => {
    const names = buildFileNames({
      at,
      ext: '.jpg',
      bizType: 'PERSON',
      bizId: 123,
      personName: '张三',
      personNo: 'P000123',
    });
    const [folder, file] = names.relPath.split('/');
    expect(folder).toBe('张三');
    expect(file).toMatch(/^2026-10-16-19-30-12\.jpg$/);
  });

  it('拿不到姓名/编号时展示名退化成「人员<id>」，不会生成空的一段', () => {
    const names = buildFileNames({ at, ext: '.jpg', bizType: 'PERSON', bizId: 7, personName: null, personNo: null });
    expect(names.displayName).toBe('2026-10-16-19-30-12-人员7.jpg');
    expect(names.relPath).toBe('person-7/2026-10-16-19-30-12.jpg');
  });

  it('台账与未关联附件各有自己的段，不会互相混淆', () => {
    expect(
      buildFileNames({ at, ext: '.pdf', bizType: 'LEDGER', bizId: 9 }).displayName
    ).toBe('2026-10-16-19-30-12-台账9.pdf');
    expect(
      buildFileNames({ at, ext: '.png', bizType: null, bizId: null }).displayName
    ).toBe('2026-10-16-19-30-12-未关联.png');
  });

  it('按文件名排序 = 按拍照时间排序（服务器上直接翻目录也能看懂）', () => {
    const early = buildFileNames({ at: new Date('2026-10-16T01:00:00Z'), ext: '.jpg', bizType: 'PERSON', bizId: 1 });
    const late = buildFileNames({ at: new Date('2026-10-16T02:00:00Z'), ext: '.jpg', bizType: 'PERSON', bizId: 1 });
    expect(early.displayName < late.displayName).toBe(true);
    expect(early.relPath < late.relPath).toBe(true);
  });

  /**
   * 名字必须完全可预期——「这个名字对应哪个时刻」要能一眼读出来，
   * 随机串会破坏这件事，所以撞名交给落盘前的 uniqueStorageName 处理，
   * 纯函数这边绝不能出现随机成分。
   */
  it('输出不含随机串：同输入两次结果完全一致', () => {
    const input = { at, ext: '.jpg', bizType: 'PERSON' as const, bizId: 1, personName: '张三' };
    expect(buildFileNames(input)).toEqual(buildFileNames(input));
    expect(buildFileNames(input).relPath).toBe('张三/2026-10-16-19-30-12.jpg');
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

  it('multer 先落临时名，handler 再建目录 + rename（字段解析晚于 filename 回调）', () => {
    expect(fileSrc).toContain('fs.renameSync(file.path, finalPath)');
    expect(fileSrc).toContain('fs.mkdirSync(path.dirname(finalPath), { recursive: true })');
  });

  /**
   * 目录名来自数据库里的人名。sanitize 是一道防线，这里是**第二道**——
   * 按解析后的绝对路径复核还在不在 UPLOAD_DIR 里。少了它，一次疏漏就是任意路径写文件。
   */
  it('落盘前把路径锚死在 UPLOAD_DIR 之内（人名是数据库内容，不可信）', () => {
    expect(fileSrc).toContain('resolveInsideUploadDir');
    expect(fileSrc).toContain('INVALID_STORAGE_PATH');
  });

  it('GET / 列表必须先于 GET /:id 注册，否则被参数路由捕获', () => {
    const listIdx = fileSrc.indexOf("router.get('/',");
    const idIdx = fileSrc.indexOf("router.get('/:id'");
    expect(listIdx).toBeGreaterThan(-1);
    expect(idIdx).toBeGreaterThan(listIdx);
  });

  /**
   * 「13:00 拍的照片显示成 05:00」的来源：DATETIME 被 JSON 序列化成 UTC 的 ISO 串，
   * 客户端随手一截就少 8 小时。现场照片的时间是取证信息，
   * 因此必须由服务端统一成无歧义的北京时间文本再出去。
   */
  it('时间对外一律北京时间文本，不返回 ISO/UTC 串（客户端不该再做时区换算）', () => {
    expect(fileSrc).toContain("capturedAt: dateTimeCN(capturedAt)");
    expect(fileSrc).toContain('capturedAt: dateTimeCN(r.captured_at)');
    expect(fileSrc).toContain('createdAt: dateTimeCN(r.created_at)');
    // 不能再有把 Date 原样塞进响应、让它被序列化成 ISO 的写法
    expect(fileSrc).not.toContain('capturedAt: capturedAt ? capturedAt.toISOString()');
  });

  it('删除时连空目录一起清：目录即人名，留一堆空壳只会污染备份', () => {
    const delIdx = fileSrc.indexOf("router.delete('/:id'");
    expect(delIdx).toBeGreaterThan(-1);
    expect(fileSrc.slice(delIdx)).toContain('fs.rmdirSync(dir)');
  });
});

// ---------------------------------------------------------------------------
// 迁移文件
// ---------------------------------------------------------------------------

describe('迁移脚本', () => {
  // 单一来源：backend/src/db/migrations。仓库根曾有一个 database/migrations 手抄镜像，
  // 自 V016 起停更却没人发现，两份文件逐渐不一致——此后一律以本目录为准。
  const dir = path.resolve(__dirname, '../src/db/migrations');

  it('仓库根不再有 database/migrations 镜像目录', () => {
    const legacy = path.resolve(__dirname, '../../database/migrations');
    expect(fs.existsSync(legacy), '旧镜像目录又被加回来了：迁移只放 backend/src/db/migrations').toBe(false);
  });

  it('V014（captured_at）存在且写入拍照时间', () => {
    const sql = fs.readFileSync(path.join(dir, 'V014__file_capture_time.sql'), 'utf8');
    expect(sql).toContain('captured_at');
  });

  it('V015（删除 data_scope）存在且用 MySQL 8 兼容语法', () => {
    const sql = fs.readFileSync(path.join(dir, 'V015__drop_role_data_scope.sql'), 'utf8');
    expect(sql).toContain('DROP COLUMN `data_scope`');
    // DROP COLUMN IF EXISTS 是 MariaDB 的扩展语法，MySQL 8 会直接语法报错
    expect(sql).not.toMatch(/DROP\s+COLUMN\s+IF\s+EXISTS/i);
  });
});
