import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const SRC = path.resolve(__dirname, '../src');
const read = (p: string) => fs.readFileSync(path.join(SRC, p), 'utf8');

const personSrc = read('modules/person.ts');
const excelSrc = read('modules/excel/importPerson.ts');
const pendingSrc = read('modules/pending.ts');
const migSrc = read('db/migrations/V013__person_birth_from_idcard.sql');
const pageSrc = fs.readFileSync(
  path.resolve(__dirname, '../../frontend/src/views/person/index.vue'),
  'utf8'
);
const utilSrc = fs.readFileSync(
  path.resolve(__dirname, '../../frontend/src/utils/idcard.ts'),
  'utf8'
);

/**
 * 年龄口径回归：**出生日期以身份证号为权威来源**。
 *
 * 事故形态：编辑人员时只改了身份证号，表单同时把旧的出生日期也提交上去，
 * 后端「表单值优先」→ birth_date 不变 → 年龄（由 birth_date 计算）永远不跟着证件走。
 * 修复方向：
 *  1. 有身份证 → 一律按证件重算 birth_date（新增/编辑/导入/待核查确认四条写入路径统一）；
 *  2. 已有数据用 V013 一次性回填；
 *  3. 前端录入身份证时即时带出出生日期，避免保存后才发现。
 */
describe('人员写入：出生日期以身份证为准（person.ts）', () => {
  it('birth_date 不再走 fieldMap，避免表单旧值抢先写入', () => {
    // fieldMap 里若仍有 birthDate，表单提交的旧出生日期会覆盖证件值
    expect(personSrc).toMatch(/const fieldMap: Record<string, string> = \{[\s\S]*?\};/);
    const fieldMap = personSrc.match(/const fieldMap: Record<string, string> = \{([\s\S]*?)\};/)![1];
    expect(fieldMap).not.toContain('birthDate');
  });

  it('编辑时优先写证件派生值，无证件才用表单值', () => {
    expect(personSrc).toContain('if (identity.birth_date !== undefined) {');
    expect(personSrc).toMatch(/identity\.birth_date !== undefined\)\s*\{\s*sets\.push\('birth_date = \?'\)/);
    // 兜底分支：无证件（或证件日期不合法）才采用表单填写的出生日期
    expect(personSrc).toMatch(/else if \(body\.birthDate !== undefined\)/);
  });

  it('新增时同样以证件派生值优先', () => {
    expect(personSrc).toContain('identity.birth_date || body.birthDate || null');
  });

  it('prepareIdentity 只在解析出合法日期时才产出 birth_date', () => {
    expect(personSrc).toContain('const birth = birthFromIdCard(normalized);');
    expect(personSrc).toContain('if (birth) result.birth_date = birth;');
  });
});

describe('其它写入路径同样以身份证为准', () => {
  it('Excel 导入：证件日期优先于表格出生日期列', () => {
    expect(excelSrc).toContain(
      "const birthDate = (idCardNormalized ? birthFromIdCard(idCardNormalized) : null) || row['出生日期'] || null;"
    );
  });

  it('待核查确认入库：证件日期优先于登记值', () => {
    expect(pendingSrc).toContain('const birthDate = birthFromIdCard(idCard) || formatDate(p.birth_date);');
  });
});

describe('V013 迁移：回填已有档案的出生日期', () => {
  it('是对 person 的纯 DML UPDATE，可重复执行', () => {
    expect(migSrc).toMatch(/UPDATE\s+`person`/i);
    expect(migSrc).toContain('SET `birth_date` = STR_TO_DATE(');
    expect(migSrc).toContain("`birth_date` <> STR_TO_DATE(");
    // 纯 DML：不含 DDL，迁移器事务回滚有效
    expect(/^\s*(ALTER|CREATE|DROP|TRUNCATE|RENAME)\s/im.test(migSrc)).toBe(false);
  });

  it('含日期合法性护栏，绝不把 birth_date 写成 NULL', () => {
    expect(migSrc).toContain("SUBSTRING(`id_card`, 7, 4) BETWEEN '1900' AND '2100'");
    expect(migSrc).toContain("SUBSTRING(`id_card`, 11, 2) BETWEEN '01' AND '12'");
    expect(migSrc).toContain("SUBSTRING(`id_card`, 13, 2) BETWEEN '01' AND '31'");
    expect(migSrc).toContain("'%Y-%m-%d') IS NOT NULL");
    expect(migSrc).toContain('CHAR_LENGTH(TRIM(`id_card`)) = 18');
  });

  it('两个目录的迁移文件内容一致', () => {
    const other = path.resolve(__dirname, '../../database/migrations/V013__person_birth_from_idcard.sql');
    expect(fs.existsSync(other), 'database/migrations 下缺少 V013').toBe(true);
    expect(fs.readFileSync(other, 'utf8').trim()).toBe(migSrc.trim());
  });
});

describe('前端录入时即时带出（年龄随身份证更新）', () => {
  it('表单监听身份证号，自动回填出生日期与性别', () => {
    expect(pageSrc).toContain("import { birthFromIdCard, genderFromIdCard } from '@/utils/idcard';");
    expect(pageSrc).toContain('watch(() => form.idCard');
    expect(pageSrc).toContain('idCardBirth.value = birth;');
    expect(pageSrc).toContain('if (birth) form.birthDate = birth;');
  });

  it('有身份证时出生日期不可手改，并给出说明', () => {
    expect(pageSrc).toContain(':disabled="!!idCardBirth"');
    expect(pageSrc).toContain('以身份证号为准，自动带出');
  });

  it('前端解析与后端同口径（月日不合法返回 null）', () => {
    expect(utilSrc).toContain('daysInMonth');
    expect(utilSrc).toContain('if (di > daysInMonth) return null;');
  });
});
