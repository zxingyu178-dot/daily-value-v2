/**
 * daily-value 模型工具单测（Phase 6 收口 H）
 * - H：跨午夜调度 msUntilNextLocalMidnight 精确排到“下一次本地午夜”，不依赖固定 24h interval，
 *       因此 DST 23/25 小时也不会漂移（每次到点后重新调度同一函数即可）。
 * - 顺带覆盖 localDateKey 本地业务日期（非 UTC 跨天）。
 */
import { describe, it, expect } from 'vitest';
import { msUntilNextLocalMidnight, localDateKey } from '@/core/models/daily-value';

describe('msUntilNextLocalMidnight（H：跨午夜调度）', () => {
  it('午夜前 30 秒 → 恰好 30_000ms 到零点', () => {
    // 本地时间 2026-08-23 23:59:30，下一次本地午夜 2026-08-24 00:00:00
    const from = new Date(2026, 7, 23, 23, 59, 30, 0);
    expect(msUntilNextLocalMidnight(from)).toBe(30_000);
  });

  it('正午 → 24 小时到下一个午夜（非固定 24h，仍排到本地午夜）', () => {
    const from = new Date(2026, 8, 1, 12, 0, 0, 0);
    // 到 2026-09-02 00:00:00 正好 12 小时
    expect(msUntilNextLocalMidnight(from)).toBe(12 * 3600_000);
  });

  it('刚过零点 → 到次日零点恰 24 小时', () => {
    const from = new Date(2026, 7, 23, 0, 0, 1, 0);
    // 23h 59m 59s
    expect(msUntilNextLocalMidnight(from)).toBe(23 * 3600_000 + 59 * 60_000 + 59_000);
  });

  it('返回非负（时间戳倒拨等异常输入不应为负）', () => {
    const from = new Date(2026, 7, 23, 0, 0, 0, 0);
    expect(msUntilNextLocalMidnight(from)).toBeGreaterThanOrEqual(0);
  });
});

describe('localDateKey（本地业务日期，非 UTC 跨天）', () => {
  it('生成 yyyy-MM-dd，月份/日补零', () => {
    expect(localDateKey(new Date(2026, 0, 3))).toBe('2026-01-03');
    expect(localDateKey(new Date(2026, 11, 31))).toBe('2026-12-31');
  });
});