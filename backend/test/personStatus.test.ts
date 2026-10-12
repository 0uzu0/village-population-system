import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  PERSON_STATUSES,
  ACTIVE_STATUSES,
  PERSON_ACTIVE_SQL,
  STATUS_LABELS,
  isActiveStatus,
  isInactiveStatus,
} from '../src/utils/personStatus';

const SRC_DIR = path.resolve(__dirname, '../src');

describe('人员状态口径（V007）', () => {
  it('状态枚举含「死亡」、不含已取消的「注销」', () => {
    expect(PERSON_STATUSES).toContain('DEAD');
    expect(PERSON_STATUSES).not.toContain('CANCELLED');
    expect(PERSON_STATUSES).toEqual(['NORMAL', 'MOVED_IN', 'MOVED_OUT', 'DEAD']);
  });

  it('在册口径只有正常与迁入', () => {
    expect(ACTIVE_STATUSES).toEqual(['NORMAL', 'MOVED_IN']);
    expect(isActiveStatus('NORMAL')).toBe(true);
    expect(isActiveStatus('MOVED_IN')).toBe(true);
    expect(isActiveStatus('MOVED_OUT')).toBe(false);
    expect(isActiveStatus('DEAD')).toBe(false);
    expect(isInactiveStatus('DEAD')).toBe(true);
    expect(isInactiveStatus('NORMAL')).toBe(false);
  });

  it('每个状态都有中文标签', () => {
    for (const s of PERSON_STATUSES) {
      expect(STATUS_LABELS[s], `缺少 ${s} 的中文标签`).toBeTruthy();
    }
    expect(STATUS_LABELS.DEAD).toBe('死亡');
  });

  it('在册过滤片段使用列表别名 p', () => {
    expect(PERSON_ACTIVE_SQL).toBe("p.status IN ('NORMAL','MOVED_IN')");
  });

  it('业务代码里不再出现 CANCELLED（迁移脚本的历史数据处理除外）', () => {
    const files = ['modules/person.ts', 'modules/keygroup.ts', 'modules/excel.ts', 'modules/statistics.ts'];
    for (const f of files) {
      const src = fs.readFileSync(path.join(SRC_DIR, f), 'utf8');
      expect(src.includes('CANCELLED'), `${f} 仍引用了已取消的 CANCELLED 状态`).toBe(false);
    }
  });
});
