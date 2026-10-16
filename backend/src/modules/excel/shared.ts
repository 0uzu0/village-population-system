import path from 'path';
import fs from 'fs';
import multer from 'multer';
import ExcelJS from 'exceljs';
import { query, execute } from '../../config/db';
import { AppError } from '../../utils/response';
import { env } from '../../config/env';
import { formatDate } from '../../utils/date';

// ===== 以下内容自 modules/excel.ts 机械搬迁，未改动逻辑 =====

// 上传目录
export const UPLOAD_DIR = path.resolve(env.uploadDir);
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) =>
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${path.extname(file.originalname)}`),
});
export const upload = multer({
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
export const IMPORT_COLUMNS = [
  '姓名',
  '性别',
  '出生日期',
  '身份证号',
  '手机号',
  '户籍地址',
  '实际居住地址',
  '所属村庄',
  '网格编号',
  '家庭编号',
  '与户主关系',
  '备用手机号',
];

/**
 * 重点人群名单导入模板列。
 * 与人口档案导入的区别：本导入不新建人员，只按身份证号（或唯一姓名）匹配已有人员并打标签。
 */
export const KEYGROUP_COLUMNS = ['姓名', '身份证号', '人员类别', '依据/备注', '生效日期'];

/**
 * 内置别名：覆盖村务台账里的常见叫法（五保户/特困供养、低保户…）。
 * 仅作兜底补充——系统在「人口标签」里新增的标签会自动参与匹配
 * （按 编码 / 名称 / 别名 命中），无需改动这里的代码。
 */
export const KEYGROUP_ALIASES: Record<string, string[]> = {
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
export async function loadKeyGroupTagDict(): Promise<Map<string, KgTagEntry>> {
  const rows = await query<any>(
    "SELECT id, code, name, alias, enabled, need_audit FROM tag_definition WHERE object_type = 'PERSON'"
  );
  return loadKeyGroupTagDictFromRows(rows);
}

/** 纯函数版词典构建，便于单测覆盖（含停用标签，导入时另给提示） */
export function loadKeyGroupTagDictFromRows(rows: any[]): Map<string, KgTagEntry> {
  const dict = new Map<string, KgTagEntry>();
  const put = (token: any, entry: KgTagEntry) => {
    const k = String(token ?? '')
      .trim()
      .toLowerCase();
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
export function kgTagLabels(dict: Map<string, KgTagEntry>): string[] {
  return [...new Set([...dict.values()].map((d) => d.name))];
}

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
export async function readRowsByColumns(
  filePath: string,
  columns: string[],
  requiredColumns?: string[]
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
      const v = raw instanceof Date ? formatDate(raw) : raw == null ? '' : String(raw).trim();
      obj[c] = v;
    });
    if (Object.values(obj).some((v) => v !== '')) rows.push(obj);
  });
  return rows;
}

/** 人员导入专用：按人员模板的列清单读取，身份三列为必填 */
export async function readRows(filePath: string): Promise<Record<string, any>[]> {
  return readRowsByColumns(filePath, IMPORT_COLUMNS, ['姓名', '身份证号', '性别']);
}

/** 批量写入分片大小：逐行 INSERT 在万行级导入时会产生上万次数据库往返 */
export const WRITE_CHUNK = 500;

/** 删除临时文件，删除失败不影响主流程（文件残留在 uploads 目录，可定期清理） */
export function safeUnlink(filePath?: string): void {
  if (!filePath) return;
  fs.unlink(filePath, () => {});
}

/** 批量写入导入错误行 */
export async function insertImportErrors(
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
