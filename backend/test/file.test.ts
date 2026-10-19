import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const fileSrc = fs.readFileSync(path.resolve(__dirname, '../src/modules/file.ts'), 'utf8');

/**
 * 通用附件模块：类型白名单、content-type 映射、inline 预览、nosniff、大小不限制。
 * 防止有人把白名单放宽或把预览改回下载（合同/发票需在浏览器内直接看）。
 */
describe('附件上传白名单与大小上限', () => {
  it('仅允许 PDF / JPG / JPEG / PNG / WEBP', () => {
    for (const ext of ["'.pdf'", "'.jpg'", "'.jpeg'", "'.png'", "'.webp'"]) {
      expect(fileSrc).toContain(ext);
    }
  });

  it('content-type 由入库映射决定（pdf / 图片），不轻信客户端', () => {
    expect(fileSrc).toContain("'.pdf': 'application/pdf'");
    expect(fileSrc).toContain("'.jpg': 'image/jpeg'");
    expect(fileSrc).toContain("'.png': 'image/png'");
    expect(fileSrc).toContain("'.webp': 'image/webp'");
  });

  // v2.2：单个附件 20MB 上限（代码审计第一批）。
  // nginx 侧仍是 client_max_body_size 0，上限由后端 multer 执行——这样能返回
  // 带具体数值的中文提示，且绕过反向代理直连时同样受保护。
  // 注意：这条曾经断言「不限制大小」（旧需求），改需求时把用例一起改了，
  // 不要让它和实现相反。
  it('单个附件限制 20MB，超限返回中文提示', () => {
    expect(fileSrc).toContain('MAX_ATTACHMENT_MB = 20');
    expect(fileSrc).toContain('limits: { fileSize: MAX_ATTACHMENT_BYTES, files: 1 }');
    expect(fileSrc).toContain('文件过大，单个附件不超过');
    expect(fileSrc).toContain('LIMIT_FILE_SIZE');
  });
});

describe('附件预览端点安全', () => {
  it('预览用 inline 而非 attachment，并在浏览器内渲染', () => {
    expect(fileSrc).toContain("Content-Disposition', `inline;");
  });

  it('强制 nosniff 防 MIME 嗅探', () => {
    expect(fileSrc).toContain("X-Content-Type-Options', 'nosniff'");
    expect(fileSrc).toContain('content_type ||');
  });

  it('文件路径用入库 storage_path，不依赖客户端文件名（防穿越）', () => {
    expect(fileSrc).toContain('file.storage_path');
  });
});

describe('附件路由注册顺序', () => {
  it('POST /upload 必须先于 /:id 注册，否则被参数路由捕获', () => {
    const uploadIdx = fileSrc.indexOf("router.post('/upload'");
    const idGetIdx = fileSrc.indexOf("router.get('/:id'");
    const idDelIdx = fileSrc.indexOf("router.delete('/:id'");
    expect(uploadIdx).toBeGreaterThan(-1);
    expect(idGetIdx).toBeGreaterThan(uploadIdx);
    expect(idDelIdx).toBeGreaterThan(uploadIdx);
  });

  it('GET /:id/thumb 必须先于 GET /:id 注册（与 /upload 同一约定）', () => {
    const thumbIdx = fileSrc.indexOf("router.get('/:id/thumb'");
    const idGetIdx = fileSrc.indexOf("router.get('/:id'");
    expect(thumbIdx).toBeGreaterThan(-1);
    expect(idGetIdx).toBeGreaterThan(thumbIdx);
  });
});

describe('缩略图（v2.3.2 附件性能优化）', () => {
  it('上传时为图片生成缩略图，失败只记日志不上抛（不能拖垮上传主流程）', () => {
    expect(fileSrc).toContain('makeThumbnail(finalPath, thumbPathOf(finalPath))');
    const genIdx = fileSrc.indexOf('生成缩略图失败');
    expect(genIdx).toBeGreaterThan(-1);
    expect(fileSrc).toContain("logger.warn('生成缩略图失败'");
  });

  it('/thumb 对无缩略图的文件（PDF/生成失败）返回 404，前端退回原片', () => {
    expect(fileSrc).toContain("'该文件没有缩略图', 404, 'NO_THUMBNAIL'");
    expect(fileSrc).toContain("'缩略图生成失败', 404, 'NO_THUMBNAIL'");
  });

  it('删除原片时一并清理缩略图文件（派生文件不留在磁盘上）', () => {
    expect(fileSrc).toContain('thumbPathOf(file.storage_path); if (fs.existsSync(thumb)) fs.unlinkSync(thumb)');
  });

  it('缩略图权限与原片一致（view 权限按归属对象判）', () => {
    const thumbIdx = fileSrc.indexOf("router.get('/:id/thumb'");
    const seg = fileSrc.slice(thumbIdx, thumbIdx + 2000);
    expect(seg).toContain("attachmentPermissions(file.biz_type ?? null, 'view')");
  });
});

describe('附件 HTTP 缓存（v2.3.2 附件性能优化）', () => {
  it('预览与缩略图响应带 ETag + private 缓存，命中 If-None-Match 返回 304', () => {
    expect(fileSrc).toContain('ETag');
    expect(fileSrc).toContain("'private, max-age=86400'");
    expect(fileSrc).toContain("if-none-match");
    expect(fileSrc).toContain('304');
  });

  it('缓存是 private：附件经 Bearer 鉴权，不能进共享代理缓存', () => {
    expect(fileSrc).not.toContain("'public, max-age");
  });

  it('预览与缩略图统一走 serveFile（inline + nosniff + 缓存一处收口）', () => {
    expect(fileSrc).toContain('function serveFile(');
    // 旧的内联响应头写法不应再出现在 /:id 与 /:id/thumb 路由里
    expect(fileSrc.match(/res\.setHeader\('Content-Disposition'/g)).toHaveLength(1);
  });
});
