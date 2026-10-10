/**
 * 回读校验生成的导入表格：
 *  - 列头是否为系统要求的 12 列（顺序一致）
 *  - 身份证号是否为文本格式、是否合法、是否重复
 *  - 手机号是否为 11 位
 *  - 网格编号是否都有值
 * 用法：node backend/scripts/verify-import.js [目录]
 */
const path = require('path');
const fs = require('fs');
const ExcelJS = require('exceljs');

const OUT_DIR = process.argv[2] || path.join(__dirname, '..', '..', '导入数据');
const IMPORT_COLUMNS = ['姓名','性别','出生日期','身份证号','手机号','户籍地址','实际居住地址','所属村庄','网格编号','家庭编号','与户主关系','备用手机号'];

function validId(id) {
  if (!/^\d{17}[\dXx]$/.test(id)) return false;
  const w = [7,9,10,5,8,4,2,1,6,3,7,9,10,5,8,4,2];
  const codes = ['1','0','X','9','8','7','6','5','4','3','2'];
  let s = 0;
  for (let i = 0; i < 17; i++) s += Number(id[i]) * w[i];
  return codes[s % 11] === id[17].toUpperCase();
}

async function readRows(file) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const ws = wb.worksheets[0];
  const rows = [];
  ws.eachRow({ includeEmpty: false }, (r, i) => {
    if (i === 1) return; // 跳过表头
    rows.push(r.values.slice(1));
  });
  return { header: ws.getRow(1).values.slice(1), rows, name: ws.name };
}

(async () => {
  const files = fs.readdirSync(OUT_DIR).filter((f) => /^\d\d_.*\.xlsx$/.test(f)).sort();
  if (!files.length) {
    console.error('未找到待校验文件：' + OUT_DIR);
    process.exit(1);
  }
  const allIds = new Map();
  let totalBad = 0, totalEmpty = 0, totalDup = 0;

  for (const f of files) {
    const full = path.join(OUT_DIR, f);
    const { header, rows, name } = await readRows(full);
    const isGrid = f.startsWith('04');
    const expect = isGrid
      ? ['网格编号','网格名称','网格负责人','网格员','网格描述','覆盖人数']
      : IMPORT_COLUMNS;
    const headOk = expect.every((c, i) => String(header[i] ?? '') === c);

    console.log(`\n=== ${f} ===`);
    console.log(`  工作表：${name} | 数据行：${rows.length} | 列头一致：${headOk ? '是' : '否'}`);
    if (!headOk) {
      console.log('  实际列头：', header);
      totalBad++;
    }
    if (isGrid) {
      rows.forEach((r) => console.log(`  ${r[0]}  ${r[1]}`));
      continue;
    }

    let bad = 0, empty = 0, dup = 0, badPhone = 0, noGrid = 0;
    for (const r of rows) {
      const id = String(r[3] ?? '').trim();
      if (!id) { empty++; continue; }
      if (!validId(id)) { bad++; continue; }
      if (allIds.has(id)) { dup++; continue; }
      allIds.set(id, f);
      const phone = String(r[4] ?? '').trim();
      if (phone && !/^1[3-9]\d{9}$/.test(phone)) badPhone++;
      if (!String(r[8] ?? '').trim()) noGrid++;
    }
    console.log(`  身份证：合法 ${allIds.size ? '' : ''}有效 ${rows.length - empty - bad - dup} | 空 ${empty} | 非法 ${bad} | 跨文件重复 ${dup}`);
    console.log(`  手机号异常 ${badPhone} | 无网格编号 ${noGrid}`);
    totalBad += bad; totalEmpty += empty; totalDup += dup;
  }

  console.log(`\n汇总：身份证空 ${totalEmpty} 条（→待核查）、非法 ${totalBad} 条（→待核查）、跨文件重复 ${totalDup} 条`);
  console.log(`正式可入库身份证总量：${allIds.size}`);
})().catch((e) => { console.error(e); process.exit(1); });
