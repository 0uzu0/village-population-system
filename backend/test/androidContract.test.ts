import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { personSchema } from '../src/modules/person';
import { updateSchema } from '../src/modules/pending';

/**
 * 移动端（Android）请求体契约测试。
 *
 * ## 为什么要有这份测试
 *
 * APP 的 `PersonCreateRequest` / 待核查补录 patch 是 Kotlin 数据类，
 * 后端是 zod schema，两边**没有编译期关联**——改任何一边，另一边都不会报错，
 * 只会在村里走访时表现为「点了保存没反应 / 提示保存失败」。
 * 这类问题在 PC 端不会出现（PC 的表单和后端同一套语言写的），
 * 因此是移动端独有的盲区。
 *
 * ## 做法
 *
 * 契约样本放在 `test/fixtures/android/*.json`，由**两端共用**：
 *  - 后端（本文件）：拿真实 zod schema 解析，保证「APP 会发的字段」后端都接受；
 *  - 移动端（`AndroidApiContractTest.kt`）：把数据类序列化后与样本逐键比对，
 *    保证「APP 实际发出的东西」就是样本。
 * 于是两端的口径被这一份样本钉在一起，而不是各写一遍注释各自漂移。
 */

const FIXTURE_DIR = path.resolve(__dirname, 'fixtures/android');

function loadFixture(name: string): Record<string, unknown> {
  const file = path.join(FIXTURE_DIR, name);
  if (!fs.existsSync(file)) throw new Error(`缺少契约样本：${file}`);
  return JSON.parse(fs.readFileSync(file, 'utf-8')) as Record<string, unknown>;
}

/** 样本里出现的每个键都必须真的存在于 schema 上——改字段名要能被这里抓住 */
function expectKeysAccepted(schema: any, fixture: Record<string, unknown>, label: string) {
  const shape: Record<string, unknown> = schema.shape ?? {};
  for (const key of Object.keys(fixture)) {
    expect(shape, `${label}: 后端 schema 上不存在字段「${key}」`).toHaveProperty(key);
  }
}

describe('移动端契约：新增 / 编辑人员', () => {
  it('「上门登记」提交的字段后端全部接受', () => {
    const body = loadFixture('person-create.json');
    expectKeysAccepted(personSchema, body, '新增人员');

    const parsed = personSchema.parse(body);
    expect(parsed.name).toBe('张三');
    expect(parsed.gender).toBe('MALE');
    expect(parsed.idCard).toBe('320102195503081232');
    expect(parsed.relation).toBe('HEAD');
    expect(parsed.tagIds).toEqual([8]);
  });

  it('编辑时清空字段发的是空串，后端按「置空」接受', () => {
    const body = loadFixture('person-update-clear.json');
    expectKeysAccepted(personSchema, body, '编辑人员');

    const parsed = personSchema.parse(body);
    // 空串必须能通过校验（真正把列写 NULL 的是 fieldMap 里的 `=== '' ? null : v`，
    // 校验层放行即可）。此前客户端把空值收成 null 再被 JSON 配置省掉，
    // 后端当成「没提交这个字段」→ 清空是假成功。
    expect(parsed.phone).toBe('');
    expect(parsed.phoneBackup).toBe('');
    expect(parsed.hukouAddress).toBe('');
    expect(parsed.remark).toBe('');
    expect(parsed.rowVersion).toBe(3);
  });

  it('未填身份证号时提交体里没有 idCard 键（后端据此转待核查）', () => {
    const body = { ...loadFixture('person-create.json') };
    delete body.idCard;

    const parsed = personSchema.parse(body);
    expect(parsed.idCard).toBeUndefined();
  });

  it('性别不接受中文：移动端必须先转成 MALE/FEMALE', () => {
    const body = { ...loadFixture('person-create.json'), gender: '男' };
    expect(personSchema.safeParse(body).success).toBe(false);
  });

  it('备注超长会被后端拒绝（客户端 FormRules 已先拦一道）', () => {
    const body = { ...loadFixture('person-create.json'), remark: 'x'.repeat(501) };
    expect(personSchema.safeParse(body).success).toBe(false);
  });
});

describe('移动端契约：待核查就地修正', () => {
  it('补录身份证的 patch 后端全部接受', () => {
    const patch = loadFixture('pending-patch.json');
    expectKeysAccepted(updateSchema, patch, '待核查补录');

    const parsed = updateSchema.parse(patch);
    expect(parsed.idCard).toBe('320102195503081232');
    expect(parsed.phone).toBe('13800000009');
    // 备用电话被清空：空串是合法的「未填」输入
    expect(parsed.phoneBackup).toBe('');
  });

  it('清空性别提交空串不会被 zod 拒掉（曾经的 400）', () => {
    // 移动端「性别」是可编辑文本框，用户删空后提交的就是 ''。
    // 后端按「未填」处理（该列不进 SET），而不是报错——报错会让整份补录都存不进去。
    const parsed = updateSchema.safeParse({ gender: '' });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.gender).toBeUndefined();
  });

  it('性别枚举只认 MALE/FEMALE，中文会被拒', () => {
    expect(updateSchema.safeParse({ gender: '男' }).success).toBe(false);
    expect(updateSchema.safeParse({ gender: 'MALE' }).success).toBe(true);
  });

  it('出生日期只认 YYYY-MM-DD', () => {
    expect(updateSchema.safeParse({ birthDate: '1955-03-08' }).success).toBe(true);
    expect(updateSchema.safeParse({ birthDate: '1955/03/08' }).success).toBe(false);
    // 空串按「未填」处理，不报错
    const cleared = updateSchema.safeParse({ birthDate: '' });
    expect(cleared.success).toBe(true);
    expect(cleared.success && cleared.data.birthDate).toBeNull();
  });

  it('处理备注超长会被拒绝（客户端 FormRules 已先拦一道）', () => {
    expect(updateSchema.safeParse({ handleNote: 'x'.repeat(256) }).success).toBe(false);
  });
});
