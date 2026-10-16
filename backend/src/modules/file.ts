import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import multer from 'multer';
import { queryOne, execute } from '../config/db';
import { authMiddleware } from '../middleware/auth';
import { requirePermission } from '../middleware/rbac';
import { ok, fail, AppError } from '../utils/response';
import { writeAudit } from '../middleware/audit';
import { env } from '../config/env';

const router = Router();
router.use(authMiddleware);

// 上传目录（与 Excel 导入复用同一 UPLOAD_DIR，文件名随机生成，天然防路径穿越）
const UPLOAD_DIR = path.resolve(env.uploadDir);
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

/** 允许的附件类型：合同 PDF + 发票/现场图片 */
const ALLOWED_EXT = ['.pdf', '.jpg', '.jpeg', '.png', '.webp'] as const;
const EXT_CONTENT_TYPE: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`);
  },
});

// 不限制文件大小（由 nginx client_max_body_size 与磁盘空间约束）；
// 仅保留扩展名白名单这道安全闸门，挡住非 PDF / 图片的上传。
const upload = multer({
  storage,
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if ((ALLOWED_EXT as readonly string[]).includes(ext)) cb(null, true);
    else cb(new AppError('仅支持 PDF / JPG / JPEG / PNG / WEBP 文件', 400, 'INVALID_FILE_TYPE'));
  },
});

// ---------------------------------------------------------------------------
// 上传：写完 file_info（biz_type/biz_id 暂留空，由业务保存时回填）
// 注意：/upload 必须定义在 /:id 之前，否则 'upload' 会被 :id 捕获
// ---------------------------------------------------------------------------
router.post('/upload', requirePermission('ledger:manage'), upload.single('file'), async (req: Request, res: Response) => {
  const file = req.file;
  if (!file) throw new AppError('未接收到文件', 400, 'NO_FILE');

  const ext = path.extname(file.originalname).toLowerCase();
  const contentType = EXT_CONTENT_TYPE[ext] || file.mimetype || 'application/octet-stream';
  const bizType = typeof req.body.bizType === 'string' && req.body.bizType ? req.body.bizType : null;
  const bizId = req.body.bizId ? Number(req.body.bizId) : null;

  const result = await execute(
    `INSERT INTO file_info (file_name, storage_name, file_type, file_size, storage_path, content_type, created_by, biz_type, biz_id)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [file.originalname, file.filename, ext.replace('.', ''), file.size, file.path, contentType, req.user!.id, bizType, bizId]
  );

  return ok(res, {
    id: result.insertId,
    fileName: file.originalname,
    fileType: ext.replace('.', ''),
    size: file.size,
    contentType,
  }, '上传成功');
});

// ---------------------------------------------------------------------------
// 预览 / 下载：按入库 content_type 流式返回，浏览器内 inline 渲染（PDF/图片）
// ---------------------------------------------------------------------------
router.get('/:id', requirePermission('ledger:view'), async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const file = await queryOne<any>('SELECT * FROM file_info WHERE id = ?', [id]);
  if (!file || !file.storage_path || !fs.existsSync(file.storage_path)) {
    throw new AppError('文件不存在或已丢失', 404, 'NOT_FOUND');
  }
  // 用库内自认定的 content_type，不轻信客户端；强制 nosniff 防 MIME 嗅探
  res.setHeader('Content-Type', file.content_type || 'application/octet-stream');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(file.file_name)}"`);
  const stream = fs.createReadStream(file.storage_path);
  stream.on('error', () => { if (!res.headersSent) fail(res, '文件读取失败', 500, 'READ_ERROR'); });
  stream.pipe(res);
});

// ---------------------------------------------------------------------------
// 删除：仅允许本人上传或管理员；同时清理物理文件
// ---------------------------------------------------------------------------
router.delete('/:id', requirePermission('ledger:manage'), async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const file = await queryOne<any>('SELECT * FROM file_info WHERE id = ?', [id]);
  if (!file) throw new AppError('文件不存在', 404, 'NOT_FOUND');

  const user = req.user!;
  if (!user.isAdmin && file.created_by !== user.id) {
    throw new AppError('只能删除自己上传的文件', 403, 'FORBIDDEN');
  }

  // 先删库记录（含事务语义的单条删除），再清理磁盘
  await execute('DELETE FROM file_info WHERE id = ?', [id]);
  try { if (file.storage_path && fs.existsSync(file.storage_path)) fs.unlinkSync(file.storage_path); } catch { /* 忽略 */ }

  await writeAudit({ userId: user.id, username: user.username, action: 'file:delete', request: { id, name: file.file_name }, result: 'SUCCESS', ip: req.ip });
  return ok(res, { id }, '文件已删除');
});

export default router;
