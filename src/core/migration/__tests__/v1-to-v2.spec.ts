import { describe, it, expect, beforeEach } from 'vitest';
import { openDatabase } from '@/core/db/database';
import { runMigrations } from '@/core/migration/manager';
import '@/core/migration/register'; // 副作用：注册真实 v1ToV2Migration
import { CURRENT_DATA_VERSION } from '@/core/migration/types';
import { elapsedDays, dailyValueOf } from '@/core/models/daily-value';
import type { Bill } from '@/core/models/types';
import { V1_KEYS, type V1LedgerEntry, type V1Item } from '@/core/migration/v1-reader';

/**
 * 真实 v1 → v2 迁移测试（覆盖 10 种代表性 v1 场景 + 日期推进 + 失败恢复）。
 * 数据源：v1 localStorage（dv-ledger:v1 / item-value-calculator:v1），
 * 与真实升级流程（安装 v1.20.2 → 写入数据 → 安装 v2.2.0 → 启动迁移）同口径。
 */

const TEST_STORES = ['meta', 'bills', 'categories', 'settings', 'recurringRules'] as const;

async function resetDb(): Promise<void> {
  const db = await openDatabase();
  const tx = db.transaction(TEST_STORES, 'readwrite');
  for (const store of TEST_STORES) tx.objectStore(store).clear();
  await tx.done;
  localStorage.clear();
}

async function allBills(): Promise<Bill[]> {
  const db = await openDatabase();
  return (await db.getAll('bills')) as Bill[];
}
async function metaVersion(): Promise<number | null> {
  const db = await openDatabase();
  const row = await db.get('meta', 'dataVersion');
  return row ? Number((row as { value: unknown }).value) : null;
}
async function v1Backup(): Promise<{ data: Record<string, unknown> } | undefined> {
  const db = await openDatabase();
  const row = await db.get('meta', 'v1-backup');
  return row ? (row as { value: { data: Record<string, unknown> } }).value : undefined;
}
async function migratedDone(): Promise<boolean> {
  const db = await openDatabase();
  return Boolean(await db.get('meta', 'v1-migrated:done'));
}

/** 本地日期 +n 天（yyyy-MM-dd，测试日期推进用） */
function addDays(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, (m || 1) - 1, (d || 1) + n);
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${dt.getFullYear()}-${mm}-${dd}`;
}

/** 代表性 v1 账目：覆盖 10 种场景 */
const V1_LEDGER: V1LedgerEntry[] = [
  // 1. 普通支出（内置分类 餐饮）
  { id: 'b1', type: 'expense', amount: 25, category: '餐饮', emoji: '🍚', note: '午饭', date: '2026-08-01', timestamp: 1787270400000 },
  // 2. 普通收入（内置分类 生活）
  { id: 'b2', type: 'income', amount: 5000, category: '生活', emoji: '🏠', note: '工资', date: '2026-08-05', timestamp: 1787731200000 },
  // 3. transfer out（direction=out → expense，保留 transferDirection）
  { id: 'b3', type: 'transfer', amount: 1000, category: '', note: '转到余额宝', date: '2026-08-10', timestamp: 1788192000000, direction: 'out' },
  // 4. transfer in（direction=in → income，保留 transferDirection）
  { id: 'b4', type: 'transfer', amount: 2000, category: '', note: '转回银行卡', date: '2026-08-11', timestamp: 1788278400000, direction: 'in' },
  // 6. 自定义分类（数码，缺失 emoji → 📦）
  { id: 'b5', type: 'expense', amount: 399, category: '数码', note: '耳机', date: '2026-08-15', timestamp: 1788739200000 },
  // 8. 不同月份账单（内置分类 交通，2026-07）
  { id: 'b6', type: 'expense', amount: 50, category: '交通', emoji: '🚗', note: '地铁', date: '2026-07-20', timestamp: 1786060800000 },
  // 10. 重复风险场景：电脑同时存在于账单（normal）
  { id: 'b7', type: 'expense', amount: 10000, category: '数码', note: '电脑', date: '2026-01-01', timestamp: 1767225600000 },
  // 空分类 → 未分类📦（自定义）
  { id: 'b8', type: 'expense', amount: 9.9, note: '无分类', date: '2026-08-18', timestamp: 1788998400000 },
];

/** 代表性 v1 日价物品 */
const V1_ITEMS: V1Item[] = [
  // 9. 独立日价物品
  { id: 'i1', name: '显示器', price: 2000, purchaseDate: '2026-03-15', note: '27寸', createdAt: 1773600000000 },
  // 10. 重复风险场景：电脑同时存在于日价（daily-value-only）
  { id: 'i2', name: '电脑', price: 10000, purchaseDate: '2026-01-01', note: '办公本', createdAt: 1767225600000 },
];

function seedV1() {
  localStorage.setItem(V1_KEYS.ledger, JSON.stringify(V1_LEDGER));
  localStorage.setItem(V1_KEYS.items, JSON.stringify(V1_ITEMS));
}

describe('真实 v1 → v2 迁移（代表性数据）', () => {
  beforeEach(resetDb);

  it('完整迁移：数量/金额/分类/字段全量校验 + backup + dataVersion', async () => {
    seedV1();
    const result = await runMigrations();

    // 迁移成功 + 已备份
    expect(result.ok).toBe(true);
    expect(result.backedUp).toBe(true);
    expect(result.counts?.every((c) => c.pass)).toBe(true);
    expect(result.contents?.every((c) => c.pass)).toBe(true);

    // 数量：v1 账单 8 → v2 normal 8；日价物品 2 → daily-value-only 2
    const bills = await allBills();
    const normal = bills.filter((b) => b.ledgerImpact !== 'daily-value-only');
    const daily = bills.filter((b) => b.ledgerImpact === 'daily-value-only');
    expect(bills.length).toBe(10);
    expect(normal.length).toBe(8);
    expect(daily.length).toBe(2);

    // 金额：月支出 / 月收入（normal 口径，不含日价）
    const aug = normal.filter((b) => b.date.startsWith('2026-08'));
    const augExpense = aug.filter((b) => b.type === 'expense').reduce((s, b) => s + b.amount, 0);
    const augIncome = aug.filter((b) => b.type === 'income').reduce((s, b) => s + b.amount, 0);
    // 2026-08 支出：25(午饭) + 1000(transfer out) + 399(耳机) + 9.9(无分类) = 1433.9
    expect(augExpense).toBeCloseTo(1433.9, 2);
    // 2026-08 收入：5000(工资) + 2000(transfer in) = 7000
    expect(augIncome).toBe(7000);
    // 2026-07 支出：50（地铁）
    const julExpense = normal
      .filter((b) => b.date.startsWith('2026-07') && b.type === 'expense')
      .reduce((s, b) => s + b.amount, 0);
    expect(julExpense).toBe(50);

    // transfer 统计：2 条均保留 transferDirection（out→expense / in→income）
    const transfers = normal.filter((b) => b.transferDirection);
    expect(transfers.length).toBe(2);
    const tOut = transfers.find((b) => b.id === 'b3');
    const tIn = transfers.find((b) => b.id === 'b4');
    expect(tOut?.type).toBe('expense');
    expect(tOut?.transferDirection).toBe('out');
    expect(tIn?.type).toBe('income');
    expect(tIn?.transferDirection).toBe('in');

    // 字段映射：id / category / emoji / note / date / timestamp / source=import
    const lunch = normal.find((b) => b.id === 'b1');
    expect(lunch?.amount).toBe(25);
    expect(lunch?.categoryName).toBe('餐饮');
    expect(lunch?.categoryEmoji).toBe('🍚');
    expect(lunch?.note).toBe('午饭');
    expect(lunch?.date).toBe('2026-08-01');
    expect(lunch?.timestamp).toBe(1787270400000);
    expect(lunch?.source).toBe('import');
    expect(lunch?.ledgerImpact).toBe('normal');

    // 自定义分类：数码（缺失 emoji → 📦）+ 未分类📦；内置分类使用固定 id
    const customCategories = normal.map((b) => b.categoryName);
    expect(customCategories).toContain('数码');
    expect(customCategories).toContain('未分类');
    const digital = normal.find((b) => b.categoryName === '数码');
    expect(digital?.categoryEmoji).toBe('📦');
    // 稳定 ID 按首次出现顺序分配：b3/b4 空分类 → 未分类=mig-cat-1，数码=mig-cat-2
    expect(digital?.categoryId).toBe('mig-cat-2');
    const uncat = normal.find((b) => b.categoryName === '未分类');
    expect(uncat?.categoryId).toBe('mig-cat-1');
    expect(uncat?.categoryEmoji).toBe('📦');
    const transport = normal.find((b) => b.categoryName === '交通');
    expect(transport?.categoryId).toBe('c-transport');
    expect(lunch?.categoryId).toBe('c-food');

    // 日价：数量 / 金额 / startDate = purchaseDate / ledgerImpact=daily-value-only
    const monitor = daily.find((b) => b.id === 'dv-i1');
    expect(monitor?.amount).toBe(2000);
    expect(monitor?.dailyValue?.enabled).toBe(true);
    expect(monitor?.dailyValue?.startDate).toBe('2026-03-15');
    // 名称语义（Phase 3 前置修正 F）：物品名存入 title，categoryName 只存真实分类名
    expect(monitor?.categoryName).toBe('日价物品');
    expect(monitor?.title).toBe('显示器');
    expect(monitor?.note).toBe('27寸');
    expect(monitor?.timestamp).toBe(1773600000000);
    // 日价不固化摊销天数
    expect('durationDays' in (monitor?.dailyValue ?? {})).toBe(false);
    expect('elapsedDays' in (monitor?.dailyValue ?? {})).toBe(false);

    // 日价不污染账单统计：重复场景（电脑 10000）只进入日价，不重复进入 normal
    const pcNormal = normal.find((b) => b.categoryName === '数码' && b.note === '电脑');
    const pcDaily = daily.find((b) => b.title === '电脑');
    expect(pcNormal?.amount).toBe(10000); // 原有账单保留
    expect(pcDaily?.amount).toBe(10000); // 日价单独记录
    // normal 中 8 条不含日价物品；若污染会变成 9+（或金额翻倍）
    expect(normal.length).toBe(8);

    // v1 localStorage 仍然存在（不删除）
    expect(localStorage.getItem(V1_KEYS.ledger)).toBeTruthy();
    expect(localStorage.getItem(V1_KEYS.items)).toBeTruthy();

    // backup 存在 + dataVersion 正确 + migrated 标记
    const backup = await v1Backup();
    expect(backup?.data[V1_KEYS.ledger]).toBeDefined();
    expect(backup?.data[V1_KEYS.items]).toBeDefined();
    expect(await metaVersion()).toBe(CURRENT_DATA_VERSION);
    expect(await migratedDone()).toBe(true);
  });

  it('迁移完成后二次启动不重复迁移（幂等）', async () => {
    seedV1();
    const first = await runMigrations();
    expect(first.ok).toBe(true);
    const second = await runMigrations();
    expect(second.ok).toBe(true);
    expect(second.done).toBe(true);
    expect(second.message).toContain('已是最新数据版本');
    expect((await allBills()).length).toBe(10); // 未重复写入
  });

  it('全新安装（无 v1 数据）→ 不写备份、直接初始化', async () => {
    const result = await runMigrations();
    expect(result.ok).toBe(true);
    expect(result.backedUp).toBe(false);
    expect(await metaVersion()).toBe(CURRENT_DATA_VERSION);
  });
});

describe('日价日期推进动态计算（elapsed 模型）', () => {
  const base: Bill = {
    id: 'dv-pc',
    type: 'expense',
    amount: 10000,
    categoryId: 'c-daily-value',
    categoryEmoji: '💎',
    categoryName: '日价物品',
    title: '电脑',
    note: '',
    date: '2026-01-01',
    timestamp: 1767225600000,
    source: 'import',
    ledgerImpact: 'daily-value-only',
    dailyValue: { enabled: true, mode: 'elapsed', startDate: '2026-01-01' },
  };

  it('第 100 天 → dailyValue = 100；第 101 天 → ≈99.01（每天动态变化，非固化）', () => {
    // 口径（Phase 3 前置修正 A）：elapsedDays = max(1, 相差完整日历天数)，
    // 相差 100 个日历日 → 100（v1 daysSince 语义），不是 diff+1 的 101。
    const day100 = addDays('2026-01-01', 100); // 相差 100 个日历日 → elapsedDays = 100
    const day101 = addDays('2026-01-01', 101); // 相差 101 个日历日 → elapsedDays = 101
    expect(elapsedDays('2026-01-01', day100)).toBe(100);
    expect(elapsedDays('2026-01-01', day101)).toBe(101);
    expect(dailyValueOf(base, day100)).toBe(100);
    expect(dailyValueOf(base, day101)).toBeCloseTo(99.0099, 2);
  });

  it('与 v1 daysSince 口径一致（off-by-one 修正）：购买 1/1、今天 1/2 → 1 天（非 2 天）', () => {
    expect(elapsedDays('2026-01-01', '2026-01-02')).toBe(1);
    expect(dailyValueOf(base, '2026-01-02')).toBe(10000);
  });

  it('同一天始终为 1、昨天始终为 1（与 v1 diff<1 → 1 语义一致）', () => {
    expect(elapsedDays('2026-01-01', '2026-01-01')).toBe(1);
    expect(elapsedDays('2026-01-10', '2026-01-11')).toBe(1);
    expect(dailyValueOf(base, '2026-01-01')).toBe(10000);
  });

  it('中国时区 + 跨月边界正确', () => {
    // 2026-01-31 → 2026-02-01：相差 1 个日历日
    expect(elapsedDays('2026-01-31', '2026-02-01')).toBe(1);
    // 2026-01-31 → 2026-03-01：1 月剩余 1 天 + 2 月 28 天 = 29
    expect(elapsedDays('2026-01-31', '2026-03-01')).toBe(29);
  });

  it('欧洲 DST 切换日前后正确（UTC 日期编号，不受 23/25 小时本地午夜影响）', () => {
    // 2026 欧洲夏令时开始：3 月最后一个周日 = 2026-03-29；结束：10 月最后一个周日 = 2026-10-25
    expect(elapsedDays('2026-03-27', '2026-03-30')).toBe(3);
    expect(elapsedDays('2026-03-29', '2026-04-05')).toBe(7);
    expect(elapsedDays('2026-10-23', '2026-10-26')).toBe(3);
    expect(elapsedDays('2026-10-25', '2026-11-01')).toBe(7);
  });

  it('本地日期避免 UTC 跨天偏差（本地 08-22 不等于 UTC 08-21）', () => {
    // 使用本地业务日期字符串计算，不依赖 toISOString
    const day = elapsedDays('2026-01-01', '2026-08-22');
    expect(day).toBeGreaterThanOrEqual(1);
    expect(Number.isInteger(day)).toBe(true);
  });
});

describe('v1 日价物品缺失 id 兼容（稳定 fallback ID，Phase 3 前置修正 C）', () => {
  beforeEach(resetDb);

  it('多个无 id 物品 → 全部保留 + id 唯一 + 实际 IndexedDB 写入数量正确', async () => {
    localStorage.setItem(
      V1_KEYS.items,
      JSON.stringify([
        { name: '耳机', price: 299, purchaseDate: '2026-05-01' },
        { name: '键盘', price: 500, purchaseDate: '2026-05-10' },
        { name: '鼠标', price: 99, purchaseDate: '2026-06-01' },
      ]),
    );
    const result = await runMigrations();
    expect(result.ok).toBe(true);
    // 数量校验（含 IndexedDB 实际写入后验证）全部通过
    expect(result.counts?.every((c) => c.pass)).toBe(true);

    const daily = (await allBills()).filter((b) => b.ledgerImpact === 'daily-value-only');
    expect(daily.length).toBe(3); // 全部保留
    const ids = daily.map((b) => b.id);
    expect(new Set(ids).size).toBe(3); // id 唯一（不互相覆盖）
    expect(ids.some((id) => id.includes('undefined'))).toBe(false); // 无 dv-undefined
    expect(daily.map((b) => b.title).sort()).toEqual(['耳机', '键盘', '鼠标'].sort());
  });

  it('重试迁移幂等：无 id 物品生成相同确定性 id', async () => {
    const v1Items = JSON.stringify([
      { name: '耳机', price: 299, purchaseDate: '2026-05-01' },
      { name: '键盘', price: 500, purchaseDate: '2026-05-10' },
    ]);
    localStorage.setItem(V1_KEYS.items, v1Items);
    await runMigrations();
    const first = (await allBills())
      .filter((b) => b.ledgerImpact === 'daily-value-only')
      .map((b) => b.id)
      .sort();

    // 模拟"重试迁移"：清空 v2 存储（含 dataVersion）后重新执行同一份 v1 数据
    await resetDb();
    localStorage.setItem(V1_KEYS.items, v1Items);
    await runMigrations();
    const second = (await allBills())
      .filter((b) => b.ledgerImpact === 'daily-value-only')
      .map((b) => b.id)
      .sort();

    expect(second).toEqual(first); // 幂等
  });

  it('有 id 与无 id 混合：有 id 保持 dv-<v1id>，无 id 走 fallback', async () => {
    localStorage.setItem(
      V1_KEYS.items,
      JSON.stringify([
        { id: 'i1', name: '显示器', price: 2000, purchaseDate: '2026-03-15' },
        { name: '耳机', price: 299, purchaseDate: '2026-05-01' },
      ]),
    );
    await runMigrations();
    const daily = (await allBills()).filter((b) => b.ledgerImpact === 'daily-value-only');
    const withId = daily.find((b) => b.id === 'dv-i1');
    expect(withId?.title).toBe('显示器');
    const withoutId = daily.find((b) => b.id !== 'dv-i1');
    expect(withoutId).toBeDefined();
    expect(withoutId?.title).toBe('耳机');
    expect(new Set(daily.map((b) => b.id)).size).toBe(2);
  });
});

describe('v1 JSON 解析失败 → 安全模式（Phase 3 前置修正 D）', () => {
  beforeEach(resetDb);

  it('dv-ledger:v1 存在但 JSON 损坏 → ok=false、不更新 dataVersion、不写 migrated', async () => {
    localStorage.setItem(V1_KEYS.ledger, '{broken json');
    const result = await runMigrations();
    expect(result.ok).toBe(false);
    expect(result.message).toContain('JSON 解析失败');
    expect(await metaVersion()).toBeNull(); // 未更新 dataVersion
    expect(await migratedDone()).toBe(false); // 未写 migrated
    expect(localStorage.getItem(V1_KEYS.ledger)).toBe('{broken json'); // 原始字符串保留
  });

  it('item-value-calculator:v1 存在但 JSON 损坏 → 同样进入安全模式', async () => {
    localStorage.setItem(V1_KEYS.items, 'not-json{{');
    const result = await runMigrations();
    expect(result.ok).toBe(false);
    expect(await metaVersion()).toBeNull();
  });

  it('backup 中保留损坏数据的原始字符串', async () => {
    localStorage.setItem(V1_KEYS.ledger, '{broken json');
    await runMigrations();
    const backup = await v1Backup();
    expect(backup?.data[V1_KEYS.ledger]).toBe('{broken json');
  });
});
