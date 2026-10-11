import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import multer from 'multer';
import ExcelJS from 'exceljs';
import { query, queryOne, execute, withTransaction } from '../config/db';
import { authMiddleware } from '../middleware/auth';
import { requirePermission, buildGridFilter } from '../middleware/rbac';
import { ok, okPage, fail, AppError, PageResult } from '../utils/response';
import { writeAudit } from '../middleware/audit';
import { validateIdCard, birthFromIdCard, genderFromIdCard } from '../utils/idcard';
import { env } from '../config/env';
import { z } from 'zod';

const router = Router();
router.use(authMiddleware);

// 上传目录
const UPLOAD_DIR = path.resolve(env.uploadDir);
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${path.extname(file.originalname)}`),
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === '.xlsx' || ext === '.xls') cb(null, true);
    else cb(new AppError('仅支持 .xlsx / .xls 文件', 400, 'INVALID_FILE_TYPE'));
  },
});

/**
 * 导入模板字段定义（严格按列顺序解析）。
 * 第 12 列「备用手机号」为后加字段，旧的 11 列表格仍可正常导入，该列按空处理。
 */
const IMPORT_COLUMNS = ['姓名', '性别', '出生日期', '身份证号', '手机号', '户籍地址', '实际居住地址', '所属村庄', '网格编号', '家庭编号', '与户主关系', '备用手机号'];

/** 下载导入模板 */
router.get('/template', requirePermission('excel:import'), async (_req: Request, res: Response) => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('人口导入模板');
  ws.columns = IMPORT_COLUMNS.map((c) => ({ header: c, key: c, width: 18 }));
  ws.addRow(['张三', '男', '1990-01-01', '320102199001011234', '13800000000', '示例村一巷1号', '示例村一巷1号', '幸福村', 'G001', 'F001', '户主', '13900000000']);
  ws.getRow(1).font = { bold: true };
  ws.getRow(2).getCell('身份证号').numFmt = '@';

  const buf = await wb.xlsx.writeBuffer();
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="population_import_template.xlsx"');
  res.send(Buffer.from(buf));
});

/** 读取并解析 Excel 行 */
async function readRows(filePath: string): Promise<Record<string, any>[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const ws = wb.worksheets[0];
  const rows: Record<string, any>[] = [];
  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // 跳过表头
    const obj: Record<string, any> = {};
    IMPORT_COLUMNS.forEach((c, i) => {
      const cell = row.getCell(i + 1);
      obj[c] = cell.value == null ? '' : String(cell.value).trim();
    });
    if (Object.values(obj).some((v) => v !== '')) rows.push(obj);
  });
  return rows;
}

/** 校验并准备导入行，返回 { valid, error }；身份证缺失/非法时返回 { pending } 转待核查表 */
async function validateImportRow(row: Record<string, any>, rowNo: number, gridMap: Map<string, number>, familyMap: Map<string, number>, seenIdCards: Set<string>, existingIdCards: Set<string>): Promise<{ ok: boolean; message?: string; person?: any; pending?: any }> {
  if (!row['姓名']) return { ok: false, message: '姓名为空' };

  const genderText = row['性别'];
  let gender: string | null = null;
  if (genderText === '男') gender = 'MALE';
  else if (genderText === '女') gender = 'FEMALE';
  else if (genderText) return { ok: false, message: `性别必须为「男」或「女」，实际为「${genderText}」` };

  /** 待核查记录的基础字段：身份证不可用时原样留存，供人工补录后确认入库 */
  const basePending = {
    name: row['姓名'],
    gender,
    birth_date: row['出生日期'] || null,
    id_card: row['身份证号'] || null,
    phone: row['手机号'] || null,
    phone_backup: row['备用手机号'] || null,
    hukou_address: row['户籍地址'] || null,
    live_address: row['实际居住地址'] || null,
    village: row['所属村庄'] || null,
    grid_no: row['网格编号'] || null,
    family_no: row['家庭编号'] || null,
    relation: row['与户主关系'] || null,
    raw_data: JSON.stringify(row),
  };

  let idCardNormalized: string | null = null;
  if (!row['身份证号']) {
    // 核心规则：身份证号为空不进入正式档案，转入待核查表
    return { ok: true, pending: { ...basePending, reason: 'ID_CARD_MISSING', reason_text: '身份证号为空，需人工核实补录' } };
  }
  const check = validateIdCard(row['身份证号']);
  if (!check.valid) {
    // 身份证号非法同样无法建立可信档案，一并转待核查
    return { ok: true, pending: { ...basePending, reason: 'ID_CARD_INVALID', reason_text: `身份证号：${check.message}` } };
  }
  idCardNormalized = check.normalized!;
  if (seenIdCards.has(idCardNormalized)) return { ok: false, message: '文件中存在重复身份证号' };
  seenIdCards.add(idCardNormalized);
  // 已有档案身份证在导入前一次性载入内存，避免每行一次数据库往返（万行级导入会拖垮耗时）
  if (existingIdCards.has(idCardNormalized)) return { ok: false, message: '该身份证号已存在于系统档案中（禁止覆盖）' };

  const gridNo = row['网格编号'];
  let gridId: number | null = null;
  if (gridNo) {
    if (!gridMap.has(gridNo)) return { ok: false, message: `网格编号「${gridNo}」不存在` };
    gridId = gridMap.get(gridNo)!;
  }

  const familyNo = row['家庭编号'];
  let familyId: number | null = null;
  if (familyNo) {
    if (!familyMap.has(familyNo)) return { ok: false, message: `家庭编号「${familyNo}」不存在` };
    familyId = familyMap.get(familyNo)!;
  }

  const birthDate = row['出生日期'] || (idCardNormalized ? birthFromIdCard(idCardNormalized) : null);
  const genderFinal = gender || (idCardNormalized ? genderFromIdCard(idCardNormalized) : 'MALE');

  return {
    ok: true,
    person: {
      name: row['姓名'],
      gender: genderFinal,
      birth_date: birthDate,
      id_card: idCardNormalized,
      phone: row['手机号'] || null,
      phone_backup: row['备用手机号'] || null,
      hukou_address: row['户籍地址'] || null,
      live_address: row['实际居住地址'] || null,
      village: row['所属村庄'] || null,
      grid_id: gridId,
      family_id: familyId,
      relation: row['与户主关系'] ? (row['与户主关系'] === '户主' ? 'HEAD' : row['与户主关系']) : null,
    },
  };
}

/** 导入人口（同步处理，记录批次与错误） */
router.post('/import', requirePermission('excel:import'), upload.single('file'), async (req: Request, res: Response) => {
  if (!req.file) return fail(res, '请上传 Excel 文件');
  const batchNo = (req.body.batchNo as string) || `IMP${Date.now()}`;

  // 幂等：同一批次号禁止重复提交
  const existed = await queryOne<any>('SELECT id FROM excel_import_task WHERE batch_no = ?', [batchNo]);
  if (existed) throw new AppError('该批次已提交过，请勿重复导入', 409, 'DUPLICATE_BATCH');

  const gridRows = await query<any>('SELECT grid_no, id FROM grid');
  const gridMap = new Map(gridRows.map((g: any) => [g.grid_no, g.id]));
  const familyRows = await query<any>('SELECT family_no, id FROM family');
  const familyMap = new Map(familyRows.map((f: any) => [f.family_no, f.id]));

  // 一次性载入已有身份证号（村里人口量级通常 < 10 万，内存可控）
  const existingCardRows = await query<any>('SELECT id_card FROM person WHERE id_card IS NOT NULL AND id_card <> \'\'');
  const existingIdCards = new Set<string>(existingCardRows.map((r: any) => String(r.id_card)));

  const rows = await readRows(req.file.path);
  const taskResult = await execute(
    `INSERT INTO excel_import_task (file_id, batch_no, status, total_rows, success_count, fail_count, created_by)
     VALUES (NULL, ?, 'RUNNING', ?, 0, 0, ?)`,
    [batchNo, rows.length, req.user!.id]
  );
  const taskId = taskResult.insertId;

  const seenIdCards = new Set<string>();
  let success = 0;
  const errors: { rowNo: number; message: string; raw: string }[] = [];
  const pendings: { rowNo: number; pending: any }[] = [];

  const validPersons: { person: any }[] = [];

  for (let i = 0; i < rows.length; i++) {
    const rowNo = i + 2; // Excel 实际行号（含表头）
    const v = await validateImportRow(rows[i], rowNo, gridMap, familyMap, seenIdCards, existingIdCards);
    if (!v.ok) {
      errors.push({ rowNo, message: v.message!, raw: rows[i]['姓名'] || '' });
    } else if (v.pending) {
      pendings.push({ rowNo, pending: v.pending });
    } else {
      validPersons.push({ person: v.person! });
    }
  }

  // 写入有效行（事务）
  if (validPersons.length) {
    await withTransaction(async (conn) => {
      for (const { person } of validPersons) {
        const relation: string | null = person.relation || null;
        const r: any = await conn.query(
          `INSERT INTO person (person_no, name, gender, birth_date, id_card, phone, phone_backup,
            hukou_address, live_address, village, grid_id, family_id, relation, status, data_source, created_by, updated_by)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?, 'NORMAL', 'EXCEL_IMPORT', ?, ?)`,
          [
            `P${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
            person.name, person.gender, person.birth_date, person.id_card, person.phone, person.phone_backup || null,
            person.hukou_address, person.live_address, person.village,
            person.grid_id, person.family_id, relation, req.user!.id, req.user!.id,
          ]
        );
        const newId = (r[0] as any).insertId;
        if (person.family_id) {
          // 保留 Excel 中填写的与户主关系（户主 / 妻 / 子 / 女 …），并标记是否户主
          await conn.query(
            'INSERT IGNORE INTO family_member (family_id, person_id, relation, is_householder) VALUES (?,?,?,?)',
            [person.family_id, newId, relation || 'OTHER', relation === 'HEAD' ? 1 : 0]
          );
          // 导入到户主时自动回填家庭的户主字段
          if (relation === 'HEAD') {
            await conn.query('UPDATE family SET head_person_id = ? WHERE id = ? AND head_person_id IS NULL', [newId, person.family_id]);
          }
        }
      }
    });
    success = validPersons.length;
  }

  // 记录错误
  for (const e of errors) {
    await execute('INSERT INTO excel_import_error (task_id, row_no, message, raw_data) VALUES (?,?,?,?)', [taskId, e.rowNo, e.message, e.raw]);
  }

  // 身份证缺失/非法的行落到待核查表，等待人工补录
  if (pendings.length) {
    await withTransaction(async (conn) => {
      for (const { rowNo, pending } of pendings) {
        await conn.query(
          `INSERT INTO import_pending (batch_no, row_no, reason, reason_text, name, gender, birth_date, id_card,
             phone, phone_backup, hukou_address, live_address, village, grid_no, family_no, relation, raw_data, created_by)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [
            batchNo, rowNo, pending.reason, pending.reason_text, pending.name, pending.gender,
            pending.birth_date || null, pending.id_card || null, pending.phone, pending.phone_backup,
            pending.hukou_address, pending.live_address, pending.village, pending.grid_no, pending.family_no,
            pending.relation, pending.raw_data, req.user!.id,
          ]
        );
      }
    });
  }
  const pendingCount = pendings.length;

  // 待核查行不计为失败，但会标记任务为「部分成功」，提醒人工跟进
  const finalStatus = success === 0 && pendingCount === 0 ? 'FAILED' : (errors.length > 0 || pendingCount > 0 ? 'PARTIAL' : 'SUCCESS');
  await execute(
    'UPDATE excel_import_task SET status = ?, success_count = ?, fail_count = ?, pending_count = ?, finished_at = NOW() WHERE id = ?',
    [finalStatus, success, errors.length, pendingCount, taskId]
  );

  // 清理临时文件
  fs.unlink(req.file.path, () => {});

  await writeAudit({ userId: req.user!.id, username: req.user!.username, action: 'excel:import', request: { batchNo, total: rows.length, success, fail: errors.length, pending: pendingCount }, result: 'SUCCESS', ip: req.ip });
  return ok(
    res,
    { taskId, total: rows.length, success, fail: errors.length, pending: pendingCount, status: finalStatus },
    pendingCount ? `导入完成：成功 ${success} 条，失败 ${errors.length} 条，${pendingCount} 条转入待核查` : '导入完成'
  );
});

/** 导入任务列表 */
router.get('/import-tasks', requirePermission('excel:import'), async (req: Request, res: Response) => {
  const q = z.object({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(500).default(20) }).parse(req.query);
  const totalRow = await queryOne<any>('SELECT COUNT(*) AS cnt FROM excel_import_task');
  const rows = await query<any>(
    `SELECT eit.*, u.real_name AS operator_name FROM excel_import_task eit LEFT JOIN sys_user u ON u.id = eit.created_by
     ORDER BY eit.created_at DESC LIMIT ? OFFSET ?`,
    [q.pageSize, (q.page - 1) * q.pageSize]
  );
  const result: PageResult<any> = { list: rows, total: Number(totalRow?.cnt || 0), page: q.page, pageSize: q.pageSize };
  return okPage(res, result);
});

/** 导入错误记录 */
router.get('/import-tasks/:id/errors', requirePermission('excel:import'), async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const rows = await query<any>('SELECT * FROM excel_import_error WHERE task_id = ? ORDER BY row_no', [id]);
  return ok(res, rows);
});

/** 下载错误行 */
router.get('/import-tasks/:id/errors/download', requirePermission('excel:import'), async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const errors = await query<any>('SELECT row_no, field_name, message, raw_data FROM excel_import_error WHERE task_id = ? ORDER BY row_no', [id]);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('错误行');
  ws.columns = [
    { header: 'Excel行号', key: 'row_no', width: 12 },
    { header: '错误信息', key: 'message', width: 50 },
    { header: '姓名', key: 'raw_data', width: 20 },
  ];
  errors.forEach((e: any) => ws.addRow({ row_no: e.row_no, message: e.message, raw_data: e.raw_data }));
  const buf = await wb.xlsx.writeBuffer();
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="import_errors_${id}.xlsx"`);
  res.send(Buffer.from(buf));
});

// ================= 导出 =================

const exportSchema = z.object({
  fields: z.array(z.string()).optional(),
  keyword: z.string().optional(),
  gridId: z.coerce.number().optional(),
  familyId: z.coerce.number().optional(),
  gender: z.string().optional(),
  status: z.string().optional(),
  tagIds: z.string().optional(),
  tagMode: z.enum(['ANY', 'ALL']).or(z.literal('')).default('ANY'),
  minAge: z.coerce.number().optional(),
  maxAge: z.coerce.number().optional(),
});

/** 导出字段定义 */
const EXPORT_FIELDS: { key: string; label: string }[] = [
  { key: 'person_no', label: '人员编号' },
  { key: 'name', label: '姓名' },
  { key: 'gender', label: '性别' },
  { key: 'birth_date', label: '出生日期' },
  { key: 'id_card', label: '身份证号' },
  { key: 'phone', label: '手机号' },
  { key: 'phone_backup', label: '备用手机号' },
  { key: 'hukou_address', label: '户籍地址' },
  { key: 'live_address', label: '实际居住地址' },
  { key: 'village', label: '所属村庄' },
  { key: 'grid_name', label: '所属网格' },
  { key: 'family_name', label: '所属家庭' },
  { key: 'status', label: '人员状态' },
];

/** 创建导出任务（同步生成文件，记录任务状态与审计） */
router.post('/export', requirePermission('excel:export'), async (req: Request, res: Response) => {
  const body = exportSchema.parse(req.body);

  const where: string[] = ['1=1'];
  const params: any[] = [];
  if (body.keyword) { where.push('(p.name LIKE ? OR p.person_no LIKE ?)'); params.push(`%${body.keyword}%`, `%${body.keyword}%`); }
  if (body.gridId) { where.push('p.grid_id = ?'); params.push(body.gridId); }
  if (body.familyId) { where.push('p.family_id = ?'); params.push(body.familyId); }
  if (body.gender) { where.push('p.gender = ?'); params.push(body.gender); }
  if (body.status) { where.push('p.status = ?'); params.push(body.status); }

  const gridFilter = buildGridFilter(req, 'p.grid_id');
  if (gridFilter.where) { where.push(gridFilter.where.replace(/^ AND /, '')); params.push(...gridFilter.params); }

  if (body.minAge != null || body.maxAge != null) {
    if (body.minAge != null) { where.push('p.birth_date <= DATE_SUB(CURDATE(), INTERVAL ? YEAR)'); params.push(String(body.minAge)); }
    if (body.maxAge != null) { where.push('p.birth_date >= DATE_SUB(CURDATE(), INTERVAL ? YEAR)'); params.push(String(body.maxAge + 1)); }
  }
  if (body.tagIds) {
    const tagIds = body.tagIds.split(',').map((s) => parseInt(s, 10)).filter((n) => !isNaN(n));
    if (body.tagMode === 'ALL') {
      for (const t of tagIds) { where.push(`EXISTS (SELECT 1 FROM person_tag pt WHERE pt.person_id=p.id AND pt.tag_id=? AND pt.status='ACTIVE')`); params.push(t); }
    } else {
      where.push(`EXISTS (SELECT 1 FROM person_tag pt WHERE pt.person_id=p.id AND pt.status='ACTIVE' AND pt.tag_id IN (${tagIds.map(() => '?').join(',')}))`); params.push(...tagIds);
    }
  }

  const whereSql = where.join(' AND ');

  // 分批读取（避免一次加载上万条到内存）
  const BATCH = 2000;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('人口档案');
  const fields = (body.fields && body.fields.length ? body.fields : EXPORT_FIELDS.map((f) => f.key)).filter((k) => {
    return EXPORT_FIELDS.some((f) => f.key === k);
  });
  const headers = fields.map((k) => EXPORT_FIELDS.find((f) => f.key === k)!.label);
  ws.addRow(headers);
  ws.getRow(1).font = { bold: true };

  const taskResult = await execute(
    'INSERT INTO export_task (name, status, params, created_by) VALUES (?, ?, ?, ?)',
    ['人口档案导出', 'RUNNING', JSON.stringify(body), req.user!.id]
  );
  const taskId = taskResult.insertId;

  try {
    let offset = 0;
    let total = 0;
    while (true) {
      const rows = await query<any>(
        `SELECT p.*, g.name AS grid_name, f.family_no AS family_name
         FROM person p LEFT JOIN grid g ON g.id=p.grid_id LEFT JOIN family f ON f.id=p.family_id
         WHERE ${whereSql} ORDER BY p.id LIMIT ? OFFSET ?`,
        [...params, BATCH, offset]
      );
      if (!rows.length) break;
      for (const r of rows) {
        const rowData: any[] = [];
        for (const k of fields) {
          if (k === 'gender') rowData.push(r.gender === 'MALE' ? '男' : '女');
          else if (k === 'birth_date') rowData.push(r.birth_date ? new Date(r.birth_date).toISOString().slice(0, 10) : '');
          else if (k === 'grid_name') rowData.push(r.grid_name || '');
          else if (k === 'family_name') rowData.push(r.family_name || '');
          else if (k === 'status') rowData.push(r.status || '');
          else rowData.push(r[k] ?? '');
        }
        ws.addRow(rowData);
        total++;
      }
      if (rows.length < BATCH) break;
      offset += BATCH;
    }

    const fileName = `population_export_${taskId}.xlsx`;
    const filePath = path.join(UPLOAD_DIR, fileName);
    await wb.xlsx.writeFile(filePath);

    const fileResult = await execute(
      'INSERT INTO file_info (file_name, storage_name, file_type, file_size, storage_path, content_type, created_by) VALUES (?,?,?,?,?,?,?)',
      [fileName, fileName, 'xlsx', fs.statSync(filePath).size, filePath, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', req.user!.id]
    );
    await execute('UPDATE export_task SET status = \'SUCCESS\', file_id = ?, finished_at = NOW() WHERE id = ?', [fileResult.insertId, taskId]);

    await writeAudit({ userId: req.user!.id, username: req.user!.username, action: 'excel:export', request: { total, fields }, result: 'SUCCESS', ip: req.ip });
    return ok(res, { taskId, total, fileName }, '导出完成');
  } catch (err) {
    await execute('UPDATE export_task SET status = \'FAILED\', finished_at = NOW() WHERE id = ?', [taskId]);
    throw err;
  }
});

/** 导出任务列表 */
router.get('/export-tasks', requirePermission('excel:export'), async (req: Request, res: Response) => {
  const rows = await query<any>(
    `SELECT et.*, u.real_name AS operator_name FROM export_task et LEFT JOIN sys_user u ON u.id = et.created_by ORDER BY et.created_at DESC LIMIT 50`
  );
  return ok(res, rows);
});

/** 下载导出结果 */
router.get('/export-tasks/:id/download', requirePermission('excel:export'), async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const task = await queryOne<any>('SELECT * FROM export_task WHERE id = ?', [id]);
  if (!task || !task.file_id) throw new AppError('导出文件不存在', 404, 'NOT_FOUND');
  const file = await queryOne<any>('SELECT * FROM file_info WHERE id = ?', [task.file_id]);
  if (!file || !fs.existsSync(file.storage_path)) throw new AppError('导出文件已丢失', 404, 'NOT_FOUND');
  res.download(file.storage_path, file.file_name);
});

export default router;
