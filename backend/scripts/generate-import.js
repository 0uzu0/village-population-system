/**
 * 户籍 / 退役军人台账 → 系统导入表生成器
 *
 * 用法：
 *   node backend/scripts/generate-import.js [输出目录]
 *
 * 产出（严格对齐系统导入模板 12 列，顺序不可变）：
 *   01_人员导入_主表（2026户籍）.xlsx
 *   02_人员导入_退役军人及优抚补充.xlsx
 *   03_人员导入_2025户籍补充.xlsx
 *   04_网格清单.xlsx             —— 需先在系统中建好，导入时才能填「网格编号」
 *   00_导入说明.md
 *
 * 设计要点：
 *   - 系统导入只读取第 1 个工作表、按列位置 1..12 解析，因此每个文件只写一个 sheet；
 *   - 「与户主关系=户主」会被系统映射为 HEAD，导入后可用「按门牌号自动归户」一键建家庭，
 *     故本脚本不预生成家庭编号；
 *   - 身份证号为空/非法的行现在会自动落入「待核查人员」，无需单独剔除。
 */
const path = require('path');
const fs = require('fs');
const ExcelJS = require('exceljs');

// ---- 系统导入模板 12 列（顺序与后端 IMPORT_COLUMNS 一致） ----
const IMPORT_COLUMNS = ['姓名', '性别', '出生日期', '身份证号', '手机号', '户籍地址', '实际居住地址', '所属村庄', '网格编号', '家庭编号', '与户主关系', '备用手机号'];

const SRC = {
  hukou2026: 'D:/SYNC/户籍/2026户籍.xlsx',
  hukou2025: 'D:/SYNC/户籍/2025户籍（维护）.xlsx',
  veteran: 'D:/SYNC/军退人武/退/2025/退役军人及优抚对象名单2025.xlsx',
};

const OUT_DIR = process.argv[2] || path.resolve(__dirname, '../../导入数据');

// ---------- 工具 ----------
const WEIGHTS = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
const CHECK = ['1', '0', 'X', '9', '8', '7', '6', '5', '4', '3', '2'];
function validId(v) {
  const s = String(v || '').trim().toUpperCase();
  if (!/^\d{17}[\dX]$/.test(s)) return false;
  const sum = WEIGHTS.reduce((a, w, i) => a + w * parseInt(s[i], 10), 0);
  return CHECK[sum % 11] === s[17];
}
function birthFromId(id) {
  const s = String(id || '').trim();
  if (s.length !== 18) return '';
  return `${s.slice(6, 10)}-${s.slice(10, 12)}-${s.slice(12, 14)}`;
}
function txt(v) {
  if (v == null) return '';
  if (v instanceof Date) {
    const p = (n) => String(n).padStart(2, '0');
    return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())}`;
  }
  if (typeof v === 'object') {
    if (Array.isArray(v)) return v.map(txt).filter(Boolean).join(' ');
    if ('text' in v && v.text != null) return String(v.text).trim();
    if ('result' in v && v.result != null) return String(v.result).trim();
    return '';
  }
  return String(v).trim();
}
/** 归一化地址：全角转半角、连字符统一、去空白 */
function normAddr(raw) {
  return String(raw || '')
    .replace(/[\uFF01-\uFF5E]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[－—–−~～]/g, '-')
    .replace(/\s+/g, '')
    .trim();
}
/** 从地址推断自然村；无「村」字时回落到社区名 */
function villageOf(addr) {
  const s = normAddr(addr).replace(/^柘塘街道/, '');
  if (!s) return '';
  const m = s.match(/^[^\d]*/);
  const base = (m ? m[0] : s).trim();
  const idx = base.lastIndexOf('村');
  if (idx >= 0) {
    // 「梅山村陈家边村」→「陈家边村」
    const parts = base.split('村').filter(Boolean);
    return parts.length ? parts[parts.length - 1] + '村' : base.slice(0, idx + 1);
  }
  return '柘塘社区';
}
/** 拆分多手机号：第一个为手机号，第二个为备用手机号 */
function splitPhones(raw) {
  const s = txt(raw);
  const nums = s.match(/1[3-9]\d{9}/g) || [];
  return { phone: nums[0] || '', backup: nums[1] || '' };
}

async function readSheet(file, sheetName) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  return sheetName ? wb.getWorksheet(sheetName) : wb.worksheets[0];
}

function writeImportFile(filePath, sheetTitle, rows) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheetTitle);
  ws.columns = IMPORT_COLUMNS.map((c) => ({ header: c, key: c, width: c === '户籍地址' || c === '实际居住地址' ? 30 : 16 }));
  for (const r of rows) ws.addRow(r);
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).alignment = { vertical: 'middle' };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  // 身份证号、手机号、日期按文本写入，避免 Excel 自动转科学计数法
  for (let r = 2; r <= rows.length + 1; r++) {
    ws.getCell(r, 4).numFmt = '@';
    ws.getCell(r, 5).numFmt = '@';
    ws.getCell(r, 12).numFmt = '@';
  }
  return wb.xlsx.writeFile(filePath);
}

// ---------- 主流程 ----------
(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const report = [];
  const log = (s) => { report.push(s); console.log(s); };

  // ===== 1. 主表：2026 户籍 =====
  const ws = await readSheet(SRC.hukou2026);
  log(`主表源：${SRC.hukou2026} / ${ws.name}（${ws.rowCount} 行）`);

  const raw = [];
  let lastGrid = '';
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const name = txt(row.getCell(4).value);
    const idRaw = txt(row.getCell(3).value);
    if (!name && !idRaw) continue;
    const g = txt(row.getCell(2).value);
    if (g) lastGrid = g; // 网格列存在合并/省略，需向下填充
    const addr = txt(row.getCell(5).value);
    const ph1 = splitPhones(row.getCell(11).value);
    const ph2 = splitPhones(row.getCell(12).value);
    raw.push({
      name,
      gender: txt(row.getCell(7).value),
      birth: txt(row.getCell(9).value) || birthFromId(idRaw),
      idCard: idRaw,
      phone: ph1.phone || ph2.phone,
      backup: ph1.backup || (ph1.phone ? '' : ph2.backup),
      addr,
      relation: txt(row.getCell(6).value),
      grid: lastGrid,
    });
  }
  log(`  读取 ${raw.length} 行`);

  // 2025 表可能含 2026 表没有的网格名，需一并纳入编码表（网格列存在合并单元格，需向下填充）
  const w25 = await readSheet(SRC.hukou2025, '汇总');
  const names25 = new Set();
  let lastGrid25 = '';
  for (let r = 2; r <= w25.rowCount; r++) {
    const g = txt(w25.getRow(r).getCell(2).value);
    if (g) lastGrid25 = g;
    if (lastGrid25) names25.add(lastGrid25);
  }

  // 网格编码（按名称排序，保证多次生成结果稳定）
  const gridNames = [...new Set([...raw.map((r) => r.grid).filter(Boolean), ...names25])].sort();
  const gridCode = new Map(gridNames.map((n, i) => [n, `G${String(i + 1).padStart(3, '0')}`]));
  log(`  网格 ${gridNames.length} 个：${gridNames.map((n) => `${n}=${gridCode.get(n)}`).join('，')}`);

  // 地址 / 村庄 → 网格 反查表：退役军人台账没有网格列，只能按地址回填
  const addrGrid = new Map();
  const villageGrid = new Map();
  const villageCnt = new Map();
  for (const r of raw) {
    const code = gridCode.get(r.grid);
    if (!code || !r.addr) continue;
    const a = normAddr(r.addr);
    if (a && !addrGrid.has(a)) addrGrid.set(a, code);
    const v = villageOf(r.addr);
    if (v) villageCnt.set(`${v}|${code}`, (villageCnt.get(`${v}|${code}`) || 0) + 1);
  }
  for (const [k, c] of villageCnt) {
    const [v, code] = k.split('|');
    const cur = villageGrid.get(v);
    if (!cur || c > cur.cnt) villageGrid.set(v, { code, cnt: c });
  }
  let hitAddr = 0, hitVillage = 0, hitNone = 0;
  /** 按地址（精确）→ 村庄（众数）逐级反查网格编号 */
  function resolveGrid(addr) {
    const a = normAddr(addr);
    if (a && addrGrid.has(a)) { hitAddr++; return addrGrid.get(a); }
    const v = villageOf(addr);
    if (v && villageGrid.has(v)) { hitVillage++; return villageGrid.get(v).code; }
    hitNone++; return '';
  }

  // 身份证查重（文件内重复会导致整行导入失败）
  const seen = new Set();
  const dups = [];
  const master = [];
  let noId = 0;
  let badId = 0;
  for (const r of raw) {
    const id = r.idCard ? String(r.idCard).trim().toUpperCase() : '';
    if (!id) { noId++; }
    else if (!validId(id)) { badId++; }
    else if (seen.has(id)) { dups.push(r.name); continue; }
    if (id) seen.add(id);
    master.push({ ...r, idCard: id });
  }
  log(`  唯一身份证 ${seen.size}；文件内重复 ${dups.length} 行（已去重）；无身份证 ${noId} 行；身份证非法 ${badId} 行（后两类将自动进入待核查）`);

  // 排序：网格 → 地址 → 户主优先，导入后列表更整齐
  master.sort((a, b) => {
    const ga = gridCode.get(a.grid) || 'ZZZ';
    const gb = gridCode.get(b.grid) || 'ZZZ';
    if (ga !== gb) return ga < gb ? -1 : 1;
    const aa = normAddr(a.addr), ab = normAddr(b.addr);
    if (aa !== ab) return aa < ab ? -1 : 1;
    return (a.relation === '户主' ? 0 : 1) - (b.relation === '户主' ? 0 : 1);
  });

  const masterRows = master.map((r) => [
    r.name, r.gender === '男' || r.gender === '女' ? r.gender : '', r.birth, r.idCard, r.phone,
    r.addr, r.addr, villageOf(r.addr), gridCode.get(r.grid) || '', '', r.relation, r.backup,
  ]);
  await writeImportFile(path.join(OUT_DIR, '01_人员导入_主表（2026户籍）.xlsx'), '人员导入', masterRows);
  log(`  → 01_人员导入_主表（2026户籍）.xlsx：${masterRows.length} 行`);

  // ===== 2. 网格清单 =====
  const gridWb = new ExcelJS.Workbook();
  const gws = gridWb.addWorksheet('网格清单');
  // 列顺序对齐系统「网格管理 - 新增网格」表单：网格编号 / 网格名称 / 网格负责人 / 网格员 / 网格描述
  gws.columns = [
    { header: '网格编号', key: 'no', width: 14 },
    { header: '网格名称', key: 'name', width: 20 },
    { header: '网格负责人', key: 'manager', width: 14 },
    { header: '网格员', key: 'staff', width: 20 },
    { header: '网格描述', key: 'desc', width: 30 },
    { header: '覆盖人数', key: 'cnt', width: 10 },
  ];
  const cntByGrid = new Map();
  for (const r of raw) cntByGrid.set(r.grid, (cntByGrid.get(r.grid) || 0) + 1);
  for (const n of gridNames) {
    gws.addRow({
      no: gridCode.get(n),
      name: n,
      manager: '',
      staff: '',
      desc: `柘塘社区 ${n}（户籍台账自动汇总，覆盖 ${cntByGrid.get(n) || 0} 人）`,
      cnt: cntByGrid.get(n) || 0,
    });
  }
  gws.getRow(1).font = { bold: true };
  await gridWb.xlsx.writeFile(path.join(OUT_DIR, '04_网格清单.xlsx'));
  log(`  → 04_网格清单.xlsx：${gridNames.length} 行`);

  // ===== 3. 退役军人及优抚补充（排除主表已有身份证） =====
  const vwb = new ExcelJS.Workbook();
  await vwb.xlsx.readFile(SRC.veteran);
  const vRows = [];
  const unassigned = []; // 网格反查失败的行，单独出文件，避免整批导入报「网格编号不存在」
  const vSeen = new Set();

  const ws1 = vwb.getWorksheet('柘塘社区');
  if (ws1) {
    for (let r = 5; r <= ws1.rowCount; r++) {
      const row = ws1.getRow(r);
      const name = txt(row.getCell(2).value);
      const id = String(txt(row.getCell(7).value)).trim().toUpperCase();
      if (!name && !id) continue;
      if (id && seen.has(id)) continue; // 主表已有
      if (id && vSeen.has(id)) continue;
      if (id) vSeen.add(id);
      const addrRaw = txt(row.getCell(15).value);
      const addr = addrRaw.includes(',') ? addrRaw.split(',').filter(Boolean).pop().trim() : addrRaw;
      const ph = splitPhones(row.getCell(23).value);
      const g = resolveGrid(addr);
      const out = [name, txt(row.getCell(3).value), birthFromId(id), id, ph.phone, addr, addr, villageOf(addr), g, '', '', ph.backup];
      (g ? vRows : unassigned).push(out);
    }
  }
  const ws2 = vwb.getWorksheet('优抚');
  if (ws2) {
    for (let r = 2; r <= ws2.rowCount; r++) {
      const row = ws2.getRow(r);
      const name = txt(row.getCell(2).value);
      const id = String(txt(row.getCell(3).value)).trim().toUpperCase();
      if (!name && !id) continue;
      if (id && seen.has(id)) continue;
      if (id && vSeen.has(id)) continue;
      if (id) vSeen.add(id);
      const addr = txt(row.getCell(13).value);
      const ph = splitPhones(row.getCell(12).value);
      const g = resolveGrid(addr);
      const out = [name, '', birthFromId(id), id, ph.phone, addr, addr, villageOf(addr), g, '', '', ph.backup];
      (g ? vRows : unassigned).push(out);
    }
  }
  await writeImportFile(path.join(OUT_DIR, '02_人员导入_退役军人及优抚补充.xlsx'), '人员导入', vRows);
  log(`  → 02_人员导入_退役军人及优抚补充.xlsx：${vRows.length} 行（网格回填：地址精确 ${hitAddr}、村庄匹配 ${hitVillage}、未匹配 ${hitNone}）`);
  if (unassigned.length) {
    await writeImportFile(path.join(OUT_DIR, '05_人员导入_退役军人（待分配网格）.xlsx'), '人员导入', unassigned);
    log(`  → 05_人员导入_退役军人（待分配网格）.xlsx：${unassigned.length} 行（网格未能反查，需人工补网格编号后再导入）`);
  }

  // ===== 4. 2025 户籍补充（仅取 2026 主表中没有的人） =====
  const rows25 = [];
  const seen25 = new Set();
  let g25 = '';
  for (let r = 2; r <= w25.rowCount; r++) {
    const row = w25.getRow(r);
    const gRaw = txt(row.getCell(2).value); // 2025 表第 2 列为网格名，合并单元格需向下填充
    if (gRaw) g25 = gRaw;
    const name = txt(row.getCell(4).value);
    const id = String(txt(row.getCell(3).value)).trim().toUpperCase();
    if (!name && !id) continue;
    if (id && (seen.has(id) || vSeen.has(id))) continue;
    if (id && seen25.has(id)) continue;
    if (id) seen25.add(id);
    const addr = txt(row.getCell(5).value);
    const ph = splitPhones(row.getCell(11).value);
    const g = gridCode.get(g25) || resolveGrid(addr);
    rows25.push([name, txt(row.getCell(7).value), txt(row.getCell(9).value) || birthFromId(id), id, ph.phone, addr, addr, villageOf(addr), g, '', txt(row.getCell(6).value), ph.backup]);
  }
  await writeImportFile(path.join(OUT_DIR, '03_人员导入_2025户籍补充.xlsx'), '人员导入', rows25);
  log(`  → 03_人员导入_2025户籍补充.xlsx：${rows25.length} 行`);

  // ===== 5. 说明 =====
  const md = [
    '# 导入数据生成说明',
    '',
    `生成时间：${new Date().toLocaleString('zh-CN')}`,
    '',
    '## 一、导入顺序（务必按序执行）',
    '',
    '1. **先建网格**：按 `04_网格清单.xlsx` 在系统「网格管理」中逐个新增，网格编号必须与清单一致。',
    '   - 未建网格就导入，会整批报「网格编号不存在」。',
    '2. **导入人员**：依次上传 `01` → `02` → `03`（每份用不同批次号）。',
    '3. **一键归户**：导入完成后到「家庭管理 → 按门牌号自动归户」，依据选「户籍地址」，先预览再执行，系统会自动按门牌号建家庭并识别户主。',
    '4. **处理待核查**：身份证为空或非法的行不会进入正式档案，会落到「待核查人员」页面，补录后再确认入库。',
    '',
    '## 二、文件清单',
    '',
    '| 文件 | 行数 | 说明 |',
    '| --- | --- | --- |',
    `| 01_人员导入_主表（2026户籍）.xlsx | ${masterRows.length} | 2026 年户籍融合总表，为主体数据 |`,
    `| 02_人员导入_退役军人及优抚补充.xlsx | ${vRows.length} | 退役军人及优抚对象中户籍表未覆盖的人员 |`,
    `| 03_人员导入_2025户籍补充.xlsx | ${rows25.length} | 仅 2025 年有、2026 年已无的人员，建议人工核对后再导入 |`,
    `| 04_网格清单.xlsx | ${gridNames.length} | 需预先在系统中创建（列顺序对齐「新增网格」表单） |`,
    ...(unassigned.length ? [`| 05_人员导入_退役军人（待分配网格）.xlsx | ${unassigned.length} | 地址无法反查网格，**需人工补「网格编号」列后再导入**，否则整批失败 |`] : []),
    '',
    '## 三、列映射关系',
    '',
    '| 系统列 | 来源 | 备注 |',
    '| --- | --- | --- |',
    '| 姓名 | 居住人姓名 | |',
    '| 性别 | 性别 | 仅接受「男 / 女」，其他值会留空后由身份证推导 |',
    '| 出生日期 | 出生年月 | 缺失时由身份证号推导 |',
    '| 身份证号 | 身份证号 | **完整号码**，非脱敏值 |',
    '| 手机号 | 联系电话 | 多号码时取第一个 |',
    '| 备用手机号 | 联系电话 | 多号码时取第二个 |',
    '| 户籍地址 / 实际居住地址 | 路街巷 | 源表未区分户籍与常住地，两者暂取同一值 |',
    '| 所属村庄 | 由地址推断 | 取自然村名，无「村」字时记为「柘塘社区」 |',
    '| 网格编号 | 网格 | 对应 `04_网格清单.xlsx`，**需先建网格** |',
    '| 家庭编号 | — | 留空，导入后用「按门牌号自动归户」生成 |',
    '| 与户主关系 | 与户主关系 | 「户主」会被系统识别为 HEAD |',
    '',
    '## 四、数据质量',
    '',
    `- 主表读取 ${raw.length} 行，去重后 ${masterRows.length} 行。`,
    `- 文件内身份证重复 ${dups.length} 行（已保留首次出现的那条）。`,
    `- 身份证为空 ${noId} 行、非法 ${badId} 行 —— 这些行导入后会进入「待核查人员」，不会污染正式档案。`,
    '',
    '## 五、注意事项',
    '',
    '- 导入接口只读取文件的**第一个工作表**，请勿在文件里新增 sheet 或调整列顺序。',
    '- 同一批次号不能重复提交；重导请更换批次号。',
    '- 系统不会覆盖已存在的身份证号，重复导入同一批人会全部失败，请先确认库中是否已有数据。',
  ].join('\n');
  fs.writeFileSync(path.join(OUT_DIR, '00_导入说明.md'), md, 'utf8');
  log(`  → 00_导入说明.md`);

  log(`\n全部输出至：${OUT_DIR}`);
})().catch((e) => { console.error(e); process.exit(1); });
