import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import multer from 'multer';
import ExcelJS from 'exceljs';
import type { PoolConnection } from 'mysql2/promise';
import { query, queryOne, execute, withTransaction } from '../config/db';
import { genPersonNo } from '../utils/id';
import { formatDate, formatDateOrEmpty } from '../utils/date';
import { authMiddleware } from '../middleware/auth';
import { requirePermission, buildGridFilter } from '../middleware/rbac';
import { ok, okPage, fail, AppError, PageResult } from '../utils/response';
import { writeAudit } from '../middleware/audit';
import { validateIdCard, birthFromIdCard, genderFromIdCard } from '../utils/idcard';
import { buildPersonTagFilter, buildAgeFilter } from '../utils/tagQuery';
import { buildDisabilityLevelFilter, disabilityLevelLabel } from '../utils/disability';
import {
  SPECIAL_IMPORT_SPECS,
  IMPORT_TASK_TYPES,
  mapRowFields,
  type SpecialImportSpec,
  type SpecialImportType,
} from '../utils/specialImport';
import { PERSON_ACTIVE_SQL } from '../utils/personStatus';
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

/**
 * 重点人群名单导入模板列。
 * 与人口档案导入的区别：本导入不新建人员，只按身份证号（或唯一姓名）匹配已有人员并打标签。
 */
const KEYGROUP_COLUMNS = ['姓名', '身份证号', '人员类别', '依据/备注', '生效日期'];

/**
 * 内置别名：覆盖村务台账里的常见叫法（五保户/特困供养、低保户…）。
 * 仅作兜底补充——系统在「人口标签」里新增的标签会自动参与匹配
 * （按 编码 / 名称 / 别名 命中），无需改动这里的代码。
 */
const KEYGROUP_ALIASES: Record<string, string[]> = {
  PARTY_MEMBER: ['党员', '中共党员', '共产党员', '正式党员'],
  PARTY_PROBATIONARY: ['预备党员', '中共预备党员'],
  LEAGUE_MEMBER: ['共青团员', '团员'],
  VETERAN: ['退役军人', '退伍军人', '退役', '退伍', '退役士兵'],
  PREFERENTIAL_OBJECT: ['优抚', '优抚对象', '抚恤', '优待'],
  LOW_INCOME_PERSON: ['低保', '低保对象', '低保户', '低收入'],
  EXTREME_POVERTY_PERSON: ['五保', '五保户', '特困', '特困供养', '特困人员', '特困供养对象'],
  DISABLED_PERSON: ['残疾', '残疾人', '持证残疾'],
  ELDERLY: ['老年人', '老人', '60岁以上', '老龄'],
  MINOR: ['未成年人', '未成年'],
};

/** 名单导入可识别的一条类别（来自 tag_definition） */
export interface KgTagEntry {
  id: number;
  code: string;
  name: string;
  enabled: boolean;
  needAudit: boolean;
}

/**
 * 从标签定义表构建「类别词典」：编码、名称、别名、内置别名全部指向同一条定义。
 * 这样在「人口标签」中新增的标签，名单导入时即可按名称或编码填写，无需改代码。
 */
async function loadKeyGroupTagDict(): Promise<Map<string, KgTagEntry>> {
  const rows = await query<any>(
    "SELECT id, code, name, alias, enabled, need_audit FROM tag_definition WHERE object_type = 'PERSON'"
  );
  return loadKeyGroupTagDictFromRows(rows);
}

/** 纯函数版词典构建，便于单测覆盖（含停用标签，导入时另给提示） */
export function loadKeyGroupTagDictFromRows(rows: any[]): Map<string, KgTagEntry> {
  const dict = new Map<string, KgTagEntry>();
  const put = (token: any, entry: KgTagEntry) => {
    const k = String(token ?? '').trim().toLowerCase();
    if (k) dict.set(k, entry);
  };
  for (const r of rows) {
    const entry: KgTagEntry = {
      id: Number(r.id),
      code: String(r.code),
      name: String(r.name),
      enabled: !!r.enabled,
      needAudit: !!r.need_audit,
    };
    put(r.code, entry);
    put(r.name, entry);
    String(r.alias || '')
      .split(/[,，、;；/|]/)
      .forEach((a: string) => put(a, entry));
    (KEYGROUP_ALIASES[entry.code.toUpperCase()] || []).forEach((a) => put(a, entry));
  }
  return dict;
}

/** 把「人员类别」单元格解析为标签定义；无法识别的部分原样返回供报错 */
export function resolveTagEntries(
  text: string,
  dict: Map<string, KgTagEntry>
): { defs: KgTagEntry[]; unknown: string[] } {
  const parts = String(text || '')
    .split(/[,，、;；/|]/)
    .map((s) => s.trim())
    .filter(Boolean);
  const defs: KgTagEntry[] = [];
  const unknown: string[] = [];
  for (const p of parts) {
    const hit = dict.get(p.toLowerCase());
    if (hit) {
      if (!defs.some((d) => d.id === hit.id)) defs.push(hit);
    } else if (!unknown.includes(p)) {
      unknown.push(p);
    }
  }
  return { defs, unknown };
}

/** 词典中所有可填写的类别名（用于报错提示与模板说明） */
function kgTagLabels(dict: Map<string, KgTagEntry>): string[] {
  return [...new Set([...dict.values()].map((d) => d.name))];
}

/** 类别字典：返回给前端做「默认类别」下拉与填写说明（新增标签自动出现在列表中） */
async function loadKeyGroupTypes(): Promise<{ label: string; code: string; aliases: string[] }[]> {
  const rows = await query<any>(
    "SELECT code, name, alias FROM tag_definition WHERE object_type = 'PERSON' ORDER BY category_id, id"
  );
  return rows.map((r: any) => ({
    label: String(r.name),
    code: String(r.code),
    aliases: [
      ...String(r.alias || '')
        .split(/[,，、;；/|]/)
        .map((s: string) => s.trim())
        .filter(Boolean),
      ...(KEYGROUP_ALIASES[String(r.code).toUpperCase()] || []),
    ],
  }));
}

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

/** 下载重点人群名单导入模板 */
router.get('/template/key-group', requirePermission('excel:import'), async (_req: Request, res: Response) => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('重点人群名单');
  ws.columns = KEYGROUP_COLUMNS.map((c) => ({ header: c, key: c, width: c === '依据/备注' ? 28 : 18 }));
  ws.addRow(['张三', '320102199001011234', '党员', '2026年党员名册', '2026-01-01']);
  ws.addRow(['李四', '320102197508084321', '退役军人,党员', '退役军人事务站名册', '2026-01-01']);
  ws.addRow(['王五', '320102196203120018', '五保户', '民政特困供养名单', '2026-01-01']);
  ws.getRow(1).font = { bold: true };
  for (let r = 2; r <= 4; r++) {
    ws.getRow(r).getCell('身份证号').numFmt = '@';
    ws.getRow(r).getCell('生效日期').numFmt = '@';
  }

  // 第二张表仅作填写说明（导入只解析第一个工作表，不影响解析）
  // 取自标签定义表：系统里新增的标签会自动出现在说明中
  const help = wb.addWorksheet('类别填写说明');
  help.columns = [
    { header: '可填写的类别', key: 'label', width: 18 },
    { header: '标签编码', key: 'code', width: 24 },
    { header: '同时可写成', key: 'alias', width: 40 },
  ];
  try {
    const types = await loadKeyGroupTypes();
    types.forEach((t) => help.addRow({ label: t.label, code: t.code, alias: t.aliases.join('、') }));
  } catch {
    help.addRow({ label: '（读取标签定义失败，请以系统中的标签名称为准）', code: '', alias: '' });
  }
  help.getRow(1).font = { bold: true };

  const buf = await wb.xlsx.writeBuffer();
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="keygroup_import_template.xlsx"');
  res.send(Buffer.from(buf));
});

/** 重点人群类别字典（前端下拉用；来自标签定义表，新增标签自动纳入） */
router.get('/key-group/types', requirePermission('excel:import'), async (_req: Request, res: Response) => {
  try {
    return ok(res, await loadKeyGroupTypes());
  } catch {
    return ok(res, []);
  }
});

/**
 * 读取并解析 Excel 行（只读第一个工作表，跳过表头）。
 *
 * 列定位策略：**优先按表头文字匹配**，表头对不上时才退回按列位置取值。
 *
 * 为什么要按表头匹配：模板改版后（旧模板文件里没有新加的列），
 * 纯按列位置解析会整体错位——残疾等级被当成银行账号、供养方式被当成残疾类别，
 * 而且**全程不报错**，表现为「导入成功但详情页没有数据」，极难排查。
 *
 * @param requiredColumns 必须在表中存在的列（其余列缺失时按空值处理）
 * @throws 表头与模板完全不符时抛错，避免静默导入错误数据
 */
async function readRowsByColumns(
  filePath: string,
  columns: string[],
  requiredColumns?: string[],
): Promise<Record<string, any>[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const ws = wb.worksheets[0];
  const rows: Record<string, any>[] = [];

  // 读表头，建立「表头文字 → 列号」映射（容忍空格与全角空格）
  const headerMap = new Map<string, number>();
  const headerRow = ws.getRow(1);
  headerRow.eachCell((cell, colNumber) => {
    const text = cell.value == null ? '' : String(cell.value).replace(/[\s　]/g, '');
    if (text && !headerMap.has(text)) headerMap.set(text, colNumber);
  });

  // 表头识别度校验：至少要能对上模板的一半列，否则说明文件根本不是这个模板
  const matched = columns.filter((c) => headerMap.has(c.replace(/[\s　]/g, ''))).length;
  const useHeader = matched > 0 && matched >= Math.ceil(columns.length / 2);

  if (!useHeader && requiredColumns?.length) {
    throw new AppError(
      `模板不匹配：表头应为「${columns.join('、')}」，请从系统重新下载最新模板后填写`,
      400,
      'TEMPLATE_MISMATCH'
    );
  }

  /**
   * 按表头定位时，必填列必须在表中真实存在，否则拒绝导入。
   *
   * 只校验「半数以上」不够：模板改版后旧文件仍可能过半匹配，
   * 此时缺失的列会按**模板位置**取值——把相邻列（如银行账号）
   * 误当成残疾类别写进档案，比直接报错危险得多。
   */
  if (useHeader && requiredColumns?.length) {
    const missing = requiredColumns.filter((c) => !headerMap.has(c.replace(/[\s　]/g, '')));
    if (missing.length) {
      throw new AppError(
        `模板缺少必需的列：${missing.join('、')}。该模板可能是旧版本，请重新下载后再导入`,
        400,
        'TEMPLATE_MISSING_COLUMNS'
      );
    }
  }

  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // 跳过表头
    const obj: Record<string, any> = {};
    columns.forEach((c, i) => {
      const key = c.replace(/[\s　]/g, '');
      // 按表头取列号；表头没有该列时取模板中的预期位置（值多半为空）
      const colNumber = useHeader ? (headerMap.get(key) ?? i + 1) : i + 1;
      const raw = row.getCell(colNumber).value;
      // 日期单元格直接取 YYYY-MM-DD，避免变成序列号
      const v = raw instanceof Date
        ? formatDate(raw)
        : (raw == null ? '' : String(raw).trim());
      obj[c] = v;
    });
    if (Object.values(obj).some((v) => v !== '')) rows.push(obj);
  });
  return rows;
}

async function readRows(filePath: string): Promise<Record<string, any>[]> {
  return readRowsByColumns(filePath, IMPORT_COLUMNS, ['姓名', '身份证号', '性别']);
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

  // 出生日期以身份证为准（决定年龄口径）；证上日期不存在时回退到表格里的出生日期列
  const birthDate = (idCardNormalized ? birthFromIdCard(idCardNormalized) : null) || row['出生日期'] || null;
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

/**
 * 孤儿任务收敛：进程崩溃 / 重启会让任务状态永远停在 RUNNING，
 * 导致前端一直显示「处理中」。超过阈值仍未结束的一律判定为失败。
 *
 * 调用点较多（启动、工作台、任务列表），这里做最小间隔节流：
 * 任务列表每次刷新都全表扫一遍 RUNNING 任务没有意义，一分钟一次足够。
 */
const STALE_SCAN_INTERVAL_MS = 60_000;
let lastStaleScanAt = 0;

export async function markStaleImportTasks(minutes = 10, force = false): Promise<number> {
  const now = Date.now();
  if (!force && now - lastStaleScanAt < STALE_SCAN_INTERVAL_MS) return 0;
  lastStaleScanAt = now;
  try {
    const stale = await query<any>(
      `SELECT id FROM excel_import_task WHERE status = 'RUNNING' AND created_at < DATE_SUB(NOW(), INTERVAL ? MINUTE)`,
      [minutes]
    );
    if (!stale.length) return 0;
    for (const t of stale) {
      await execute(`UPDATE excel_import_task SET status = 'FAILED', finished_at = NOW() WHERE id = ?`, [t.id]);
      await execute(
        `INSERT INTO excel_import_error (task_id, row_no, message, raw_data) VALUES (?,?,?,?)`,
        [t.id, 0, `任务异常中断：超过 ${minutes} 分钟仍停留在「处理中」，已自动判定为失败（常见于导入过程报错或后端重启）`, '']
      );
    }
    console.warn(`[excel] 已收敛 ${stale.length} 个卡在「处理中」的导入任务`);
    return stale.length;
  } catch (e) {
    console.error('[excel] 收敛孤儿导入任务失败', e);
    return 0;
  }
}

/** 导入过程异常时把任务标记为失败，避免停留在「处理中」 */
async function markImportFailed(taskId: number, totalRows: number, err: unknown): Promise<void> {
  const reason = err instanceof Error ? err.message : String(err);
  try {
    await execute(
      `UPDATE excel_import_task SET status = 'FAILED', fail_count = ?, finished_at = NOW() WHERE id = ?`,
      [totalRows, taskId]
    );
    await execute(
      `INSERT INTO excel_import_error (task_id, row_no, message, raw_data) VALUES (?,?,?,?)`,
      [taskId, 0, `导入过程异常中断（整批未生效）：${reason}`, '']
    );
  } catch (inner) {
    console.error('[excel] 标记导入任务为失败时出错', inner);
  }
}

/** 批量写入分片大小：逐行 INSERT 在万行级导入时会产生上万次数据库往返 */
const WRITE_CHUNK = 500;

/**
 * person 单行值模板（17 列）：13 个占位符 + status/data_source 两个字面量 + 2 个占位符。
 * 列顺序必须与 insertPersons 里的列名清单严格一致。
 */
const PERSON_ROW_VALUES = `(?,?,?,?,?,?,?,?,?,?,?,?,?, 'NORMAL', 'EXCEL_IMPORT', ?, ?)`;

/** 删除临时文件，删除失败不影响主流程（文件残留在 uploads 目录，可定期清理） */
function safeUnlink(filePath?: string): void {
  if (!filePath) return;
  fs.unlink(filePath, () => {});
}

/**
 * 批量写入人员并回查主键。
 * 用多行 VALUES 一次写入整批，再凭唯一的 person_no 精确回查自增 ID——
 * 相比逐行 INSERT，万行级导入的数据库往返从上万次降到几十次。
 */
async function insertPersons(
  conn: PoolConnection,
  persons: any[],
  userId: number
): Promise<Map<string, number>> {
  const idByNo = new Map<string, number>();
  for (let i = 0; i < persons.length; i += WRITE_CHUNK) {
    const chunk = persons.slice(i, i + WRITE_CHUNK);
    const values: any[] = [];
    const rowPlaceholders: string[] = [];
    for (let j = 0; j < chunk.length; j++) {
      const p = chunk[j];
      // 序号保证同批次内 person_no 唯一，避免撞 uk_person_no 使整批回滚
      p.person_no = genPersonNo(i + j);
      values.push(
        p.person_no, p.name, p.gender, p.birth_date, p.id_card, p.phone, p.phone_backup,
        p.hukou_address, p.live_address, p.village, p.grid_id, p.family_id, p.relation,
        userId, userId
      );
      rowPlaceholders.push(PERSON_ROW_VALUES);
    }
    await conn.query(
      `INSERT INTO person (person_no, name, gender, birth_date, id_card, phone, phone_backup,
         hukou_address, live_address, village, grid_id, family_id, relation, status, data_source, created_by, updated_by)
       VALUES ${rowPlaceholders.join(', ')}`,
      values
    );
    const [rows] = (await conn.query(
      `SELECT id, person_no FROM person WHERE person_no IN (${chunk.map(() => '?').join(',')})`,
      chunk.map((p: any) => p.person_no)
    )) as any[];
    for (const r of rows) idByNo.set(String(r.person_no), Number(r.id));
  }
  return idByNo;
}

/** 批量建立家庭成员关联，并在导入到户主时回填家庭户主字段 */
async function linkFamilyMembers(
  conn: PoolConnection,
  persons: any[],
  idByNo: Map<string, number>
): Promise<void> {
  const members: any[][] = [];
  const headUpdates: { personId: number; familyId: number }[] = [];

  for (const p of persons) {
    if (!p.family_id) continue;
    const personId = idByNo.get(String(p.person_no));
    if (!personId) continue;
    // 保留 Excel 中填写的与户主关系（户主 / 妻 / 子 / 女 …）
    const relation = p.relation || 'OTHER';
    members.push([p.family_id, personId, relation, relation === 'HEAD' ? 1 : 0]);
    if (relation === 'HEAD') headUpdates.push({ personId, familyId: p.family_id });
  }

  for (let i = 0; i < members.length; i += WRITE_CHUNK) {
    const chunk = members.slice(i, i + WRITE_CHUNK);
    await conn.query(
      `INSERT IGNORE INTO family_member (family_id, person_id, relation, is_householder)
       VALUES ${chunk.map(() => '(?,?,?,?)').join(', ')}`,
      chunk.flat()
    );
  }
  for (const h of headUpdates) {
    await conn.query(
      'UPDATE family SET head_person_id = ? WHERE id = ? AND head_person_id IS NULL',
      [h.personId, h.familyId]
    );
  }
}

/** 批量写入导入错误行 */
async function insertImportErrors(
  taskId: number,
  errors: { rowNo: number; message: string; raw: string }[]
): Promise<void> {
  for (let i = 0; i < errors.length; i += WRITE_CHUNK) {
    const chunk = errors.slice(i, i + WRITE_CHUNK);
    await execute(
      `INSERT INTO excel_import_error (task_id, row_no, message, raw_data)
       VALUES ${chunk.map(() => '(?,?,?,?)').join(', ')}`,
      chunk.flatMap((e) => [taskId, e.rowNo, e.message, e.raw])
    );
  }
}

interface ImportOutcome {
  success: number;
  errors: { rowNo: number; message: string; raw: string }[];
  pendingCount: number;
}

/**
 * 执行导入：逐行校验 → 写人员 → 记错误 → 身份证异常行落待核查。
 * 抽成独立函数，路由层才能用 try/catch 兜住异常并把任务置为失败。
 */
async function processImportRows(p: {
  rows: any[];
  taskId: number;
  batchNo: string;
  gridMap: Map<string, number>;
  familyMap: Map<string, number>;
  existingIdCards: Set<string>;
  userId: number;
}): Promise<ImportOutcome> {
  const { rows, taskId, batchNo, gridMap, familyMap, existingIdCards, userId } = p;

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

  // 写入有效行（事务）：批量 INSERT + 批量建家庭成员关联
  if (validPersons.length) {
    const persons = validPersons.map((v) => v.person);
    await withTransaction(async (conn) => {
      const idByNo = await insertPersons(conn, persons, userId);
      await linkFamilyMembers(conn, persons, idByNo);
      success = idByNo.size;
    });
  }

  // 记录错误
  await insertImportErrors(taskId, errors);

  // 身份证缺失/非法的行落到待核查表，等待人工补录
  if (pendings.length) {
    await withTransaction(async (conn) => {
      for (let i = 0; i < pendings.length; i += WRITE_CHUNK) {
        const chunk = pendings.slice(i, i + WRITE_CHUNK);
        const values: any[] = [];
        for (const { rowNo, pending } of chunk) {
          values.push(
            batchNo, rowNo, pending.reason, pending.reason_text, pending.name, pending.gender,
            pending.birth_date || null, pending.id_card || null, pending.phone, pending.phone_backup,
            pending.hukou_address, pending.live_address, pending.village, pending.grid_no, pending.family_no,
            pending.relation, pending.raw_data, userId
          );
        }
        await conn.query(
          `INSERT INTO import_pending (batch_no, row_no, reason, reason_text, name, gender, birth_date, id_card,
             phone, phone_backup, hukou_address, live_address, village, grid_no, family_no, relation, raw_data, created_by)
           VALUES ${chunk.map(() => '(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').join(', ')}`,
          values
        );
      }
    });
  }

  return { success, errors, pendingCount: pendings.length };
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

  // 解析与建任务都在 try 内：任何一步抛错都能保证临时文件被清理（此前解析失败会残留文件）
  let rows: Record<string, any>[];
  let taskId: number;
  try {
    rows = await readRows(req.file.path);
    const taskResult = await execute(
      `INSERT INTO excel_import_task (file_id, batch_no, status, total_rows, success_count, fail_count, created_by)
       VALUES (NULL, ?, 'RUNNING', ?, 0, 0, ?)`,
      [batchNo, rows.length, req.user!.id]
    );
    taskId = taskResult.insertId;
  } catch (err) {
    safeUnlink(req.file.path);
    throw err;
  }

  try {
    const { success, errors, pendingCount } = await processImportRows({
      rows, taskId, batchNo, gridMap, familyMap, existingIdCards, userId: req.user!.id,
    });

    // 待核查行不计为失败，但会标记任务为「部分成功」，提醒人工跟进
    const finalStatus = success === 0 && pendingCount === 0 ? 'FAILED' : (errors.length > 0 || pendingCount > 0 ? 'PARTIAL' : 'SUCCESS');
    await execute(
      'UPDATE excel_import_task SET status = ?, success_count = ?, fail_count = ?, pending_count = ?, finished_at = NOW() WHERE id = ?',
      [finalStatus, success, errors.length, pendingCount, taskId]
    );

    await writeAudit({ userId: req.user!.id, username: req.user!.username, action: 'excel:import', request: { batchNo, total: rows.length, success, fail: errors.length, pending: pendingCount }, result: 'SUCCESS', ip: req.ip });
    return ok(
      res,
      { taskId, total: rows.length, success, fail: errors.length, pending: pendingCount, status: finalStatus },
      pendingCount ? `导入完成：成功 ${success} 条，失败 ${errors.length} 条，${pendingCount} 条转入待核查` : '导入完成'
    );
  } catch (err) {
    // 导入中途失败（SQL 报错、连接中断等）：整批未生效，任务必须落为失败，不能停在「处理中」
    await markImportFailed(taskId, rows.length, err);
    throw err;
  } finally {
    safeUnlink(req.file?.path);
  }
});

const keyGroupSchema = z.object({
  defaultCode: z.string().optional().or(z.literal('')),
  applyMode: z.enum(['ACTIVE', 'AUDIT']).default('ACTIVE'),
});

/**
 * 导入重点人群名单（党员 / 退役军人 / 优抚 / 低保 / 五保 / 残疾 …）。
 * 不新建人员档案：按身份证号（或系统内唯一的姓名）匹配已有人员，再打上对应标签。
 * 已存在的标签自动跳过，不会重复关联。
 */
router.post('/import-key-group', requirePermission('excel:import'), upload.single('file'), async (req: Request, res: Response) => {
  if (!req.file) return fail(res, '请上传 Excel 文件');
  const batchNo = (req.body.batchNo as string) || `KG${Date.now()}`;
  const body = keyGroupSchema.parse({ defaultCode: req.body.defaultCode, applyMode: req.body.applyMode || 'ACTIVE' });

  const existed = await queryOne<any>('SELECT id FROM excel_import_task WHERE batch_no = ?', [batchNo]);
  if (existed) throw new AppError('该批次已提交过，请勿重复导入', 409, 'DUPLICATE_BATCH');

  let rows: Record<string, any>[];
  let taskId: number;
  try {
    rows = await readRowsByColumns(req.file.path, KEYGROUP_COLUMNS, ['姓名', '人员类别']);
    const taskResult = await execute(
      `INSERT INTO excel_import_task (file_id, batch_no, task_type, status, total_rows, success_count, fail_count, created_by)
       VALUES (NULL, ?, 'KEY_GROUP', 'RUNNING', ?, 0, 0, ?)`,
      [batchNo, rows.length, req.user!.id]
    );
    taskId = taskResult.insertId;
  } catch (err) {
    safeUnlink(req.file.path);
    throw err;
  }

  try {
    // 类别词典来自标签定义表：编码 / 名称 / 别名 / 内置别名 均可命中，新增标签即时生效
    const tagDict = await loadKeyGroupTagDict();
    const tagHint = kgTagLabels(tagDict).join('/');

    // 已生效的标签关联一次性载入内存，避免逐行查重
    const linkRows = await query<any>('SELECT person_id, tag_id FROM person_tag WHERE status = \'ACTIVE\'');
    const linked = new Set<string>(linkRows.map((l: any) => `${l.person_id}:${l.tag_id}`));

    // 人员索引：身份证 -> 人员；姓名唯一 -> 人员（用于无身份证的老名单）
    const personRows = await query<any>('SELECT id, name, id_card FROM person');
    const byIdCard = new Map<string, any>();
    const nameCount = new Map<string, number>();
    for (const p of personRows) {
      if (p.id_card) byIdCard.set(String(p.id_card), p);
      nameCount.set(String(p.name), (nameCount.get(String(p.name)) || 0) + 1);
    }
    const byUniqueName = new Map<string, any>();
    for (const p of personRows) {
      if ((nameCount.get(String(p.name)) || 0) === 1) byUniqueName.set(String(p.name), p);
    }

    const errors: { rowNo: number; message: string; raw: string }[] = [];
    const toInsert: { personId: number; tagId: number; status: string; basis: string; effectDate: string | null }[] = [];
    const fileSeen = new Set<string>();
    let matched = 0;
    let skipped = 0;

    for (let i = 0; i < rows.length; i++) {
      const rowNo = i + 2;
      const row = rows[i];
      const name = String(row['姓名'] || '').trim();
      const raw = name || String(row['身份证号'] || '');
      if (!name) { errors.push({ rowNo, message: '姓名为空', raw }); continue; }

      const idText = String(row['身份证号'] || '').trim();
      let person: any = null;
      if (idText) {
        const check = validateIdCard(idText);
        if (!check.valid) { errors.push({ rowNo, message: `身份证号：${check.message}`, raw }); continue; }
        person = byIdCard.get(check.normalized!) || null;
        if (!person) {
          errors.push({ rowNo, message: `系统内未找到身份证号 ${check.normalized} 的人员，请先导入人口档案`, raw });
          continue;
        }
      } else {
        // 老名单常只有姓名：仅当姓名在系统中唯一时才匹配，避免张冠李戴
        const cnt = nameCount.get(name) || 0;
        if (!byUniqueName.has(name)) {
          errors.push({
            rowNo,
            message: cnt ? `姓名「${name}」在系统中存在 ${cnt} 条同名记录，请补填身份证号` : `系统内未找到姓名「${name}」的人员`,
            raw,
          });
          continue;
        }
        person = byUniqueName.get(name);
      }
      matched++;

      // 类别：行内为空时取上传页面选择的「默认类别」
      const { defs, unknown } = resolveTagEntries(row['人员类别'] || '', tagDict);
      if (unknown.length) {
        errors.push({ rowNo, message: `无法识别的人员类别：${unknown.join('、')}（可填标签名称或编码，如：${tagHint}）`, raw });
        continue;
      }
      // 默认类别也走同一套词典，支持填名称或编码
      let finalDefs = defs;
      if (!finalDefs.length && body.defaultCode) {
        const d = tagDict.get(String(body.defaultCode).trim().toLowerCase());
        if (d) finalDefs = [d];
        else { errors.push({ rowNo, message: `默认类别「${body.defaultCode}」不是有效的标签名称或编码`, raw }); continue; }
      }
      if (!finalDefs.length) { errors.push({ rowNo, message: '未填写人员类别，且未选择默认类别', raw }); continue; }

      const basis = String(row['依据/备注'] || '').trim() || `重点人群名单导入（批次 ${batchNo}）`;
      const effect = String(row['生效日期'] || '').trim();
      const effectDate = /^\d{4}-\d{2}-\d{2}$/.test(effect) ? effect : null;

      for (const def of finalDefs) {
        if (!def.enabled) {
          errors.push({ rowNo, message: `标签「${def.name}」已停用，请先在人口标签中启用`, raw });
          continue;
        }
        const key = `${person.id}:${def.id}`;
        if (fileSeen.has(key) || linked.has(key)) { skipped++; continue; }
        fileSeen.add(key);
        toInsert.push({
          personId: person.id,
          tagId: def.id,
          status: body.applyMode === 'AUDIT' && def.needAudit ? 'PENDING' : 'ACTIVE',
          basis,
          effectDate,
        });
      }
    }

    if (toInsert.length) {
      const remark = `重点人群名单导入（批次 ${batchNo}）`;
      await withTransaction(async (conn) => {
        for (let i = 0; i < toInsert.length; i += WRITE_CHUNK) {
          const chunk = toInsert.slice(i, i + WRITE_CHUNK);
          await conn.query(
            `INSERT INTO person_tag (person_id, tag_id, effect_date, status, basis, created_by)
             VALUES ${chunk.map(() => '(?,?,?,?,?,?)').join(', ')}`,
            chunk.flatMap((it) => [it.personId, it.tagId, it.effectDate, it.status, it.basis, req.user!.id])
          );
          await conn.query(
            `INSERT INTO tag_change_log (object_type, object_id, tag_id, action, operator_id, remark)
             VALUES ${chunk.map(() => `('PERSON', ?, ?, 'ADD', ?, ?)`).join(', ')}`,
            chunk.flatMap((it) => [it.personId, it.tagId, req.user!.id, remark])
          );
        }
      });
    }
    const tagged = toInsert.length;

    await insertImportErrors(taskId, errors);

    const finalStatus = errors.length === 0 ? 'SUCCESS' : (tagged > 0 || skipped > 0 ? 'PARTIAL' : 'FAILED');
    await execute(
      'UPDATE excel_import_task SET status = ?, success_count = ?, fail_count = ?, finished_at = NOW() WHERE id = ?',
      [finalStatus, tagged, errors.length, taskId]
    );

    await writeAudit({
      userId: req.user!.id, username: req.user!.username, action: 'excel:import_key_group',
      request: { batchNo, total: rows.length, matched, tagged, skipped, fail: errors.length },
      result: 'SUCCESS', ip: req.ip,
    });

    return ok(
      res,
      { taskId, total: rows.length, matched, tagged, skipped, fail: errors.length, status: finalStatus },
      errors.length
        ? `导入完成：匹配 ${matched} 人，新增标签 ${tagged} 条，已存在跳过 ${skipped} 条，失败 ${errors.length} 条`
        : `导入完成：匹配 ${matched} 人，新增标签 ${tagged} 条${skipped ? `，已存在跳过 ${skipped} 条` : ''}`
    );
  } catch (err) {
    await markImportFailed(taskId, rows.length, err);
    throw err;
  } finally {
    safeUnlink(req.file?.path);
  }
});

// ===============================================================
// 重点人群专项台账导入（残疾人 / 特困供养 / 低保）
// 与 /import-key-group 同定位：只匹配已有人员并更新其台账字段，不新建人员。
// ===============================================================

/** 专项导入类型元信息（前端页签与列说明用） */
router.get('/special/types', requirePermission('excel:import'), (_req: Request, res: Response) => {
  const list = Object.values(SPECIAL_IMPORT_SPECS).map((s) => ({
    type: s.type,
    label: s.label,
    taskType: s.taskType,
    columns: s.columns,
    notes: s.notes,
  }));
  return ok(res, list);
});

/** 下载专项台账导入模板（残疾人 / 特困 / 低保 各一份） */
router.get('/template/special/:type', requirePermission('excel:import'), async (req: Request, res: Response) => {
  const spec = SPECIAL_IMPORT_SPECS[req.params.type as SpecialImportType];
  if (!spec) throw new AppError('未知的导入类型', 400, 'UNKNOWN_IMPORT_TYPE');

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(spec.label);
  ws.columns = spec.columns.map((c) => ({ header: c, key: c, width: c.includes('描述') || c.includes('评估') ? 30 : 18 }));
  // 示例行仅示意格式，导入只读取第一个工作表
  ws.addRow(sampleRowFor(spec));
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEAF1FE' } };
  // 证件号、手机号、银行账号设为文本格式，否则 Excel 会把长数字显示成科学计数法、
  // 丢掉前导零（银行账号长达 19 位，必须如此）。
  // 必须按当前模板实际拥有的列设置——getCell 取不存在的列会抛错（曾导致特困/低保模板 500）。
  // 注意不要把「残疾等级」「供养方式」这类枚举列设成文本格式，否则会破坏导入解析。
  const textColumns = ['身份证号', '残疾证号', '监护人手机', '监护人电话', '银行账号'];
  for (const col of textColumns) {
    if (spec.columns.includes(col)) {
      ws.getRow(2).getCell(col).numFmt = '@';
    }
  }

  // 第二张表：填写说明（不参与解析）
  const help = wb.addWorksheet('填写说明');
  help.columns = [
    { header: '说明', key: 'text', width: 78 },
  ];
  spec.notes.forEach((n, i) => help.addRow({ text: `${i + 1}. ${n}` }));
  help.getRow(1).font = { bold: true };

  const buf = await wb.xlsx.writeBuffer();
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="special_${spec.type}_template.xlsx"`);
  res.send(Buffer.from(buf));
});

/** 每类模板的示例行 */
function sampleRowFor(spec: SpecialImportSpec): any[] {
  const base: Record<string, any> = {
    '姓名': '张三',
    '身份证号': '320102199001011234',
    '残疾类别': '肢体',
    '残疾等级': '二级',
    '残疾证号': '132101199001011234',
    '监护人': '张三妻',
    '监护人手机': '13900000000',
    '供养方式': '分散供养',
    '银行账号': '6222000000000000000',
    '发放金额': 850,
    '家庭情况描述': '妻子务农，儿子在外务工，本人生活自理能力较弱。',
    '身体评估结果': '行动不便，需定期上门随访。',
    '备注': '',
  };
  return spec.columns.map((c) => base[c] ?? '');
}

/** 专项台账导入 */
router.post('/import-special', requirePermission('excel:import'), upload.single('file'), async (req: Request, res: Response) => {
  if (!req.file) return fail(res, '请上传 Excel 文件');
  const spec = SPECIAL_IMPORT_SPECS[(req.body.type as SpecialImportType)];
  if (!spec) { safeUnlink(req.file.path); throw new AppError('未知的导入类型', 400, 'UNKNOWN_IMPORT_TYPE'); }
  const batchNo = (req.body.batchNo as string) || `${spec.type.slice(0, 2).toUpperCase()}${Date.now()}`;

  const existed = await queryOne<any>('SELECT id FROM excel_import_task WHERE batch_no = ?', [batchNo]);
  if (existed) { safeUnlink(req.file.path); throw new AppError('该批次已提交过，请勿重复导入', 409, 'DUPLICATE_BATCH'); }

  let rows: Record<string, any>[];
  let taskId: number;
  try {
    // 必填列：模板列序与预期不符（用了旧模板等）时直接报错，
    // 而不是静默错位把银行账号当成残疾类别写进档案。
    // 只取「身份类」列作必填——残疾证号/监护人/备注等本身允许为空，
    // 若一并设为必填，正常留空这些列的表格也会被误拒。
    const identityCols = spec.disabilityFields
      ? Object.keys(spec.disabilityFields).filter((c) => c === '残疾类别' || c === '残疾等级')
      : [];
    const required = ['姓名', '身份证号', ...identityCols];
    rows = await readRowsByColumns(req.file.path, spec.columns, required);
    const taskResult = await execute(
      `INSERT INTO excel_import_task (file_id, batch_no, task_type, status, total_rows, success_count, fail_count, created_by)
       VALUES (NULL, ?, ?, 'RUNNING', ?, 0, 0, ?)`,
      [batchNo, spec.taskType, rows.length, req.user!.id]
    );
    taskId = taskResult.insertId;
  } catch (err) {
    safeUnlink(req.file.path);
    throw err;
  }

  try {
    // 人员索引：身份证 → 人员；姓名单一 → 人员（老名单常只有姓名）
    const personRows = await query<any>('SELECT id, name, id_card FROM person');
    const byIdCard = new Map<string, any>();
    const nameCount = new Map<string, number>();
    for (const p of personRows) {
      if (p.id_card) byIdCard.set(String(p.id_card), p);
      nameCount.set(String(p.name), (nameCount.get(String(p.name)) || 0) + 1);
    }
    const byUniqueName = new Map<string, any>();
    for (const p of personRows) {
      if ((nameCount.get(String(p.name)) || 0) === 1) byUniqueName.set(String(p.name), p);
    }

    // 标签字典：自动打的标签若已被停用则报错，避免静默写入无效标签
    const tagRows = await query<any>(
      'SELECT id, code, name, enabled FROM tag_definition WHERE code IN (?)',
      [spec.tagCodes]
    );
    const tagMap = new Map(tagRows.map((t: any) => [t.code, t]));
    for (const code of spec.tagCodes) {
      const t = tagMap.get(code);
      if (!t) throw new AppError(`标签「${code}」不存在，请先在人口标签中创建`, 500, 'TAG_MISSING');
      if (!t.enabled) throw new AppError(`标签「${t.name}」已停用，请先在人口标签中启用`, 400, 'TAG_DISABLED');
    }

    // 已有标签关联与残疾档案：用于「已存在则跳过」与覆盖判断
    const linkRows = await query<any>('SELECT person_id, tag_id FROM person_tag WHERE status = \'ACTIVE\'');
    const linked = new Set<string>(linkRows.map((l: any) => `${l.person_id}:${l.tag_id}`));
    const ddRows = await query<any>('SELECT person_id FROM person_disability');
    const hasDisability = new Set<number>(ddRows.map((d: any) => Number(d.person_id)));

    const errors: { rowNo: number; message: string; raw: string }[] = [];
    /** 按 person_id 聚合：同一人在表里出现多行时合并写入，避免互相覆盖 */
    const personUpdates = new Map<number, { person: Record<string, any>; disability: Record<string, any> }>();
    /** 特困供养方式标签：集中/分散，需先拿到标签 id */
    const modeTagRows = spec.type === 'extreme_poverty'
      ? await query<any>("SELECT id, code FROM tag_definition WHERE code IN ('EXTREME_POVERTY_CENTRALIZED','EXTREME_POVERTY_DISPERSED')")
      : [];
    const modeTagMap = new Map<string, number>(modeTagRows.map((t: any) => [t.code, Number(t.id)]));

    const tagInserts: { personId: number; tagId: number }[] = [];
    let matched = 0;
    let updatedPersons = 0;
    let disabilityUpserts = 0;
    let modeTagged = 0;
    let skipped = 0;

    for (let i = 0; i < rows.length; i++) {
      const rowNo = i + 2;
      const row = rows[i];
      const name = String(row['姓名'] || '').trim();
      const raw = name || String(row['身份证号'] || '');
      if (!name) { errors.push({ rowNo, message: '姓名为空', raw }); continue; }

      // 1) 匹配已有人员（不新建）
      const idText = String(row['身份证号'] || '').trim();
      let person: any = null;
      if (idText) {
        const check = validateIdCard(idText);
        if (!check.valid) {
          // 特别提示 14 位：户籍表常见脱敏导出（末 4 位被抹掉），
          // 用户看到「格式错误」往往不知道真实原因是脱敏
          const isMasked = idText.length === 14;
          errors.push({
            rowNo,
            message: isMasked
              ? `身份证号「${idText}」是 14 位脱敏号，缺少末 4 位（校验码与部分数字），无法匹配人员。请补全 18 位完整号码`
              : `身份证号：${check.message}`,
            raw,
          });
          continue;
        }
        person = byIdCard.get(check.normalized!) || null;
        if (!person) {
          errors.push({ rowNo, message: `系统内未找到身份证号 ${check.normalized} 的人员，请先导入人口档案`, raw });
          continue;
        }
      } else {
        const cnt = nameCount.get(name) || 0;
        if (!byUniqueName.has(name)) {
          errors.push({
            rowNo,
            message: cnt ? `姓名「${name}」在系统中存在 ${cnt} 条同名记录，请补填身份证号` : `系统内未找到姓名「${name}」的人员`,
            raw,
          });
          continue;
        }
        person = byUniqueName.get(name);
      }
      matched++;

      // 2) 字段映射与校验
      const rowErrs: string[] = [];
      const mapped = mapRowFields(spec, row, rowErrs);
      if (rowErrs.length) {
        errors.push({ rowNo, message: rowErrs.join('；'), raw });
        continue;
      }

      // 3) 合并到该人员的待写入集合（同人多行时后写的列补空缺的，不清已有）
      const acc = personUpdates.get(person.id) || { person: {}, disability: {} };
      Object.assign(acc.person, mapped.person);
      Object.assign(acc.disability, mapped.disability);
      personUpdates.set(person.id, acc);

      // 4) 自动打标签（已存在则跳过，避免重复导入产生多条记录）
      for (const code of spec.tagCodes) {
        const t = tagMap.get(code)!;
        const key = `${person.id}:${t.id}`;
        if (linked.has(key)) { skipped++; continue; }
        linked.add(key);
        tagInserts.push({ personId: person.id, tagId: Number(t.id) });
      }

      // 特困：按供养方式打集中/分散子标签
      if (mapped.povertyMode) {
        const code = mapped.povertyMode === 'CENTRALIZED' ? 'EXTREME_POVERTY_CENTRALIZED' : 'EXTREME_POVERTY_DISPERSED';
        const tagId = modeTagMap.get(code);
        if (!tagId) {
          errors.push({ rowNo, message: '供养方式对应的标签不存在，请检查 V008 迁移是否已执行', raw });
          continue;
        }
        const key = `${person.id}:${tagId}`;
        if (!linked.has(key)) {
          linked.add(key);
          tagInserts.push({ personId: person.id, tagId });
          modeTagged++;
        }
      }
    }

    // 5) 写入：仅更新非空字段（空值不覆盖已在 mapRowFields 中保证）
    const updateEntries = [...personUpdates.entries()].filter(([, v]) => Object.keys(v.person).length || Object.keys(v.disability).length);
    await withTransaction(async (conn) => {
      for (const [personId, v] of updateEntries) {
        if (Object.keys(v.person).length) {
          const sets = Object.keys(v.person).map((c) => `${c} = ?`);
          await conn.query(
            `UPDATE person SET ${sets.join(', ')}, updated_by = ? WHERE id = ?`,
            [...Object.values(v.person), req.user!.id, personId]
          );
          updatedPersons++;
        }
        if (Object.keys(v.disability).length) {
          // 一对一表：有记录则更新，无记录则插入（同一批次已出现过则计入 upsert 数）
          await conn.query(
            `INSERT INTO person_disability (person_id, disability_type, disability_level, disability_card, guardian_name, guardian_phone, remark)
             VALUES (?,?,?,?,?,?,?)
             ON DUPLICATE KEY UPDATE
               disability_type = COALESCE(VALUES(disability_type), disability_type),
               disability_level = COALESCE(VALUES(disability_level), disability_level),
               disability_card  = COALESCE(VALUES(disability_card), disability_card),
               guardian_name   = COALESCE(VALUES(guardian_name), guardian_name),
               guardian_phone  = COALESCE(VALUES(guardian_phone), guardian_phone),
               remark          = COALESCE(VALUES(remark), remark)`,
            [
              personId,
              v.disability.disability_type ?? null, v.disability.disability_level ?? null,
              v.disability.disability_card ?? null, v.disability.guardian_name ?? null,
              v.disability.guardian_phone ?? null, v.disability.remark ?? null,
            ]
          );
          if (!hasDisability.has(personId)) hasDisability.add(personId);
          disabilityUpserts++;
        }
        // 台账变更留痕，便于后续追溯是谁通过哪批次导入的
        await conn.query(
          `INSERT INTO person_change_log (person_id, change_type, reason, operator_id)
           VALUES (?, 'UPDATE', ?, ?)`,
          [personId, `${spec.label}导入（批次 ${batchNo}）`, req.user!.id]
        );
      }

      // 标签批量写入（含变更日志）
      for (let i = 0; i < tagInserts.length; i += WRITE_CHUNK) {
        const chunk = tagInserts.slice(i, i + WRITE_CHUNK);
        await conn.query(
          `INSERT INTO person_tag (person_id, tag_id, status, basis, created_by)
           VALUES ${chunk.map(() => '(?,?,?,?,?)').join(', ')}`,
          chunk.flatMap((it) => [it.personId, it.tagId, 'ACTIVE', `${spec.label}导入（批次 ${batchNo}）`, req.user!.id])
        );
        await conn.query(
          `INSERT INTO tag_change_log (object_type, object_id, tag_id, action, operator_id, remark)
           VALUES ${chunk.map(() => `('PERSON', ?, ?, 'ADD', ?, ?)`).join(', ')}`,
          chunk.flatMap((it) => [it.personId, it.tagId, req.user!.id, `${spec.label}导入（批次 ${batchNo}）`])
        );
      }
    });

    await insertImportErrors(taskId, errors);

    // 成功数 = 匹配到人员且字段校验通过的去重人数（personUpdates 只收录通过校验的行）
    const uniqueUpdated = personUpdates.size;
    const finalStatus = errors.length === 0 ? 'SUCCESS' : (uniqueUpdated > 0 ? 'PARTIAL' : 'FAILED');
    await execute(
      'UPDATE excel_import_task SET status = ?, success_count = ?, fail_count = ?, finished_at = NOW() WHERE id = ?',
      [finalStatus, uniqueUpdated, errors.length, taskId]
    );

    await writeAudit({
      userId: req.user!.id, username: req.user!.username, action: 'excel:import_special',
      request: { type: spec.type, batchNo, total: rows.length, matched, updated: uniqueUpdated, disability: disabilityUpserts, tags: tagInserts.length, fail: errors.length },
      result: 'SUCCESS', ip: req.ip,
    });

    return ok(
      res,
      {
        taskId, type: spec.type, total: rows.length, matched,
        updated: uniqueUpdated, disabilityUpserts, tagged: tagInserts.length,
        modeTagged, skipped, fail: errors.length, status: finalStatus,
      },
      errors.length
        ? `${spec.label}导入完成：更新 ${uniqueUpdated} 人，新建残疾档案 ${disabilityUpserts} 份，新增标签 ${tagInserts.length} 条，失败 ${errors.length} 条`
        : `${spec.label}导入完成：更新 ${uniqueUpdated} 人，新建残疾档案 ${disabilityUpserts} 份，新增标签 ${tagInserts.length} 条`
    );
  } catch (err) {
    await markImportFailed(taskId, rows.length, err);
    throw err;
  } finally {
    safeUnlink(req.file?.path);
  }
});

/** 导入任务列表（先收敛卡住的任务，避免列表里长期挂着「处理中」） */
router.get('/import-tasks', requirePermission('excel:import'), async (req: Request, res: Response) => {
  await markStaleImportTasks();
  const q = z
    .object({
      page: z.coerce.number().int().min(1).default(1),
      pageSize: z.coerce.number().int().min(1).max(500).default(20),
      // 不传=全部。枚举来自 utils/specialImport 的 IMPORT_TASK_TYPES，
      // 新增导入类型时那里改一处即可，这里不会再出现 Invalid enum value
      taskType: z.enum(IMPORT_TASK_TYPES).optional(),
    })
    .parse(req.query);
  const whereSql = q.taskType ? 'WHERE eit.task_type = ?' : '';
  const params: any[] = q.taskType ? [q.taskType] : [];
  const totalRow = await queryOne<any>(`SELECT COUNT(*) AS cnt FROM excel_import_task eit ${whereSql}`, params);
  const rows = await query<any>(
    `SELECT eit.*, u.real_name AS operator_name FROM excel_import_task eit LEFT JOIN sys_user u ON u.id = eit.created_by
     ${whereSql} ORDER BY eit.created_at DESC LIMIT ? OFFSET ?`,
    [...params, q.pageSize, (q.page - 1) * q.pageSize]
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
  /** 只看在册（默认开启），与人员列表口径一致；传 false 可导出含已迁出/死亡的历史档案 */
  activeOnly: z.boolean().optional().default(true),
  /** 重点人群个性化筛选（V008），与 /api/keygroup/query 保持同口径 */
  extremePovertyMode: z.enum(['CENTRALIZED', 'DISPERSED']).optional(),
  minDisabilityLevel: z.enum(['LEVEL_1', 'LEVEL_2', 'LEVEL_3', 'LEVEL_4']).optional(),
  maxDisabilityLevel: z.enum(['LEVEL_1', 'LEVEL_2', 'LEVEL_3', 'LEVEL_4']).optional(),
  disabilityType: z.string().max(64).optional(),
  minSubsidy: z.coerce.number().min(0).optional(),
  maxSubsidy: z.coerce.number().min(0).optional(),
  guardian: z.enum(['YES', 'NO']).optional(),
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
  // 重点人群台账字段（V008）
  { key: 'bank_account', label: '银行账号' },
  { key: 'subsidy_amount', label: '发放金额' },
  { key: 'disability_type', label: '残疾类别' },
  { key: 'disability_level_label', label: '残疾等级' },
  { key: 'disability_card', label: '残疾证号' },
  { key: 'guardian_name', label: '监护人' },
  { key: 'guardian_phone', label: '监护人手机' },
  { key: 'family_condition', label: '家庭情况描述' },
  { key: 'health_assessment', label: '身体评估结果' },
  // 重点人群标志列（由 person_tag 关联得出，详见导出行映射）
  { key: 'is_party', label: '党员' },
  { key: 'is_disabled', label: '残疾人' },
  { key: 'is_extreme_poverty', label: '五保/特困' },
  { key: 'is_low_income', label: '低保' },
  { key: 'is_veteran', label: '退役军人' },
  { key: 'is_preferential', label: '优抚对象' },
  { key: 'tags', label: '全部标签' },
];

/**
 * 重点人群标志列定义：每个标志由若干 tag_definition.code 命中（任一即视为「是」）。
 * 编码与 grid.ts 的 FOCUS_TAGS 口径保持一致（党员含正式/预备）。
 * 残疾人额外兼顾 person_disability 表（有人建了残疾档案但未打标签也算残疾人）。
 */
const EXPORT_TAG_FLAGS: { key: string; label: string; codes: string[]; alsoDisabilityTable?: boolean }[] = [
  { key: 'is_party', label: '党员', codes: ['PARTY_MEMBER', 'PARTY_PROBATIONARY'] },
  { key: 'is_disabled', label: '残疾人', codes: ['DISABLED_PERSON'], alsoDisabilityTable: true },
  { key: 'is_extreme_poverty', label: '五保/特困', codes: ['EXTREME_POVERTY_PERSON'] },
  { key: 'is_low_income', label: '低保', codes: ['LOW_INCOME_PERSON'] },
  { key: 'is_veteran', label: '退役军人', codes: ['VETERAN'] },
  { key: 'is_preferential', label: '优抚对象', codes: ['PREFERENTIAL_OBJECT'] },
];

/** 创建导出任务（同步生成文件，记录任务状态与审计） */
router.post('/export', requirePermission('excel:export'), async (req: Request, res: Response) => {
  const body = exportSchema.parse(req.body);

  const where: string[] = ['1=1'];
  const params: any[] = [];
  // 与人员列表保持同一搜索口径：姓名 / 身份证号 / 手机号（含备用）
  if (body.keyword) { where.push('(p.name LIKE ? OR p.id_card LIKE ? OR p.phone LIKE ? OR p.phone_backup LIKE ?)'); params.push(`%${body.keyword}%`, `%${body.keyword}%`, `%${body.keyword}%`, `%${body.keyword}%`); }
  if (body.gridId) { where.push('p.grid_id = ?'); params.push(body.gridId); }
  if (body.familyId) { where.push('p.family_id = ?'); params.push(body.familyId); }
  if (body.gender) { where.push('p.gender = ?'); params.push(body.gender); }
  if (body.status) { where.push('p.status = ?'); params.push(body.status); }
  else if (body.activeOnly !== false) { where.push(PERSON_ACTIVE_SQL); }

  const gridFilter = buildGridFilter(req, 'p.grid_id');
  if (gridFilter.where) { where.push(gridFilter.where.replace(/^ AND /, '')); params.push(...gridFilter.params); }

  // 年龄与标签筛选复用 tagQuery 的构建器，与人口档案列表保持同一口径
  // （此前这里内联了一份，maxAge 用了 >=，会把刚满 maxAge+1 周岁的人多算进来）
  const ageFilter = buildAgeFilter(body.minAge, body.maxAge, 'p');
  if (ageFilter.where) { where.push(ageFilter.where.replace(/^ AND /, '')); params.push(...ageFilter.params); }

  if (body.tagIds) {
    const tagIds = body.tagIds.split(',').map((s) => parseInt(s, 10)).filter((n) => !isNaN(n));
    const tagFilter = buildPersonTagFilter({ tags: tagIds, mode: body.tagMode === 'ALL' ? 'ALL' : 'ANY' }, 'p');
    if (tagFilter.where) { where.push(tagFilter.where.replace(/^ AND /, '')); params.push(...tagFilter.params); }
  }

  // 个性化筛选（V008）：必须与 keygroup /query 同口径，否则筛完导出会是另一批人
  if (body.extremePovertyMode) {
    const code = body.extremePovertyMode === 'CENTRALIZED' ? 'EXTREME_POVERTY_CENTRALIZED' : 'EXTREME_POVERTY_DISPERSED';
    where.push(`EXISTS (SELECT 1 FROM person_tag pt2 JOIN tag_definition td2 ON td2.id = pt2.tag_id
      WHERE pt2.person_id = p.id AND pt2.status = 'ACTIVE' AND td2.code = ?)`);
    params.push(code);
  }
  if (body.minDisabilityLevel || body.maxDisabilityLevel || body.disabilityType || body.guardian) {
    where.push('pd.person_id IS NOT NULL');
    const lvl = buildDisabilityLevelFilter(body.minDisabilityLevel, body.maxDisabilityLevel);
    if (lvl.where) { where.push(lvl.where); params.push(...lvl.params); }
    if (body.disabilityType) { where.push('pd.disability_type = ?'); params.push(body.disabilityType); }
    if (body.guardian) {
      where.push(body.guardian === 'YES'
        ? "pd.guardian_name IS NOT NULL AND pd.guardian_name <> ''"
        : "(pd.guardian_name IS NULL OR pd.guardian_name = '')");
    }
  }
  if (body.minSubsidy != null) { where.push('p.subsidy_amount >= ?'); params.push(body.minSubsidy); }
  if (body.maxSubsidy != null) { where.push('p.subsidy_amount <= ?'); params.push(body.maxSubsidy); }

  const whereSql = where.join(' AND ');
  // 导出的可选字段包含残疾信息（残疾类别/等级/证号/监护人），
  // 无论用户是否勾选都必须能取到，因此这里始终 JOIN，而非按筛选条件决定——
  // 否则勾选残疾字段导出时会报 Unknown column。
  // 导出本身已是全表顺序扫描，多一次 LEFT JOIN 的成本可忽略。
  const fromSql = 'FROM person p LEFT JOIN person_disability pd ON pd.person_id = p.id';

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

  // 标签编码 → 名称 映射，用于「全部标签」列把编码还原成中文
  const tagRows = await query<any>("SELECT code, name FROM tag_definition WHERE object_type = 'PERSON'");
  const tagNameMap = new Map<string, string>(tagRows.map((r: any) => [r.code, r.name]));

  try {
    // keyset（游标）分页：以 id 为游标逐批前进。
    // 相比 LIMIT/OFFSET，越往后翻页越不会退化——OFFSET 需要扫描并丢弃前面全部行，
    // 万级数据导出时最后几批会明显变慢。
    let lastId = 0;
    let total = 0;
    while (true) {
      const rows = await query<any>(
        `SELECT p.*, g.name AS grid_name, f.family_no AS family_name,
                pd.disability_type, pd.disability_level, pd.disability_card,
                pd.guardian_name, pd.guardian_phone,
                (SELECT GROUP_CONCAT(td.code)
                   FROM person_tag pt JOIN tag_definition td ON td.id = pt.tag_id
                  WHERE pt.person_id = p.id AND pt.status = 'ACTIVE') AS tag_codes
         ${fromSql} LEFT JOIN grid g ON g.id=p.grid_id LEFT JOIN family f ON f.id=p.family_id
         WHERE ${whereSql} AND p.id > ? ORDER BY p.id LIMIT ?`,
        [...params, lastId, BATCH]
      );
      if (!rows.length) break;
      for (const r of rows) {
        const tagCodes = r.tag_codes ? String(r.tag_codes).split(',') : [];
        const rowData: any[] = [];
        for (const k of fields) {
          if (k === 'gender') rowData.push(r.gender === 'MALE' ? '男' : '女');
          else if (k === 'birth_date') rowData.push(formatDateOrEmpty(r.birth_date));
          else if (k === 'grid_name') rowData.push(r.grid_name || '');
          else if (k === 'family_name') rowData.push(r.family_name || '');
          else if (k === 'status') rowData.push(r.status || '');
          // 残疾等级导出中文全称（一级（极重度）），台账直接可读
          else if (k === 'disability_level_label') rowData.push(disabilityLevelLabel(r.disability_level));
          else if (k.startsWith('is_')) {
            // 重点人群标志列：命中任一关联标签编码即为「是」
            const def = EXPORT_TAG_FLAGS.find((d) => d.key === k);
            let yes = def ? def.codes.some((c) => tagCodes.includes(c)) : false;
            if (def?.alsoDisabilityTable && r.disability_type) yes = true;
            rowData.push(yes ? '是' : '否');
          } else if (k === 'tags') {
            rowData.push(tagCodes.map((c: string) => tagNameMap.get(c) || c).join('、'));
          } else rowData.push(r[k] ?? '');
        }
        ws.addRow(rowData);
        total++;
      }
      if (rows.length < BATCH) break;
      lastId = Number(rows[rows.length - 1].id);
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
