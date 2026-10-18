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
});
