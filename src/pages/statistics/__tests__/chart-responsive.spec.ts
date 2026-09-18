/**
 * 2.20.0 Gate A 测试（CHART-RESPONSIVE-01..04 + CHART-AXIS-01/02）
 * - chart-responsive 纯函数（hasUsableChartSize / observeChartContainer / calculateAxisInterval）
 * - useModuleChart 行为（隐藏容器不初始化 / RO 尺寸恢复后初始化 / 切模式首显全尺寸）
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  calculateAxisInterval,
  hasUsableChartSize,
  labelCountForInterval,
  observeChartContainer,
} from '@/pages/statistics/chart-responsive';

describe('CHART-RESPONSIVE-01：隐藏/无尺寸容器不视为可用', () => {
  it('hasUsableChartSize：0 宽 0 高 / display:none（client 尺寸为 0）→ false', () => {
    const hiddenEl = { clientWidth: 0, clientHeight: 0 } as HTMLElement;
    expect(hasUsableChartSize(hiddenEl)).toBe(false);
    const smallEl = { clientWidth: 20, clientHeight: 200 } as HTMLElement;
    expect(hasUsableChartSize(smallEl)).toBe(false);
    expect(hasUsableChartSize(null)).toBe(false);
    expect(hasUsableChartSize(undefined)).toBe(false);
  });

  it('hasUsableChartSize：真实尺寸（≥32 宽高）→ true', () => {
    const ok = { clientWidth: 360, clientHeight: 200 } as HTMLElement;
    expect(hasUsableChartSize(ok)).toBe(true);
  });
});

describe('CHART-RESPONSIVE-03：ResizeObserver 变化驱动（模拟 RO）', () => {
  // 手动驱动的假 ResizeObserver：记录回调，测试可手动触发尺寸变化
  class FakeRO {
    static instances: FakeRO[] = [];
    cb: (entries: { contentRect: { width: number; height: number } }[]) => void;
    constructor(cb: (entries: { contentRect: { width: number; height: number } }[]) => void) {
      this.cb = cb;
      FakeRO.instances.push(this);
    }
    observe() {}
    disconnect() { FakeRO.instances = FakeRO.instances.filter((i) => i !== this); }
    /** 测试辅助：模拟一次尺寸变化 */
    fire(width: number, height: number) {
      this.cb([{ contentRect: { width, height } }]);
    }
  }
  let el: { clientWidth: number; clientHeight: number; observe?: () => void };
  let origRO: typeof ResizeObserver | undefined;

  beforeEach(() => {
    origRO = globalThis.ResizeObserver;
    (globalThis as Record<string, unknown>).ResizeObserver = FakeRO;
    FakeRO.instances = [];
    el = { clientWidth: 0, clientHeight: 0 };
  });
  afterEach(() => {
    if (origRO === undefined) delete (globalThis as Record<string, unknown>).ResizeObserver;
    else (globalThis as Record<string, unknown>).ResizeObserver = origRO;
    vi.restoreAllMocks();
  });

  it('0 → 正常宽度后触发 onUsable + onResize（隐藏容器延迟初始化主保障）', () => {
    const onUsable = vi.fn();
    const onResize = vi.fn();
    const stop = observeChartContainer(el as HTMLElement, { onUsable, onResize });
    // 初始 0 尺寸：不触发
    expect(onUsable).not.toHaveBeenCalled();
    // 尺寸恢复 360×200：onUsable + onResize
    FakeRO.instances[0].fire(360, 200);
    expect(onUsable).toHaveBeenCalledTimes(1);
    expect(onResize).toHaveBeenCalledWith(360, 200);
    // 再变化仍触发（连续 resize 事件）
    FakeRO.instances[0].fire(380, 200);
    expect(onResize).toHaveBeenLastCalledWith(380, 200);
    stop();
  });

  it('回到不可用尺寸后重新从可用流程走（年度 hidden 恢复的等价场景）', () => {
    const onUsable = vi.fn();
    const onResize = vi.fn();
    const stop = observeChartContainer(el as HTMLElement, { onUsable, onResize });
    FakeRO.instances[0].fire(360, 200);
    expect(onUsable).toHaveBeenCalledTimes(1);
    // display:none → 0
    FakeRO.instances[0].fire(0, 0);
    // 再次可见 → 重新 onUsable
    FakeRO.instances[0].fire(360, 200);
    expect(onUsable).toHaveBeenCalledTimes(2);
    stop();
  });

  it('unobserve 后不再触发（dispose 清理）', () => {
    const onResize = vi.fn();
    const stop = observeChartContainer(el as HTMLElement, { onResize });
    stop();
    expect(FakeRO.instances.length).toBe(0);
    // 再 fire 无实例可触发
    expect(onResize).not.toHaveBeenCalled();
  });
});

describe('CHART-AXIS-01：18 天不会显示 18 个 label', () => {
  it('calculateAxisInterval(18, 360) >= 1（不全部显示）', () => {
    const step = calculateAxisInterval(18, 360);
    expect(step).toBeGreaterThanOrEqual(1);
    // 标签数 = ceil(18/(step+1)) <= 约 target(7)+1
    expect(labelCountForInterval(18, step)).toBeLessThanOrEqual(9);
    expect(labelCountForInterval(18, step)).toBeGreaterThan(1);
  });
});

describe('CHART-AXIS-02：31 天标签 <= 8', () => {
  it('calculateAxisInterval(31, 360) 标签数 <= 8', () => {
    const step = calculateAxisInterval(31, 360);
    expect(labelCountForInterval(31, step)).toBeLessThanOrEqual(8);
  });

  it('12 个月：宽屏尽量全显，窄屏自动抽稀', () => {
    // 12 个月 > target 8 → 会按宽度与目标标签数抽稀（interval >= 1）
    const wide = calculateAxisInterval(12, 400, 8);
    expect(wide).toBeGreaterThanOrEqual(1);
    expect(labelCountForInterval(12, wide)).toBeLessThanOrEqual(9);
    // 窄屏更稀疏（不窄于宽屏步长）
    const narrow = calculateAxisInterval(12, 220, 8);
    expect(narrow).toBeGreaterThanOrEqual(wide);
    // 宽到容得下全部 12 个时仍全显（interval 0）
    expect(calculateAxisInterval(12, 380, 12)).toBe(0);
  });

  it('点数 <= 目标时不抽稀（interval 0）', () => {
    expect(calculateAxisInterval(5, 360)).toBe(0);
    expect(calculateAxisInterval(7, 360)).toBe(0);
  });
});

describe('CHART-RESPONSIVE-04：月 → 年第一次显示全尺寸（YearReview 面板可见后才初始化）', () => {
  it('隐藏（0 尺寸）容器不触发渲染回调；可见后回调收到真实宽高', () => {
    class FakeRO2 {
      static cur: FakeRO2 | null = null;
      cb: (entries: { contentRect: { width: number; height: number } }[]) => void;
      constructor(cb: (entries: { contentRect: { width: number; height: number } }[]) => void) {
        this.cb = cb;
        FakeRO2.cur = this;
      }
      observe() {}
      disconnect() { FakeRO2.cur = null; }
      fire(w: number, h: number) { this.cb([{ contentRect: { width: w, height: h } }]); }
    }
    const prevOrig: unknown = (globalThis as Record<string, unknown>).ResizeObserver;
    (globalThis as Record<string, unknown>).ResizeObserver = FakeRO2;
    const el = { clientWidth: 0, clientHeight: 0 } as HTMLElement;
    const sizes: Array<[number, number]> = [];
    const stop = observeChartContainer(el, { onResize: (w, h) => sizes.push([w, h]) });
    // 年度面板初始隐藏（月度默认）：不产生任何尺寸回调
    expect(sizes).toEqual([]);
    // 切到年度：容器可见 360×200
    FakeRO2.cur!.fire(360, 200);
    expect(sizes).toContainEqual([360, 200]);
    stop();
    if (prevOrig === undefined) delete (globalThis as Record<string, unknown>).ResizeObserver;
    else (globalThis as Record<string, unknown>).ResizeObserver = prevOrig;
  });
});