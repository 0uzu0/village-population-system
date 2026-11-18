import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * 三端版本号必须同号。
 *
 * 现状是「版本号散落在三个地方」：
 *  - `backend/package.json` —— 全系统版本号的**唯一来源**；
 *  - `frontend/package.json` —— 网页侧栏的构建标识（`v2.3.0 · 时间`）；
 *  - 安卓 APK 的 versionName —— CI 与本地构建都从 backend/package.json 读。
 *
 * 漂移的后果不是崩溃，而是排查时的误导：网页说 v2.3.0、手机上「我的」页说
 * v2.2.9，于是所有人都在怀疑「是不是没部署成功」，其实只是两处没一起改。
 * 这条测试把「改一处漏一处」拦在 CI 里。
 */
const ROOT = path.resolve(__dirname, '../..');

function version(file: string): string {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8')) as { version?: string };
  return pkg.version ?? '';
}

describe('三端版本号', () => {
  it('前后端 package.json 同号', () => {
    expect(version('frontend/package.json')).toBe(version('backend/package.json'));
  });

  it('版本号是 x.y.z 形式（安卓 versionCode 另有 CI 的构建序号）', () => {
    expect(version('backend/package.json')).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('安卓构建的版本号来自 backend/package.json，而不是写死的字面量', () => {
    const gradle = fs.readFileSync(path.join(ROOT, 'android/app/build.gradle.kts'), 'utf8');
    expect(gradle).toContain('../backend/package.json');
    // versionName 必须落到读出来的统一版本上（0.0.0 只是「读不到文件」的兜底）
    const versionNameLine = gradle.split('\n').find((l) => l.includes('val appVersionName')) ?? '';
    expect(versionNameLine).toContain('unifiedVersionName');
    // 回归守卫：曾经写死 2.2.3，导致装了新包仍显示旧版本号
    expect(gradle).not.toContain('"2.2.3"');
  });

  it('安卓 CI 也读同一个来源，且标签构建校验与代码版本一致', () => {
    const workflow = fs.readFileSync(path.join(ROOT, '.github/workflows/android.yml'), 'utf8');
    expect(workflow).toContain("require('../backend/package.json').version");
    expect(workflow).toContain('与 backend/package.json');
  });
});
