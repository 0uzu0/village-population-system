import sharp from 'sharp';

/**
 * 附件缩略图（v2.3.2）。
 *
 * 为什么要有缩略图：现场照片是手机原片（单张 2–5MB），人员详情页的
 * 照片网格格子只有 120px 高——为一个小格子传输整张原片，几张照片就能
 * 把详情页拖到十几秒。缩略图把网格展示的字节数降到几十 KB，
 * 点开大图时才按需取原片（原片永远是取证材料，一份不少地保留）。
 *
 * 存储约定：缩略图是**派生文件**，不进数据库——路径由原片 storage_path
 * 派生（`<原片路径>.thumb.webp`），不存在就按需现生成（存量照片不用跑迁移）。
 * 删除原片时把缩略图一并删掉（file.ts 的 DELETE）。
 */

/** 缩略图最长边（px）。详情页格子 120px 高、2x 屏 ≈ 240px，320 留了余量 */
export const THUMB_MAX_EDGE = 320;

/** 缩略图文件名后缀：拼在原片路径后面（同目录，删除/备份逻辑不用多管一层） */
export const THUMB_SUFFIX = '.thumb.webp';

/** 缩略图统一转 webp：同样观感下体积最小，现代浏览器全支持 */
export const THUMB_CONTENT_TYPE = 'image/webp';

/** 会生成缩略图的图片扩展名（与 file.ts 的白名单图片子集一致；PDF 没有） */
export const THUMB_SOURCE_EXTS: readonly string[] = ['.jpg', '.jpeg', '.png', '.webp'];

/**
 * 由原片绝对路径得到缩略图绝对路径（纯函数）。
 */
export function thumbPathOf(storagePath: string): string {
  return `${storagePath}${THUMB_SUFFIX}`;
}

/**
 * 为一张图片生成缩略图并落盘。
 *
 * - `.rotate()` 按 EXIF 方向自动转正：手机竖拍的原片 EXIF 里带旋转标记，
 *   不转的话缩略图是躺着的（浏览器 <img> 原图会转、webp 再生不会）。
 * - `fit: 'inside' + withoutEnlargement`：只缩不放，小图保持原尺寸。
 *
 * 抛错由调用方决定怎么处理：上传路径里生成失败**不能**让上传失败
 * （照片本体已经落盘成功），懒生成路径里失败则回 404 让前端退回原图。
 */
export async function makeThumbnail(sourcePath: string, destPath: string): Promise<void> {
  await sharp(sourcePath)
    .rotate()
    .resize(THUMB_MAX_EDGE, THUMB_MAX_EDGE, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 70 })
    .toFile(destPath);
}
