import { describe, it, expect, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import sharp from 'sharp';
import { makeThumbnail, thumbPathOf, THUMB_MAX_EDGE, THUMB_SUFFIX, THUMB_SOURCE_EXTS } from '../src/utils/imageThumb';

/**
 * 缩略图生成的真实现验证（sharp 真跑，不 mock）：
 * 尺寸收敛、不放大、EXIF 方向、派生路径规则。CI（linux x64）与
 * Docker 镜像（alpine musl）都会装对应平台的 sharp 预编译二进制。
 */

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'thumb-'));

async function pngBuffer(w: number, h: number): Promise<Buffer> {
  return sharp({ create: { width: w, height: h, channels: 3, background: '#336699' } }).png().toBuffer();
}

afterAll(() => {
  // Windows 上刚写完的文件句柄偶发未释放（EBUSY），清理失败不影响测试结论
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* 临时目录留给系统清理 */ }
});

describe('缩略图生成', () => {
  it('长边收到 320 以内，短边按比例；小图不放大', async () => {
    // 大图：800x600 → 长边 320
    const big = path.join(TMP, 'big.png');
    fs.writeFileSync(big, await pngBuffer(800, 600));
    const bigThumb = thumbPathOf(big);
    await makeThumbnail(big, bigThumb);
    const meta = await sharp(bigThumb).metadata();
    expect(meta.width).toBeLessThanOrEqual(THUMB_MAX_EDGE);
    expect(meta.width).toBeGreaterThan(0);
    expect(meta.height).toBeLessThanOrEqual(THUMB_MAX_EDGE);
    // webp 输出
    expect(meta.format).toBe('webp');

    // 小图：100x80 → 保持原尺寸（withoutEnlargement）
    const small = path.join(TMP, 'small.png');
    fs.writeFileSync(small, await pngBuffer(100, 80));
    await makeThumbnail(small, thumbPathOf(small));
    const meta2 = await sharp(thumbPathOf(small)).metadata();
    expect(meta2.width).toBe(100);
    expect(meta2.height).toBe(80);
  });

  it('竖拍 EXIF 方向被转正（rotate 后宽高互换）', async () => {
    // 生成一张 EXIF Orientation=6（顺时针 90°）的竖图：像素 300x600，视觉上是 600x300。
    // 注意 EXIF Orientation 必须用 withMetadata({ orientation }) 写——libvips 把
    // Orientation 当独立元数据管理，走 exif 字段写不进去（写了也会被重置为 1）。
    const src = path.join(TMP, 'exif.jpg');
    const buf = await sharp({ create: { width: 300, height: 600, channels: 3, background: '#222' } })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();
    fs.writeFileSync(src, buf);
    await makeThumbnail(src, thumbPathOf(src));
    const meta = await sharp(thumbPathOf(src)).metadata();
    // rotate() 已按 EXIF 转正：像素宽高应互换（宽 > 高），而不是保持 300x600 的躺着形态
    expect(meta.width).toBeGreaterThan(meta.height);
  });

  it('路径规则：缩略图 = 原片路径 + .thumb.webp（同目录派生文件）', () => {
    expect(thumbPathOf('/app/uploads/张三/2026-10-16-13-00-05.jpg')).toBe(
      '/app/uploads/张三/2026-10-16-13-00-05.jpg.thumb.webp'
    );
    expect(THUMB_SUFFIX).toBe('.thumb.webp');
  });

  it('可生成缩略图的扩展名是图片子集，PDF 不在其中', () => {
    expect(THUMB_SOURCE_EXTS).toContain('.jpg');
    expect(THUMB_SOURCE_EXTS).toContain('.jpeg');
    expect(THUMB_SOURCE_EXTS).toContain('.png');
    expect(THUMB_SOURCE_EXTS).toContain('.webp');
    expect(THUMB_SOURCE_EXTS).not.toContain('.pdf');
  });
});
