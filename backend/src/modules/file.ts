import { Router, Request, Response, NextFunction } from 'express';
import path from 'path';
import fs from 'fs';
import multer from 'multer';
import { z } from 'zod';
import { query, queryOne, execute } from '../config/db';
import { authMiddleware } from '../middleware/auth';
import { hasAnyPermission } from '../middleware/rbac';
import { ok, okPage, fail, AppError, PageResult } from '../utils/response';
import { writeAudit } from '../middleware/audit';
import { dateTimeCN } from '../utils/date';
import { env } from '../config/env';

const router = Router();
router.use(authMiddleware);

// 上传目录（与 Excel 导入复用同一 UPLOAD_DIR）
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

// ---------------------------------------------------------------------------
// 归属类型与权限
// ---------------------------------------------------------------------------

/**
 * 附件归属类型。只允许挂在「人员」或「台账」上——
 * 新增一种归属要同时改两处：这个常量、下面 attachmentPermissions 的映射。
 *
 * 注意「不属于任何业务」也是合法的：PC 台账是**先传附件、保存记录时再认领**
 * （见 ledger.ts 的 linkAttachments），那条路径必须继续放行。
 */
export const BIZ_TYPES = ['PERSON', 'LEDGER'] as const;

/**
 * 附件的权限**跟随归属对象的权限**，不再一律用台账权限卡着。
 *
 * 为什么必须这样：现场照片是「给某个人员留痕」，拍照的人持有的是人员类权限；
 * 如果一张人员照片要人来证明自己有台账权限才能看/传，那么给村民拍照这件事
 * 在权限配置上就说不通了——它跟台账本来没有关系。
 */
export function attachmentPermissions(bizType: string | null, action: 'view' | 'manage'): string[] {
  if (bizType === 'PERSON') {
    // 兼容 admin 台账账号：以前传过的照片仍归同一批人管
    return action === 'view' ? ['person:view', 'ledger:view'] : ['person:edit', 'ledger:manage'];
  }
  return action === 'view' ? ['ledger:view'] : ['ledger:manage'];
}

function ensurePermission(req: Request, codes: string[], message = '无操作权限'): void {
  if (!hasAnyPermission(req, codes)) throw new AppError(message, 403, 'FORBIDDEN');
}

/**
 * 上传前的粗闸门。放在 multer 之前，让没权限的人一个字节都别落盘；
 * 精确到 bizType 的判断只能等表单字段解析完（见 handler 内）。
 */
function preUploadGuard(req: Request, res: Response, next: NextFunction) {
  if (hasAnyPermission(req, ['person:edit', 'ledger:manage'])) return next();
  fail(res, '无操作权限', 403, 'FORBIDDEN');
}

// ---------------------------------------------------------------------------
// 命名：一律以「拍摄时间」为准
//
// 落盘布局（运维手册里的写法，也是备份时直接照着拷的路径）：
//     uploads/张三/2026-10-16-13-00-05.jpg
//   第一层目录 = 一个人（台账、未归属同理），文件名 = 日期-详细时间。
//   这样「哪天去谁家拍的」不进数据库也能读出来，导出照片时按人名拷目录即可。
// ---------------------------------------------------------------------------

/** 北京时间偏移。mysql2 连接配的是 timezone '+08:00'，文件名必须跟它同一口径 */
const CN_OFFSET_MS = 8 * 60 * 60 * 1000;

/**
 * 文件名时间戳 `yyyy-MM-dd-HHmmss`，固定按北京时间输出。
 *
 * 用 `-` 而不是 `:` 分隔时刻：`:` 在 Windows / NTFS 上是非法字符，
 * 村委那台电脑（以及任何在 Windows 上解开备份的人）会拿不到文件。
 * 精确到秒，是因为「详细时间」得能区分同一分钟里连拍的多张照片。
 *
 * 不用 `toLocaleString` / `Intl`：容器时区常是 UTC，而镜像里的 ICU 数据不一定全，
 * 「本机时区」和「有没有 tz 数据」都会让结果变得不可预测。手工移位最稳。
 */
export function stampOf(at: Date): string {
  const t = new Date(at.getTime() + CN_OFFSET_MS);
  const p = (n: number) => String(n).padStart(2, '0');
  return (
    `${t.getUTCFullYear()}-${p(t.getUTCMonth() + 1)}-${p(t.getUTCDate())}` +
    `-${p(t.getUTCHours())}-${p(t.getUTCMinutes())}-${p(t.getUTCSeconds())}`
  );
}

/**
 * 解析客户端上报的拍摄时间，容忍三种写法：13 位毫秒、10 位秒、ISO 字符串。
 *
 * 越界就当作没给（返回 null）而不是报错：手机时钟被改乱是常事，
 * 不能因为一个时间戳就让村民传不上照片。范围取「2000 年之后、不超过明天」。
 */
export function normalizeCapturedAt(raw: unknown): Date | null {
  if (raw === undefined || raw === null || raw === '') return null;
  // 数字与数字字符串走同一条路：手机端两种上报形式都出现过，而且
  // 表单字段（multipart）拿到的永远是字符串，不能只对字符串做位数判断。
  const s = String(raw).trim();
  let ms: number;
  if (/^\d+$/.test(s)) {
    const n = Number(s);
    // 10 位及以下是「秒」，更长的是「毫秒」。误把秒当毫秒会落到 1970 而被判越界，
    // 结果是「有拍照时间的照片反而按上传时间命名」——正好丢掉最想留的那条线索。
    ms = s.length <= 10 ? n * 1000 : n;
  } else {
    ms = Date.parse(s);
  }
  if (!Number.isFinite(ms)) return null;
  if (ms < Date.UTC(2000, 0, 1)) return null;
  if (ms > Date.now() + 24 * 60 * 60 * 1000) return null;
  return new Date(ms);
}

/** 展示名保留中文（后台列表/下载时要能一眼看懂这是谁的照片），只挡路径分隔符与控制字符 */
export function sanitizeDisplayName(name: string): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|]/g, '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
  return cleaned || 'file';
}

/** 目录名兜底：只有在人名被洗成空串时才会用到，正常都有值 */
const FALLBACK_FOLDER = 'unknown';

/**
 * 目录名（人名）。**保留中文**——用户要的就是「人名文件夹」，
 * 换成 ASCII 就把「按人名备份、按人名找」这件事的意义抹掉了。
 *
 * 但下面这些字符必须去掉，人名来自数据库，不是可信输入：
 *  · `\` `/` —— 路径分隔符，一旦混进 `../` 就能把文件写出上传目录之外；
 *  · 控制字符 —— 会破坏日志与终端输出；
 *  · `. : * ? " < > |` —— Windows 非法字符，顺便把 `..` 也打散（点被去掉后只剩空串，走兜底）。
 */
export function sanitizeFolderName(name: string): string {
  const cleaned = name
    .replace(/[\\/]/g, '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f]/g, '')
    .replace(/[.:*?"<>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40);
  return cleaned || FALLBACK_FOLDER;
}

export interface FileNamingInput {
  /** 用于命名的时间（有拍摄时间就用它，没有就用上传时间） */
  at: Date;
  /** 含点的扩展名，如 '.jpg' */
  ext: string;
  bizType: string | null;
  bizId: number | null;
  /** 关联人员姓名（仅 PERSON 有）：既是展示名的一部分，也是**目录名** */
  personName?: string | null;
  personNo?: string | null;
}

/** 展示名里「这段是谁」的部分 */
function displayTagOf(input: FileNamingInput): string {
  if (input.bizType === 'PERSON') {
    const parts = [input.personName, input.personNo].filter((v): v is string => !!v && v.trim() !== '');
    return parts.length ? parts.join('-') : `人员${input.bizId ?? ''}`;
  }
  if (input.bizType === 'LEDGER') return `台账${input.bizId ?? ''}`;
  return '未关联';
}

/**
 * 目录名：人员用**人名**，台账用编号，还没认领的 PC 附件单独一层。
 *
 * 不按村庄/网格再分一层：一个人只属于一个村，多一层目录只会让备份时多点几次，
 * 却换不来任何信息——真要按村筛，那是数据库该干的事。
 */
export function folderOf(input: FileNamingInput): string {
  if (input.bizType === 'PERSON') {
    const name = input.personName?.trim();
    return name ? sanitizeFolderName(name) : `person-${input.bizId ?? 0}`;
  }
  if (input.bizType === 'LEDGER') return `台账${input.bizId ?? ''}`;
  return '未关联';
}

export interface BuiltNames {
  /** 入库 file_name，也是下载时给用户看的名字：`2026-10-16-13-00-05-张三-P000123.jpg` */
  displayName: string;
  /** 落盘相对路径（相对 UPLOAD_DIR）：`张三/2026-10-16-13-00-05.jpg` */
  relPath: string;
}

/**
 * 生成两个名字（纯函数，可直接单测）：
 *
 *   · displayName —— 入库的 `file_name`：`2026-10-16-13-00-05-张三-P000123.jpg`。
 *     之所以还带着人名：这个名字会被 PC 与手机端**单独展示**（照片卡片、
 *     放大查看的说明文字），那里没有「目录」这层上下文，去掉人名就只剩一串时间。
 *   · relPath     —— 落盘路径：`张三/2026-10-16-13-00-05.jpg`。
 *     目录即人名、文件名即拍摄时刻，在服务器上翻目录就能读。
 *
 * 两者都以拍摄时间开头，所以按名字排序 = 按拍摄时间排序。
 * 名字里**不含随机串**（上一版在文件名里塞 salt）：撞名由 uniqueStorageName
 * 在真正落盘前查一次磁盘再补后缀，纯函数的输出因此是完全可预期的。
 */
export function buildFileNames(input: FileNamingInput): BuiltNames {
  const stamp = stampOf(input.at);
  return {
    displayName: sanitizeDisplayName(`${stamp}-${displayTagOf(input)}${input.ext}`),
    relPath: `${folderOf(input)}/${stamp}${input.ext}`,
  };
}

/**
 * 撞名才补随机串（同一秒给同一个人拍了多张）。
 * 不撞就原样返回，保持「名字=拍摄时间」这条可读性不被随机串破坏。
 *
 * 拼接一律用 `/` 而不是 path.join：后者在 Windows 上给出 `\`，
 * 同一个 human （台北份和一个 Linux 份）的库里就会出现两种分隔符，
 * 备份换机后可能找不着。库里统一存 `/`，读的时候交给 path 去解析。
 */
function uniqueStorageName(relPath: string): string {
  if (!fs.existsSync(path.join(UPLOAD_DIR, relPath))) return relPath;

  const slash = relPath.lastIndexOf('/');
  const dir = slash >= 0 ? relPath.slice(0, slash) : '';
  const name = slash >= 0 ? relPath.slice(slash + 1) : relPath;

  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';

  const prefix = dir ? `${dir}/` : '';
  for (let i = 0; i < 5; i += 1) {
    const candidate = `${prefix}${base}-${Math.random().toString(36).slice(2, 6)}${ext}`;
    if (!fs.existsSync(path.join(UPLOAD_DIR, candidate))) return candidate;
  }
  return `${prefix}${base}-${Date.now()}${ext}`;
}

/**
 * 把相对路径锚死在 UPLOAD_DIR 之内。
 *
 * 目录名来自数据库里的人名，虽然已被 sanitizeFolderName 洗过一遍，
 * 这里仍按**解析后的绝对路径**复核一次：少这道断言，一次疏漏就是任意路径写文件。
 */
function resolveInsideUploadDir(relPath: string): string {
  const abs = path.resolve(UPLOAD_DIR, relPath);
  if (abs !== UPLOAD_DIR && !abs.startsWith(UPLOAD_DIR + path.sep)) {
    throw new AppError('非法的存储路径', 400, 'INVALID_STORAGE_PATH');
  }
  return abs;
}

// multer 先落一个临时名：bizType / capturedAt 都是表单字段，
// filename 回调跑在字段解析完之前，那里拿不到它们，只能等 handler 里再改成正式名。
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`);
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
// 上传
// 注意：/upload 必须定义在 /:id 之前，否则 'upload' 会被 :id 捕获
// ---------------------------------------------------------------------------
router.post('/upload', preUploadGuard, upload.single('file'), async (req: Request, res: Response) => {
  const file = req.file;
  if (!file) throw new AppError('未接收到文件', 400, 'NO_FILE');

  try {
    const ext = path.extname(file.originalname).toLowerCase();
    const contentType = EXT_CONTENT_TYPE[ext] || file.mimetype || 'application/octet-stream';

    const rawBizType = typeof req.body.bizType === 'string' ? req.body.bizType.trim().toUpperCase() : '';
    const bizType: string | null = rawBizType || null;
    const bizId = parsePositiveInt(req.body.bizId);

    if (bizType && !(BIZ_TYPES as readonly string[]).includes(bizType)) {
      throw new AppError(`bizType 只支持 ${BIZ_TYPES.join(' / ')}`, 400, 'INVALID_BIZ_TYPE');
    }
    if (bizType && bizId === null) {
      throw new AppError('挂到业务记录上时必须给出 bizId', 400, 'INVALID_BIZ_ID');
    }
    ensurePermission(req, attachmentPermissions(bizType, 'manage'));

    // 归属对象必须真实存在：否则会留下一批永远查不到的孤儿附件
    let personName: string | null = null;
    let personNo: string | null = null;
    if (bizType === 'PERSON') {
      const p = await queryOne<any>('SELECT name, person_no FROM person WHERE id = ?', [bizId]);
      if (!p) throw new AppError('关联的人员不存在', 400, 'PERSON_NOT_FOUND');
      personName = p.name;
      personNo = p.person_no;
    } else if (bizType === 'LEDGER') {
      const l = await queryOne<any>('SELECT id FROM ledger_record WHERE id = ?', [bizId]);
      if (!l) throw new AppError('关联的台账记录不存在', 400, 'LEDGER_NOT_FOUND');
    }

    const capturedAt = normalizeCapturedAt(req.body.capturedAt);
    // 有拍摄时间（手机拍照留痕）→ 服务端统一命名，人不用管；
    // 没有（PC 传合同/发票）→ 保留原始文件名，只把落盘位置换成「目录 + 时间」。
    const named = buildFileNames({
      at: capturedAt ?? new Date(),
      ext,
      bizType,
      bizId,
      personName,
      personNo,
    });
    const displayName = capturedAt ? named.displayName : sanitizeDisplayName(file.originalname);
    const relPath = uniqueStorageName(named.relPath);

    // 目录即人名：先建目录（可能有多层），再把 multer 的临时文件挪过去。
    // rename 在跨设备时会 EXDEV 失败，但临时文件与目标都在 UPLOAD_DIR 下，同盘。
    const finalPath = resolveInsideUploadDir(relPath);
    fs.mkdirSync(path.dirname(finalPath), { recursive: true });
    fs.renameSync(file.path, finalPath);

    const result = await execute(
      `INSERT INTO file_info (file_name, storage_name, file_type, file_size, storage_path, content_type, created_by, biz_type, biz_id, captured_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [displayName, relPath, ext.replace('.', ''), file.size, finalPath, contentType, req.user!.id, bizType, bizId, capturedAt]
    );

    if (bizType) {
      await writeAudit({
        userId: req.user!.id,
        username: req.user!.username,
        action: 'file:upload',
        request: { id: result.insertId, name: displayName, bizType, bizId },
        result: 'SUCCESS',
        ip: req.ip,
      });
    }

    return ok(res, {
      id: result.insertId,
      fileName: displayName,
      fileType: ext.replace('.', ''),
      size: file.size,
      contentType,
      bizType,
      bizId,
      // 时间一律给北京时间文本：客户端拿到就能直接显示，
      // 不需要（也不应该）各自做一次时区换算——那是「显示成 8 小时前」的来源
      capturedAt: dateTimeCN(capturedAt),
      createdAt: dateTimeCN(new Date()),
    }, '上传成功');
  } catch (e) {
    // 出错就别把临时文件漏在磁盘上
    try { if (file.path && fs.existsSync(file.path)) fs.unlinkSync(file.path); } catch { /* 忽略 */ }
    throw e;
  }
});

// ---------------------------------------------------------------------------
// 列表：按归属对象查附件（「这个人的现场照片」「这条台账的发票」）
// ---------------------------------------------------------------------------
const listSchema = z.object({
  bizType: z.string(),
  bizId: z.coerce.number().int().positive(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(100),
});

router.get('/', async (req: Request, res: Response) => {
  const q = listSchema.parse(req.query);
  const bizType = q.bizType.trim().toUpperCase();
  if (!(BIZ_TYPES as readonly string[]).includes(bizType)) {
    throw new AppError(`bizType 只支持 ${BIZ_TYPES.join(' / ')}`, 400, 'INVALID_BIZ_TYPE');
  }
  ensurePermission(req, attachmentPermissions(bizType, 'view'));

  const totalRow = await queryOne<any>(
    'SELECT COUNT(*) AS cnt FROM file_info WHERE biz_type = ? AND biz_id = ?',
    [bizType, q.bizId]
  );
  const total = Number(totalRow?.cnt || 0);

  // 有拍摄时间就按拍摄时间排——现场照片的排序要用「什么时候拍的」，
  // 而不是「什么时候传上来的」（离线补传时后者会全挤在同一时刻）。
  const rows = await query<any>(
    `SELECT id, file_name, file_type, file_size, content_type, biz_type, biz_id, captured_at, created_at
     FROM file_info
     WHERE biz_type = ? AND biz_id = ?
     ORDER BY COALESCE(captured_at, created_at) DESC, id DESC
     LIMIT ? OFFSET ?`,
    [bizType, q.bizId, q.pageSize, (q.page - 1) * q.pageSize]
  );

  const result: PageResult<any> = {
    list: rows.map((r: any) => ({
      id: r.id,
      fileName: r.file_name,
      fileType: r.file_type,
      size: Number(r.file_size || 0),
      contentType: r.content_type,
      bizType: r.biz_type,
      bizId: r.biz_id,
      // DATETIME 原样返回会变成 ISO 的 UTC 串（2026-10-16T05:00:00.000Z），
      // 客户端随手切前 16 位就会把 13:00 显示成 05:00 —— 现场照片的时间是取证信息，
      // 统一在服务端换成北京时间文本再出去，见 utils/date.ts 的 dateTimeCN
      capturedAt: dateTimeCN(r.captured_at),
      createdAt: dateTimeCN(r.created_at),
    })),
    total,
    page: q.page,
    pageSize: q.pageSize,
  };
  return okPage(res, result);
});

// ---------------------------------------------------------------------------
// 预览 / 下载：按入库 content_type 流式返回，浏览器内 inline 渲染（PDF/图片）
// ---------------------------------------------------------------------------
router.get('/:id', async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const file = await queryOne<any>('SELECT * FROM file_info WHERE id = ?', [id]);
  if (!file || !file.storage_path || !fs.existsSync(file.storage_path)) {
    throw new AppError('文件不存在或已丢失', 404, 'NOT_FOUND');
  }
  // 权限按文件自己的归属判：人员照片不能被台账权限挡住，反之亦然
  ensurePermission(req, attachmentPermissions(file.biz_type ?? null, 'view'));

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
router.delete('/:id', async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const file = await queryOne<any>('SELECT * FROM file_info WHERE id = ?', [id]);
  if (!file) throw new AppError('文件不存在', 404, 'NOT_FOUND');

  const user = req.user!;
  ensurePermission(req, attachmentPermissions(file.biz_type ?? null, 'manage'));
  if (!user.isAdmin && file.created_by !== user.id) {
    throw new AppError('只能删除自己上传的文件', 403, 'FORBIDDEN');
  }

  // 先删库记录（含事务语义的单条删除），再清理磁盘
  await execute('DELETE FROM file_info WHERE id = ?', [id]);
  try { if (file.storage_path && fs.existsSync(file.storage_path)) fs.unlinkSync(file.storage_path); } catch { /* 忽略 */ }

  // 目录即人名：这个人的最后一张照片删掉后，空目录留着只会让备份里多出一堆空壳。
  // rmdir 只在目录为空时成功，非空会抛错——正好当条件用，不需要额外的判断。
  try {
    const dir = file.storage_path ? path.dirname(file.storage_path) : '';
    if (dir && dir !== UPLOAD_DIR) fs.rmdirSync(dir);
  } catch { /* 目录非空或不存在，都无所谓 */ }

  await writeAudit({ userId: user.id, username: user.username, action: 'file:delete', request: { id, name: file.file_name }, result: 'SUCCESS', ip: req.ip });
  return ok(res, { id }, '文件已删除');
});

function parsePositiveInt(raw: unknown): number | null {
  if (raw === undefined || raw === null || raw === '') return null;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export default router;
