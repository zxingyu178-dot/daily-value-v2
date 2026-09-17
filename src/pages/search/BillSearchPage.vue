<script setup lang="ts">
/**
 * DailyValue v2.19.0 - 账单搜索（Bill Explorer）
 * - 记账首页右上角 🔍 进入；统计页面钻取经 route.query 预置条件。
 * - 搜索基于 billStore.normalBills 内存过滤（computed + 150ms debounce），
 *   不逐字查询 IndexedDB，千级~万级数据无卡顿。
 * - 结果复用记账页账单视觉语言（按日期倒序分组）；点击结果直接打开 QuickEntrySheet 编辑，
 *   保存后 store reload → 结果与统计即时刷新（SEARCH-11/12）。
 * - 不强制自动弹键盘：进入页面自动聚焦输入框但由用户点击后再唤起（避免首页弹键盘打断）。
 */
defineOptions({ name: 'BillSearchPage' });
import { computed, onDeactivated, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { DVSheet, DVDateTimeWheelPicker } from '@/components/design';
import type { DateTimeValue } from '@/components/design/DVDateTimeWheelPicker.vue';
import { useBillStore } from '@/core/store/bill';
import { useCategoryStore } from '@/core/store/category';
import type { Bill, BillType } from '@/core/models/types';
import { groupSearchResults, searchBills } from '@/core/search/bill-search';
import DVCategoryIcon from '@/components/category/DVCategoryIcon.vue';
import QuickEntrySheet from '@/pages/accounting/QuickEntrySheet.vue';

const route = useRoute();
const router = useRouter();
const billStore = useBillStore();
const categoryStore = useCategoryStore();

/* ---- 筛选状态 ---- */
const keyword = ref('');
const typeFilter = ref<BillType | 'all'>('all');
const categoryFilter = ref<string>('all');
interface TimeFilter {
  kind: 'all' | 'year' | 'month' | 'range';
  year?: number;
  ym?: string;
  start?: string;
  end?: string;
}
const timeFilter = ref<TimeFilter>({ kind: 'all' });
const timeSheetOpen = ref(false);
const categorySheetOpen = ref(false);

/* ---- 时间 Sheet 选项（全部时间/今年/去年/有账月份/自定义区间） ---- */
const curYear = new Date().getFullYear();
const monthOptions = computed(() => {
  const set = new Set<string>();
  for (const b of billStore.normalBills) set.add(b.date.slice(0, 7));
  return [...set].sort((a, b) => (a < b ? 1 : -1));
});
function timeLabel(t: TimeFilter): string {
  switch (t.kind) {
    case 'year': return `${t.year} 年`;
    case 'month': return t.ym!.replace('-', ' 年 ') + ' 月';
    case 'range': return `${t.start} 至 ${t.end}`;
    default: return '全部时间';
  }
}
/** 分类选择显示值：全部分类 / 分类名 */
const categoryFilterLabel = computed(() =>
  categoryFilter.value === 'all'
    ? '分类'
    : (categoryStore.byId(categoryFilter.value)?.name ?? '分类'),
);

/* ---- 自定义区间（range）：两个 wheel picker 复用 ---- */
type RangeTarget = 'start' | 'end' | null;
const rangeTarget = ref<RangeTarget>(null);
const rangeWheelValue = ref<DateTimeValue>({ year: curYear, month: 1, day: 1, hour: 0, minute: 0 });
function openRangePicker(target: 'start' | 'end') {
  const base = target === 'start' ? timeFilter.value.start : timeFilter.value.end;
  if (base) {
    const [y, m, d] = base.split('-').map(Number);
    rangeWheelValue.value = { year: y, month: m, day: d, hour: 0, minute: 0 };
  }
  rangeTarget.value = target;
}
function onRangeWheelChange(v: DateTimeValue) {
  const date = `${v.year}-${String(v.month).padStart(2, '0')}-${String(v.day).padStart(2, '0')}`;
  if (rangeTarget.value === 'start') timeFilter.value = { kind: 'range', start: date, end: timeFilter.value.end };
  else if (rangeTarget.value === 'end') timeFilter.value = { kind: 'range', start: timeFilter.value.start, end: date };
}

/* ---- route.query 预置（统计钻取进入） ---- */
function initFromQuery() {
  const q = route.query.q;
  if (typeof q === 'string') keyword.value = q;
  const y = route.query.year;
  const m = route.query.month;
  if (typeof m === 'string' && /^\d{4}-\d{2}$/.test(m)) {
    timeFilter.value = { kind: 'month', ym: m, year: Number(m.slice(0, 4)) };
  } else if (typeof y === 'string' && /^\d{4}$/.test(y)) {
    timeFilter.value = { kind: 'year', year: Number(y) };
  }
  const c = route.query.category;
  if (typeof c === 'string' && c) categoryFilter.value = c;
  const t = route.query.type;
  if (t === 'expense' || t === 'income') typeFilter.value = t;
}
onMounted(initFromQuery);

/* ---- 关键词 debounce（150ms） ---- */
const debouncedKey = ref('');
let keyTimer: ReturnType<typeof setTimeout> | null = null;
watch(keyword, (v) => {
  if (keyTimer) clearTimeout(keyTimer);
  keyTimer = setTimeout(() => (debouncedKey.value = v.trim()), 150);
});

/* ---- 搜索结果（基于内存 bills 过滤） ---- */
function toFilters() {
  const f: Parameters<typeof searchBills>[1] = { q: debouncedKey.value, type: typeFilter.value, categoryId: categoryFilter.value };
  const t = timeFilter.value;
  if (t.kind === 'year') f.year = t.year;
  else if (t.kind === 'month') f.month = t.ym;
  else if (t.kind === 'range') {
    if (t.start) f.dateFrom = t.start;
    if (t.end) f.dateTo = t.end;
  }
  return f;
}
const results = computed(() => searchBills(billStore.normalBills, toFilters()));
const groups = computed(() => groupSearchResults(results.value));
const hasActiveFilter = computed(
  () =>
    debouncedKey.value !== '' ||
    typeFilter.value !== 'all' ||
    timeFilter.value.kind !== 'all' ||
    categoryFilter.value !== 'all',
);
/** 最近账单（无输入时引导展示，5~8 条） */
const recentBills = computed(() => results.value.slice(0, 8));

function fmt(n: number): string {
  return n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
/** 「9月12日 周六」 */
function dayMeta(date: string) {
  const [y, m, d] = date.split('-').map(Number);
  const week = ['日', '一', '二', '三', '四', '五', '六'][new Date(y, m - 1, d).getDay()];
  return { m, d, week };
}
function billName(b: Bill): string {
  return b.title || b.categoryName;
}
function categoryOf(bill: Bill) {
  return (
    categoryStore.byId(bill.categoryId) ?? {
      id: bill.categoryId,
      name: bill.categoryName,
      emoji: bill.categoryEmoji,
      builtin: false,
      sort: 0,
    }
  );
}

/* ---- 点击结果 → 编辑（QuickEntrySheet 编辑模式） ---- */
const sheetOpen = ref(false);
const editingBill = ref<Bill | null>(null);
function openEdit(bill: Bill) {
  editingBill.value = bill;
  sheetOpen.value = true;
}
async function onSaved() {
  await billStore.load(true); // 结果/统计/记账时间线即时刷新
  sheetOpen.value = false;
  editingBill.value = null;
  // 刷新后若当前筛选仍有结果，无需额外处理（computed 自动重算）
}

function goBack() {
  if (window.history.length > 1) router.back();
  else router.replace('/accounting');
}
onDeactivated(() => {
  sheetOpen.value = false;
  editingBill.value = null;
  timeSheetOpen.value = false;
  categorySheetOpen.value = false;
  rangeTarget.value = null;
});
</script>

<template>
  <section class="bill-search">
    <!-- 顶栏：返回 + 标题 -->
    <header class="bill-search__head">
      <button class="bill-search__back" type="button" aria-label="返回" @click="goBack">‹</button>
      <span class="bill-search__title">搜索账单</span>
      <span class="bill-search__head-spacer" aria-hidden="true"></span>
    </header>

    <!-- 主搜索框（自动聚焦，点击输入后弹键盘） -->
    <div class="bill-search__box">
      <span class="bill-search__box-icon" aria-hidden="true">🔍</span>
      <input
        v-model="keyword"
        class="bill-search__input"
        type="search"
        enterkeyhint="search"
        placeholder="搜索商户、备注、分类……"
        aria-label="搜索商户、备注、分类或金额"
      />
      <button
        v-if="keyword"
        class="bill-search__clear"
        type="button"
        aria-label="清空"
        @click="keyword = ''"
      >
        ×
      </button>
    </div>

    <!-- Filter Chips：类型 / 时间 / 分类 -->
    <div class="bill-search__chips">
      <div class="bill-search__chip-row">
        <button
          v-for="opt in (['all', 'expense', 'income'] as const)"
          :key="opt"
          class="bill-search__chip"
          :class="{ 'is-active': typeFilter === opt }"
          type="button"
          @click="typeFilter = opt"
        >
          {{ opt === 'all' ? '全部' : opt === 'expense' ? '支出' : '收入' }}
        </button>
      </div>
      <div class="bill-search__chip-row">
        <button
          class="bill-search__chip"
          :class="{ 'is-active': timeFilter.kind !== 'all' }"
          type="button"
          @click="timeSheetOpen = true"
        >
          {{ timeLabel(timeFilter) }}
        </button>
        <button
          class="bill-search__chip"
          :class="{ 'is-active': categoryFilter !== 'all' }"
          type="button"
          @click="categorySheetOpen = true"
        >
          {{ categoryFilterLabel }}
        </button>
      </div>
    </div>

    <!-- 结果区 -->
    <div class="bill-search__body">
      <!-- 无输入 + 无筛选：产品化空状态 + 最近账单 -->
      <template v-if="!hasActiveFilter">
        <div class="bill-search__hero">
          <p class="bill-search__hero-title">找回过去的每一笔</p>
          <p class="bill-search__hero-sub">可以搜索商户、备注、分类或金额</p>
        </div>
        <div v-if="recentBills.length" class="bill-search__recent">
          <p class="bill-search__recent-label">最近账单</p>
          <ul class="bill-search__list">
            <li
              v-for="bill in recentBills"
              :key="bill.id"
              class="bill-search__item"
              role="button"
              tabindex="0"
              @click="openEdit(bill)"
              @keydown.enter="openEdit(bill)"
            >
              <span class="bill-search__item-emoji">
                <DVCategoryIcon :category="categoryOf(bill)" :size="22" />
              </span>
              <div class="bill-search__item-main">
                <span class="bill-search__item-name">{{ billName(bill) }}</span>
                <span class="bill-search__item-date">
                  {{ bill.date.slice(5, 7) }}月{{ dayMeta(bill.date).d }}日
                  <template v-if="bill.note">· {{ bill.note }}</template>
                </span>
              </div>
              <span
                class="bill-search__item-amount"
                :class="bill.type === 'expense' ? 'is-expense' : 'is-income'"
              >
                {{ bill.type === 'expense' ? '-' : '+' }}{{ fmt(bill.amount) }}
              </span>
            </li>
          </ul>
        </div>
      </template>

      <!-- 有筛选但无结果 -->
      <div v-else-if="results.length === 0" class="bill-search__none">
        <p class="bill-search__none-title">没有找到「{{ debouncedKey || '相关账单' }}」</p>
        <p class="bill-search__none-sub">换个关键词，或调整时间范围</p>
      </div>

      <!-- 结果（按日期倒序分组，复用账单视觉） -->
      <section v-else class="bill-search__result">
        <template v-for="group in groups" :key="group.date">
          <header class="bill-search__day">
            <span class="bill-search__day-date">
              {{ group.date.slice(5, 7) }}月{{ dayMeta(group.date).d }}日
              <em class="bill-search__day-week">周{{ dayMeta(group.date).week }}</em>
            </span>
          </header>
          <ul class="bill-search__list">
            <li
              v-for="bill in group.bills"
              :key="bill.id"
              class="bill-search__item"
              role="button"
              tabindex="0"
              @click="openEdit(bill)"
              @keydown.enter="openEdit(bill)"
            >
              <span class="bill-search__item-emoji">
                <DVCategoryIcon :category="categoryOf(bill)" :size="22" />
              </span>
              <div class="bill-search__item-main">
                <span class="bill-search__item-name">
                  {{ billName(bill) }}
                  <template v-if="bill.source === 'recurring'">
                    <em class="bill-search__item-source">周期</em>
                  </template>
                  <template v-else-if="bill.source === 'notification'">
                    <em class="bill-search__item-source">自动</em>
                  </template>
                </span>
                <span v-if="bill.note" class="bill-search__item-note">{{ bill.note }}</span>
              </div>
              <span
                class="bill-search__item-amount"
                :class="bill.type === 'expense' ? 'is-expense' : 'is-income'"
              >
                {{ bill.type === 'expense' ? '-' : '+' }}{{ fmt(bill.amount) }}
              </span>
            </li>
          </ul>
        </template>
      </section>
    </div>

    <!-- 时间 Sheet：全部时间 / 今年 / 去年 / 有账月份 / 自定义区间 -->
    <DVSheet v-model="timeSheetOpen" title="选择时间">
      <div class="bill-search__sheet-list">
        <button
          class="bill-search__sheet-opt"
          :class="{ 'is-active': timeFilter.kind === 'all' }"
          type="button"
          @click="timeFilter = { kind: 'all' }; timeSheetOpen = false"
        >
          全部时间
        </button>
        <button
          class="bill-search__sheet-opt"
          :class="{ 'is-active': timeFilter.kind === 'year' && timeFilter.year === curYear }"
          type="button"
          @click="timeFilter = { kind: 'year', year: curYear }; timeSheetOpen = false"
        >
          今年（{{ curYear }}）
        </button>
        <button
          class="bill-search__sheet-opt"
          :class="{ 'is-active': timeFilter.kind === 'year' && timeFilter.year === curYear - 1 }"
          type="button"
          @click="timeFilter = { kind: 'year', year: curYear - 1 }; timeSheetOpen = false"
        >
          去年（{{ curYear - 1 }}）
        </button>
        <button
          v-for="ym in monthOptions"
          :key="ym"
          class="bill-search__sheet-opt"
          :class="{ 'is-active': timeFilter.kind === 'month' && timeFilter.ym === ym }"
          type="button"
          @click="timeFilter = { kind: 'month', ym, year: Number(ym.slice(0, 4)) }; timeSheetOpen = false"
        >
          {{ ym.slice(0, 4) }} 年 {{ Number(ym.slice(5)) }} 月
        </button>
        <button
          class="bill-search__sheet-opt"
          :class="{ 'is-active': timeFilter.kind === 'range' }"
          type="button"
          @click="timeSheetOpen = false; openRangePicker('start')"
        >
          自定义区间
        </button>
      </div>
    </DVSheet>

    <!-- 分类 Sheet：全部分类 + 现有分类系统 -->
    <DVSheet v-model="categorySheetOpen" title="选择分类">
      <div class="bill-search__sheet-list">
        <button
          class="bill-search__sheet-opt"
          :class="{ 'is-active': categoryFilter === 'all' }"
          type="button"
          @click="categoryFilter = 'all'; categorySheetOpen = false"
        >
          <span class="bill-search__sheet-cat">
            <span class="bill-search__sheet-cat-icon">⊹</span>
            全部分类
          </span>
        </button>
        <button
          v-for="cat in categoryStore.categories"
          :key="cat.id"
          class="bill-search__sheet-opt"
          :class="{ 'is-active': categoryFilter === cat.id }"
          type="button"
          @click="categoryFilter = cat.id; categorySheetOpen = false"
        >
          <span class="bill-search__sheet-cat">
            <span class="bill-search__sheet-cat-icon">
              <DVCategoryIcon :category="cat" :size="20" />
            </span>
            {{ cat.name }}
          </span>
        </button>
      </div>
    </DVSheet>

    <!-- 自定义区间：两个 wheel picker 复用 -->
    <DVDateTimeWheelPicker
      :model-value="rangeWheelValue"
      :visible="rangeTarget !== null"
      :show-time="false"
      :allow-future="false"
      @update:model-value="onRangeWheelChange"
      @close="rangeTarget = null"
    />

    <!-- 点击结果 → QuickEntrySheet 编辑模式（保存后结果/统计即时刷新） -->
    <QuickEntrySheet
      :model-value="sheetOpen"
      :editing-bill="editingBill"
      @update:model-value="(v: boolean) => (sheetOpen = v)"
      @saved="onSaved"
    />
  </section>
</template>

<style scoped>
.bill-search {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: var(--dv-space-md);
  padding-bottom: calc(var(--dv-space-xl) + var(--dv-safe-bottom));
}
.bill-search__head {
  display: flex;
  align-items: center;
  gap: var(--dv-space-xs);
  margin-bottom: var(--dv-space-sm);
}
.bill-search__back {
  width: 36px;
  height: 36px;
  border-radius: var(--dv-radius-pill);
  background: var(--dv-surface);
  border: 1px solid var(--dv-outline);
  color: var(--dv-on-surface);
  font-size: 22px;
  line-height: 1;
}
.bill-search__title {
  flex: 1;
  text-align: center;
  font-size: 17px;
  font-weight: 600;
  color: var(--dv-on-surface);
}
.bill-search__head-spacer {
  width: 36px;
}
.bill-search__box {
  position: relative;
  display: flex;
  align-items: center;
  gap: var(--dv-space-xs);
  padding: 0 var(--dv-space-sm);
  border-radius: var(--dv-radius-lg);
  background: var(--dv-surface);
  border: 1px solid var(--dv-outline);
  margin-bottom: var(--dv-space-sm);
}
.bill-search__box-icon {
  font-size: 15px;
  opacity: 0.7;
}
.bill-search__input {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  font-size: 15px;
  color: var(--dv-on-surface);
  padding: 10px 0;
  caret-color: var(--dv-primary);
}
.bill-search__input::placeholder {
  color: var(--dv-on-surface-variant);
}
.bill-search__clear {
  width: 24px;
  height: 24px;
  border-radius: var(--dv-radius-pill);
  background: var(--dv-surface-alt);
  color: var(--dv-on-surface-variant);
  font-size: 15px;
  line-height: 1;
}
.bill-search__chips {
  display: flex;
  flex-direction: column;
  gap: var(--dv-space-xxs);
  margin-bottom: var(--dv-space-sm);
}
.bill-search__chip-row {
  display: flex;
  gap: var(--dv-space-xxs);
}
.bill-search__chip {
  padding: 5px 12px;
  border-radius: var(--dv-radius-pill);
  background: var(--dv-surface);
  border: 1px solid var(--dv-outline);
  font-size: 13px;
  color: var(--dv-on-surface-variant);
  transition: background-color var(--dv-motion-fast) var(--dv-ease-standard);
}
.bill-search__chip.is-active {
  background: color-mix(in srgb, var(--dv-primary) 14%, var(--dv-surface));
  border-color: var(--dv-primary);
  color: var(--dv-primary);
  font-weight: 600;
}
.bill-search__body {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
}
.bill-search__hero {
  padding: var(--dv-space-xl) 0 var(--dv-space-md);
  text-align: center;
}
.bill-search__hero-title {
  font-size: 17px;
  font-weight: 600;
  color: var(--dv-on-surface);
}
.bill-search__hero-sub {
  margin-top: var(--dv-space-xxs);
  font-size: 13px;
  color: var(--dv-on-surface-variant);
}
.bill-search__recent-label {
  font-size: 12px;
  color: var(--dv-on-surface-variant);
  margin: var(--dv-space-xs) 0 var(--dv-space-xxs);
}
.bill-search__none {
  padding: var(--dv-space-xl) 0;
  text-align: center;
}
.bill-search__none-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--dv-on-surface);
}
.bill-search__none-sub {
  margin-top: var(--dv-space-xxs);
  font-size: 13px;
  color: var(--dv-on-surface-variant);
}
.bill-search__day {
  margin: var(--dv-space-xs) 0 var(--dv-space-xxs);
}
.bill-search__day-date {
  font-size: 13px;
  font-weight: 600;
  color: var(--dv-on-surface);
}
.bill-search__day-week {
  font-style: normal;
  font-weight: 400;
  color: var(--dv-on-surface-variant);
  margin-left: 4px;
}
.bill-search__list {
  list-style: none;
  display: flex;
  flex-direction: column;
  background: var(--dv-surface);
  border-radius: var(--dv-radius-lg);
  border: 1px solid var(--dv-surface-border);
  overflow: hidden;
}
.bill-search__item {
  display: flex;
  align-items: center;
  gap: var(--dv-space-sm);
  padding: 11px var(--dv-space-md);
  border-bottom: 1px solid var(--dv-surface-border);
  cursor: pointer;
}
.bill-search__item:last-child {
  border-bottom: none;
}
.bill-search__item:active {
  background: var(--dv-surface-alt);
  transition: background-color var(--dv-motion-fast) var(--dv-ease-standard);
}
.bill-search__item-emoji {
  flex-shrink: 0;
  width: 34px;
  height: 34px;
  border-radius: var(--dv-radius-md);
  background: var(--dv-surface-alt);
  display: flex;
  align-items: center;
  justify-content: center;
}
.bill-search__item-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.bill-search__item-name {
  font-size: 14px;
  font-weight: 500;
  color: var(--dv-on-surface);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.bill-search__item-source {
  font-style: normal;
  font-size: 10px;
  color: var(--dv-on-surface-variant);
  border: 1px solid var(--dv-outline);
  border-radius: var(--dv-radius-pill);
  padding: 0 4px;
  margin-left: 4px;
}
.bill-search__item-note {
  font-size: 12px;
  color: var(--dv-on-surface-variant);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.bill-search__item-date {
  font-size: 12px;
  color: var(--dv-on-surface-variant);
}
.bill-search__item-amount {
  flex-shrink: 0;
  font-size: 15px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.bill-search__item-amount.is-expense {
  color: var(--dv-expense);
}
.bill-search__item-amount.is-income {
  color: var(--dv-income);
}
.bill-search__sheet-list {
  display: flex;
  flex-direction: column;
  max-height: 55vh;
  overflow-y: auto;
}
.bill-search__sheet-opt {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 13px var(--dv-space-md);
  border-radius: var(--dv-radius-md);
  font-size: 14px;
  color: var(--dv-on-surface);
  text-align: left;
}
.bill-search__sheet-opt.is-active {
  color: var(--dv-primary);
  font-weight: 600;
}
.bill-search__sheet-opt:active {
  background: var(--dv-surface-alt);
}
.bill-search__sheet-cat {
  display: inline-flex;
  align-items: center;
  gap: var(--dv-space-xs);
}
.bill-search__sheet-cat-icon {
  width: 26px;
  height: 26px;
  border-radius: var(--dv-radius-sm);
  background: var(--dv-surface-alt);
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
:global([data-wallpaper='on'] .bill-search__box),
:global([data-wallpaper='on'] .bill-search__chip),
:global([data-wallpaper='on'] .bill-search__list) {
  background: var(--dv-surface-soft);
  border-color: var(--dv-surface-border);
}
</style>