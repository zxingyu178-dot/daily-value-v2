<script setup lang="ts">
/**
 * 记账主界面（Phase 3，App 默认首页 + Phase 4 收尾修正）
 * - 绿色月份汇总卡（支出/收入/结余，主金额水平居中，内部轻量切月箭头）
 * - 月份卡横向切换（触摸滑动 + 内部箭头，唯一横向滑月手势区域）
 * - 连续账单时间线（跨月份按日期倒序分组，页内滚动）
 * - 切月后目标月份第一条记录精确置顶（动态尾部 spacer + 精确 scrollTop）
 * - 日期标题：只有支出/只有收入/两者兼有时分别展示，不显示无意义的“支出 0.00”
 * - 列表到底轻反馈（fade + 轻微上弹）
 * - 右下角 + 快速记账入口
 */
// 显式组件名：App.vue KeepAlive include 按名字精确缓存一级页面，保证切页不丢滚动位置
defineOptions({ name: 'AccountingPage' });
import { computed, onMounted, onUnmounted, onDeactivated, onBeforeUnmount, ref, watch, nextTick } from 'vue';
import { useRoute } from 'vue-router';
import { Capacitor } from '@capacitor/core';
import { useBillStore } from '@/core/store/bill';
import { useCategoryStore } from '@/core/store/category';
import { localDateKey, msUntilNextLocalMidnight } from '@/core/models/daily-value';
import type { Bill, Category } from '@/core/models/types';
import { DVConfirmDialog, toast } from '@/components/design';
import { useLongPress } from '@/core/hooks/useLongPress';
import { computeMonthScroll } from './timeline-position';
import QuickEntrySheet from './QuickEntrySheet.vue';
import DVCategoryIcon from '@/components/category/DVCategoryIcon.vue';
import { onPrimaryAction } from '@/app/primary-action';

const billStore = useBillStore();
const categoryStore = useCategoryStore();

/** 今天日期 yyyy-MM-dd（跨日可刷新，避免跨午夜仍是昨日） */
const today = ref<string>(localDateKey());

/** 当前月份 yyyy-MM（跨日可刷新：App resume / 跨午夜定时器，避免跨天仍显示上个月） */
const currentYM = ref<string>(today.value.slice(0, 7));

/** 跨日刷新当前月份；若用户仍查看“今天”月份则跟随到新月份（如 8月31日→9月1日） */
function refreshCurrentMonth() {
  const newYM = localDateKey().slice(0, 7);
  today.value = localDateKey();
  const wasOnTodayMonth = activeYM.value === currentYM.value;
  currentYM.value = newYM;
  if (wasOnTodayMonth) activeYM.value = newYM;
}

/** 当前查看月份 yyyy-MM */
const activeYM = ref(currentYM.value);
/** 快速记账 Sheet */
const sheetOpen = ref(false);
/** 编辑模式：当前待编辑的账单（非空时 QuickEntry 进入 edit 模式） */
const editingBill = ref<Bill | null>(null);
/** 时间线滚动容器 */
const timelineRef = ref<HTMLElement | null>(null);
/** 真实账单内容结束标记（位于月份定位 spacer 之前，用于判定“是否看到最后一条真实账单”） */
const endSentinelRef = ref<HTMLElement | null>(null);
/** 是否已滚到最早记录（到底反馈） */
const reachedBottom = ref(false);
/** 时间线尾部动态 spacer 高度（保证任何月份都能置顶） */
const spacerHeight = ref(0);

/* ---- 数据加载 ---- */
onMounted(async () => {
  await Promise.all([billStore.load(), categoryStore.load()]);
  refreshCurrentMonth();
  startCrossDayWatcher();
});

/** 跨午夜自动切到新的一天（无需用户重进页面）；App resume 时同步刷新。
 *  每次精确排到“下一次本地午夜”，触发后再次递归调度，避免 DST 23/25 小时漂移。 */
let crossDayTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleNextMidnight() {
  crossDayTimer = setTimeout(() => {
    refreshCurrentMonth();
    // 到点后重新调度下一次午夜（不再使用固定 24h interval）
    scheduleNextMidnight();
  }, msUntilNextLocalMidnight());
}
function startCrossDayWatcher() {
  scheduleNextMidnight();
  void registerResumeRefresh();
}
/** App 从后台回到前台的跨日刷新（仅 Capacitor 原生环境） */
let resumeSub: { remove: () => void } | null = null;
async function registerResumeRefresh() {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const { App } = await import('@capacitor/app');
    resumeSub = await App.addListener('resume', refreshCurrentMonth);
  } catch {
    // 无 @capacitor/app 时降级：仅靠跨午夜定时器
  }
}

/* 组件卸载时清理跨日定时器与 resume 监听，避免泄漏 */
onUnmounted(() => {
  if (crossDayTimer) clearTimeout(crossDayTimer);
  void resumeSub?.remove?.();
});

/* ---- 月份列表：有账单的月份 + 当前月（升序：旧 → 新） ---- */
const monthList = computed<string[]>(() => {
  const set = new Set<string>([currentYM.value]);
  for (const b of billStore.bills) {
    if (b.ledgerImpact === 'daily-value-only') continue;
    set.add(b.date.slice(0, 7));
  }
  return [...set].sort();
});

const monthIndex = computed(() => monthList.value.indexOf(activeYM.value));
const canPrev = computed(() => monthIndex.value > 0);
const canNext = computed(() => monthIndex.value < monthList.value.length - 1);

/* ---- 月份汇总 ---- */
const summary = computed(() => {
  let expense = 0;
  let income = 0;
  for (const b of billStore.bills) {
    if (b.ledgerImpact === 'daily-value-only') continue;
    if (!b.date.startsWith(activeYM.value)) continue;
    if (b.type === 'expense') expense += b.amount;
    else income += b.amount;
  }
  return { expense, income, net: income - expense };
});

const monthLabel = computed(() => {
  const [y, m] = activeYM.value.split('-').map(Number);
  return `${y}年${m}月`;
});

/* ---- 月份卡横向切换 ---- */
function shiftMonth(delta: number) {
  const next = monthList.value[monthIndex.value + delta];
  if (next) activeYM.value = next;
}

/* 触摸滑动切换月份（水平位移超过阈值） */
let touchStartX = 0;
let touchMoved = false;
function onTouchStart(e: TouchEvent) {
  touchStartX = e.touches[0].clientX;
  touchMoved = false;
}
function onTouchMove(e: TouchEvent) {
  // 仅记录是否发生了明显的水平移动，用于 touchend 判断是否为滑动手势。
  // 不调用 preventDefault：卡片已设 touch-action: pan-y，横向手势由 JS 判断
  // 切换月份，纵向手势交给浏览器滚动。
  const dx = e.touches[0].clientX - touchStartX;
  if (Math.abs(dx) > 8) touchMoved = true;
}
function onTouchEnd(e: TouchEvent) {
  if (!touchMoved) return;
  const delta = e.changedTouches[0].clientX - touchStartX;
  if (Math.abs(delta) < 56) return; // 阈值
  shiftMonth(delta < 0 ? 1 : -1); // 左滑 → 下个月；右滑 → 上个月
}

/* ---- 连续账单时间线：所有 normal 账单按日期倒序分组 ---- */
interface DayGroup {
  date: string;
  bills: Bill[];
}
const timeline = computed<DayGroup[]>(() => {
  const map = new Map<string, Bill[]>();
  for (const b of billStore.bills) {
    if (b.ledgerImpact === 'daily-value-only') continue;
    const list = map.get(b.date) ?? [];
    list.push(b);
    map.set(b.date, list);
  }
  return [...map.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([date, bills]) => ({
      date,
      bills: bills.sort((x, y) => y.timestamp - x.timestamp),
    }));
});

/* ---- 切月后定位：目标月份第一条分组精确置顶（spacer 保证最老月份也可达） ---- */
async function scrollToMonth(ym: string) {
  await nextTick();
  const container = timelineRef.value;
  if (!container) return;
  const target = container.querySelector<HTMLElement>(`[data-month="${ym}"]`);
  if (!target) {
    // 目标月份无记录：回到顶部
    spacerHeight.value = 0;
    container.scrollTop = 0;
    return;
  }
  const contentHeight = container.scrollHeight - spacerHeight.value;
  // 用 rect 差值求目标月份首条在内容区的偏移：
  // target.offsetTop 是相对时间线容器的（offsetParent 即容器），而 container.offsetTop
  // 是相对页面容器的，两者坐标系不同，相减会产生固定偏差；改为视口 rect 差值 + scrollTop。
  const targetTop = Math.max(
    0,
    target.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop,
  );
  const { scrollTop, spacerHeight: need } = computeMonthScroll(
    container.clientHeight,
    contentHeight,
    targetTop,
  );
  spacerHeight.value = need;
  await nextTick();
  container.scrollTop = scrollTop;
}

watch(activeYM, (ym) => {
  void scrollToMonth(ym);
  reachedBottom.value = false;
});

/* ---- 列表到底反馈：基于真实账单 end sentinel（位于月份定位 spacer 之前，spacer 不参与到底判断） ---- */
function onTimelineScroll() {
  const el = timelineRef.value;
  const sentinel = endSentinelRef.value;
  if (!el || !sentinel) return;
  // 短列表（真实内容到 sentinel 为止未超出可视区）：不显示到底反馈。
  // 不能单独用 scrollHeight：其包含底部 padding 与月份定位 spacer，内容很短时也会让
  // scrollHeight > clientHeight，导致短列表仍误显示“已到底部”。
  if (sentinel.offsetTop <= el.clientHeight) {
    reachedBottom.value = false;
    return;
  }
  // 内容可滚动：用户实际向下滚动并到达真实账单 sentinel 后才显示。
  // sentinel 是“真实账单内容”的结束标记，位于月份定位 spacer 之前，spacer 不介入判定。
  reachedBottom.value = el.scrollTop + el.clientHeight >= sentinel.offsetTop;
}

/* ---- 日期展示辅助 ---- */
function dayMeta(date: string) {
  const [y, m, d] = date.split('-').map(Number);
  const week = ['日', '一', '二', '三', '四', '五', '六'][new Date(y, m - 1, d).getDay()];
  const isToday = date === today.value;
  return { m, d, week, isToday, isYesterday: date === yesterdayKey() };
}
function yesterdayKey(): string {
  const t = new Date();
  t.setDate(t.getDate() - 1);
  const m = String(t.getMonth() + 1).padStart(2, '0');
  const day = String(t.getDate()).padStart(2, '0');
  return `${t.getFullYear()}-${m}-${day}`;
}
function daySummary(bills: Bill[]): { expense: number; income: number } {
  let expense = 0;
  let income = 0;
  for (const b of bills) {
    if (b.type === 'expense') expense += b.amount;
    else income += b.amount;
  }
  return { expense, income };
}
function fmt(n: number): string {
  return n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function billName(b: Bill): string {
  return b.title || b.categoryName;
}

/**
 * 账单 → 分类（统一图标渲染）：优先取实时分类（修改图标后立即反映 SVG），
 * 分类已不存在（旧数据 / 已删除）时回退账单快照 emoji。
 */
function categoryOf(bill: Bill): Category | undefined {
  return categoryStore.byId(bill.categoryId) ?? {
    id: bill.categoryId,
    name: bill.categoryName,
    emoji: bill.categoryEmoji,
    builtin: false,
    sort: 0,
  };
}

/* ---- 空状态 ---- */
const hasAny = computed(() => billStore.bills.some((b) => b.ledgerImpact !== 'daily-value-only'));

/* ---- 快速记账 / 编辑账单入口 ---- */
/**
 * 2.10.10 架构收口：FAB 已上移 App.vue 全局唯一（GlobalPrimaryFab），页面不再渲染/Teleport FAB。
 * 本页只订阅命令：收到 accounting-add 且当前路由仍为本页时立即开 Sheet。
 * 入口归属以 route 为唯一事实来源（不再依赖 KeepAlive activated / ownsRoute 时序）。
 */
const route = useRoute();

let stopPrimaryAction: (() => void) | null = null;
onMounted(() => {
  stopPrimaryAction = onPrimaryAction((cmd) => {
    if (cmd.type === 'accounting-add' && route.path === '/accounting') openCreate();
  });
});
onBeforeUnmount(() => {
  stopPrimaryAction?.();
  longPress.reset();
});

function openCreate() {
  if (route.path !== '/accounting') return;
  editingBill.value = null;
  sheetOpen.value = true;
}
/** 点击账单行 → 打开编辑 Sheet（整行可点） */
function openEditBill(bill: Bill) {
  if (route.path !== '/accounting') return;
  editingBill.value = bill;
  sheetOpen.value = true;
}
/** 保存后刷新数据；时间线/月汇总/统计/日价均从 store 派生，load 后即刷新 */
async function onSaved() {
  await billStore.load(true);
}

/* ---- 2.10.8 账单长按删除（轻点 = 编辑；长按 = 删除确认；删除永远需二次确认） ---- */
/** 最近一次 pointerdown 的账单（长按触发时据此打开确认框） */
const pressedBill = ref<Bill | null>(null);
/** 长按按压中的账单 id（150ms 轻反馈视觉） */
const pressingId = ref<string | null>(null);
const longPress = useLongPress({
  onTrigger: () => {
    const bill = pressedBill.value;
    if (!bill) return;
    deleteTarget.value = bill;
    deleteConfirmOpen.value = true;
  },
  onFeedbackStart: () => {
    pressingId.value = pressedBill.value?.id ?? null;
  },
  onFeedbackEnd: () => {
    pressingId.value = null;
  },
});
function onItemPointerDown(bill: Bill, e: PointerEvent) {
  pressedBill.value = bill;
  longPress.onPointerdown(e);
}
function onItemPointerUp(e: PointerEvent) {
  longPress.onPointerup(e);
}
function onItemPointerMove(e: PointerEvent) {
  longPress.onPointermove(e);
}
function onItemPointerCancel(e: PointerEvent) {
  longPress.onPointercancel(e);
}
/** 轻点：若前一次是长按触发（已吞掉 click），则不再打开编辑 */
function onItemClick(bill: Bill) {
  if (longPress.consumeSuppressedClick()) return;
  openEditBill(bill);
}

/* ---- 删除确认 ---- */
const deleteTarget = ref<Bill | null>(null);
const deleteConfirmOpen = ref(false);
const deleting = ref(false);
/** recurring 生成的账单：删除只影响当次，不影响后续周期记账（rule 不删除） */
const deleteHint = computed(() =>
  deleteTarget.value?.source === 'recurring'
    ? '删除后无法恢复。只删除本次账单，不影响后续周期记账。'
    : '删除后无法恢复。',
);
async function confirmDeleteBill() {
  const bill = deleteTarget.value;
  if (!bill || deleting.value) return;
  deleting.value = true;
  try {
    await billStore.remove(bill.id);
    toast.success('账单已删除');
    deleteConfirmOpen.value = false;
    deleteTarget.value = null;
    pressedBill.value = null;
  } finally {
    deleting.value = false;
  }
}

// 2.10.8 失活清理：关闭全部本页临时交互（Sheet/删除确认/子弹层/焦点），
// 不销毁 KeepAlive 页面（滚动位/月份/统计状态保留）。
// 2.10.10：FAB 归属不再依赖本钩子（route 驱动），此处只负责清理本页 Sheet/弹层。
onDeactivated(() => {
  sheetOpen.value = false;
  editingBill.value = null;
  deleteConfirmOpen.value = false;
  deleteTarget.value = null;
  pressedBill.value = null;
  pressingId.value = null;
  longPress.reset();
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
});
</script>

<template>
  <section class="accounting">
    <!-- 月份汇总卡（sticky 顶部，唯一横向滑月手势区域） -->
    <div class="accounting__month">
      <div
        class="accounting__card"
        data-page-swipe-ignore
        @touchstart.passive="onTouchStart"
        @touchmove.passive="onTouchMove"
        @touchend.passive="onTouchEnd"
      >
        <Transition name="dv-month-fade" mode="out-in">
          <div :key="activeYM" class="accounting__card-body">
            <div class="accounting__card-head">
              <span class="accounting__card-month">{{ monthLabel }}</span>
              <div class="accounting__card-arrows">
                <button
                  class="accounting__card-arrow"
                  type="button"
                  aria-label="上一月"
                  :disabled="!canPrev"
                  @click="shiftMonth(-1)"
                >
                  ‹
                </button>
                <button
                  class="accounting__card-arrow"
                  type="button"
                  aria-label="下一月"
                  :disabled="!canNext"
                  @click="shiftMonth(1)"
                >
                  ›
                </button>
              </div>
            </div>
            <p class="accounting__card-label">本月支出</p>
            <p class="accounting__card-expense">¥ {{ fmt(summary.expense) }}</p>
            <div class="accounting__card-sub">
              <span>收入 ¥ {{ fmt(summary.income) }}</span>
              <span>结余 ¥ {{ fmt(summary.net) }}</span>
            </div>
            <p class="accounting__card-tip">左右滑动切换月份</p>
          </div>
        </Transition>
      </div>
    </div>

    <!-- 账单时间线（2.10.2：dv-primary-scroll-surface —— 页面内独立滚动容器，
          touch-action 不继承父层；必须带该类才不会在 Android 真机被 WebView
          接管横向 pan 抛 pointercancel，Primary Pager 才能从账行起滑生效） -->
    <div
      ref="timelineRef"
      class="accounting__timeline dv-primary-scroll-surface"
      @scroll.passive="onTimelineScroll"
    >
      <p v-if="!hasAny" class="accounting__empty">
        还没有账单，点右下角「＋」记一笔吧
      </p>

      <template v-for="group in timeline" :key="group.date">
        <section class="tl-day" :data-month="group.date.slice(0, 7)">
          <header class="tl-day__head">
            <span class="tl-day__date">
              {{ group.date.slice(5, 7) }}月{{ dayMeta(group.date).d }}日
              <em class="tl-day__week">{{ dayMeta(group.date).week }}</em>
              <b v-if="dayMeta(group.date).isToday" class="tl-day__flag">今天</b>
              <b v-else-if="dayMeta(group.date).isYesterday" class="tl-day__flag">昨天</b>
            </span>
            <span class="tl-day__total">
              <template v-if="daySummary(group.bills).expense > 0 && daySummary(group.bills).income > 0">
                支出 ¥ {{ fmt(daySummary(group.bills).expense) }} · 收入 ¥ {{ fmt(daySummary(group.bills).income) }}
              </template>
              <template v-else-if="daySummary(group.bills).expense > 0">
                支出 ¥ {{ fmt(daySummary(group.bills).expense) }}
              </template>
              <template v-else-if="daySummary(group.bills).income > 0">
                收入 ¥ {{ fmt(daySummary(group.bills).income) }}
              </template>
            </span>
          </header>
          <ul class="tl-day__list">
            <li
              v-for="bill in group.bills"
              :key="bill.id"
              class="tl-item"
              :class="{ 'is-pressing': pressingId === bill.id }"
              role="button"
              tabindex="0"
              :aria-label="`编辑账单：${billName(bill)}`"
              @click="onItemClick(bill)"
              @keydown.enter="onItemClick(bill)"
              @pointerdown.passive="onItemPointerDown(bill, $event)"
              @pointermove.passive="onItemPointerMove($event)"
              @pointerup.passive="onItemPointerUp($event)"
              @pointercancel.passive="onItemPointerCancel($event)"
            >
              <span class="tl-item__emoji">
                <DVCategoryIcon :category="categoryOf(bill)" :size="22" />
              </span>
              <div class="tl-item__main">
                <span class="tl-item__name">{{ billName(bill) }}</span>
                <span v-if="bill.note" class="tl-item__note">{{ bill.note }}</span>
              </div>
              <span
                class="tl-item__amount"
                :class="bill.type === 'expense' ? 'is-expense' : 'is-income'"
              >
                {{ bill.type === 'expense' ? '-' : '+' }}{{ fmt(bill.amount) }}
              </span>
            </li>
          </ul>
        </section>
      </template>

      <!-- 真实账单内容结束标记（位于月份定位 spacer 之前，用来判定“是否看到最后一条真实账单”） -->
      <div ref="endSentinelRef" class="accounting__end-sentinel" />

      <!-- 列表到底轻反馈：紧跟真实账单结束标记之后，Spacer 之前。
           用户到达真实最后一笔账单即立即看到，Spacer 高度绝不改变其视觉位置。 -->
      <Transition name="dv-end">
        <p v-if="hasAny && reachedBottom" class="accounting__end">— 已到底部 —</p>
      </Transition>

      <!-- 月份定位专用 spacer：只服务月份置顶，位于反馈之后，不参与到底判定、不影响反馈位置 -->
      <div class="accounting__spacer" :style="{ height: spacerHeight + 'px' }" />
    </div>

    <!-- 2.10.10：主操作入口已上移 App 全局唯一 GlobalPrimaryFab（本页不再渲染 FAB）。
         本页只负责自己的 Sheet：路由为本页时挂载，切走由 route 条件/失活清理关闭。 -->
    <QuickEntrySheet
      v-if="route.path === '/accounting'"
      v-model="sheetOpen"
      :editing-bill="editingBill"
      @saved="onSaved"
    />

    <!-- 2.10.8 删除账单确认（长按账单触发；永远需要二次确认；Back 先关 Dialog 再关 Sheet） -->
    <DVConfirmDialog
      :model-value="deleteConfirmOpen"
      title="删除这笔账单？"
      confirm-label="删除"
      @update:model-value="(v: boolean) => { if (!v) deleteConfirmOpen = false }"
      @confirm="confirmDeleteBill"
    >
      <p>{{ deleteHint }}</p>
    </DVConfirmDialog>
  </section>
</template>

<style scoped>
.accounting {
  position: relative;
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
/* 月份卡 */
.accounting__month {
  position: sticky;
  top: 0;
  z-index: var(--dv-z-sticky);
  padding: var(--dv-space-sm) var(--dv-space-md);
  /* 无壁纸 = --dv-bg；有壁纸 = transparent（壁纸贯穿顶部，品牌绿卡浮于其上） */
  background: var(--dv-page-bg);
}
.accounting__card {
  border-radius: var(--dv-radius-lg);
  /* Hero Surface（2.13.1）：随 Theme Color + Theme Style，随主题变化 */
  background: var(--dv-hero-bg);
  color: var(--dv-hero-text);
  box-shadow: var(--dv-hero-shadow);
  border: var(--dv-hero-border);
  touch-action: pan-y;
  overflow: hidden;
}
.accounting__card-body {
  padding: var(--dv-space-md);
}
.accounting__card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.accounting__card-month {
  font-size: 14px;
  font-weight: 600;
  opacity: 0.9;
}
/* 内部轻量切月箭头（融入卡片视觉，不挤压卡片宽度） */
.accounting__card-arrows {
  display: flex;
  gap: var(--dv-space-xxs);
}
.accounting__card-arrow {
  width: 28px;
  height: 28px;
  border-radius: var(--dv-radius-pill);
  background: rgba(255, 255, 255, 0.18);
  color: var(--dv-hero-text);
  font-size: 16px;
  line-height: 1;
  transition: opacity var(--dv-motion-fast) var(--dv-ease-standard);
}
.accounting__card-arrow:active:not(:disabled) {
  background: rgba(255, 255, 255, 0.32);
}
.accounting__card-arrow:disabled {
  opacity: 0.35;
}
/* 主指标标题 + 主金额真正水平居中 */
.accounting__card-label {
  margin-top: var(--dv-space-sm);
  font-size: 13px;
  text-align: center;
  opacity: 0.85;
}
.accounting__card-expense {
  margin-top: var(--dv-space-xxs);
  font-size: 30px;
  font-weight: 700;
  letter-spacing: 0.5px;
  text-align: center;
  font-variant-numeric: tabular-nums;
}
.accounting__card-sub {
  display: flex;
  justify-content: space-between;
  margin-top: var(--dv-space-sm);
  font-size: 12px;
  opacity: 0.9;
}
.accounting__card-tip {
  margin-top: var(--dv-space-sm);
  font-size: 11px;
  text-align: center;
  opacity: 0.55;
}
/* 卡片切月动画：当前内容淡出/轻位移，新月份内容进入（禁止整页横向移动） */
.dv-month-fade-enter-active,
.dv-month-fade-leave-active {
  /* 切月轻过渡：与一级页面切换同走 --dv-motion-page token（160ms），不硬编码独立时长 */
  transition:
    opacity var(--dv-motion-page) var(--dv-ease-standard),
    transform var(--dv-motion-page) var(--dv-ease-standard);
}
.dv-month-fade-enter-from {
  opacity: 0;
  transform: translateY(6px);
}
.dv-month-fade-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}
/* 时间线（页面内滚动容器） */
.accounting__timeline {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  padding: var(--dv-space-xs) var(--dv-space-md) calc(var(--dv-space-lg) + 96px + var(--dv-safe-bottom));
}
.accounting__empty {
  padding: var(--dv-space-xl) var(--dv-space-md);
  text-align: center;
  color: var(--dv-on-surface-variant);
  font-size: 14px;
}
.tl-day {
  padding-top: var(--dv-space-md);
}
.tl-day__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--dv-space-xxs);
  padding-bottom: var(--dv-space-xxs);
  border-bottom: 1px solid var(--dv-surface-border);
}
.tl-day__date {
  font-size: 13px;
  font-weight: 600;
  color: var(--dv-on-surface);
}
.tl-day__week {
  font-style: normal;
  font-weight: 400;
  color: var(--dv-on-surface-variant);
  margin-left: var(--dv-space-xxs);
}
.tl-day__flag {
  margin-left: var(--dv-space-xxs);
  padding: 1px 6px;
  border-radius: var(--dv-radius-pill);
  background: var(--dv-primary-soft);
  color: var(--dv-primary);
  font-size: 11px;
  font-weight: 600;
}
.tl-day__total {
  font-size: 12px;
  color: var(--dv-on-surface-variant);
}
.tl-day__list {
  list-style: none;
}
.tl-item {
  display: flex;
  align-items: center;
  gap: var(--dv-space-sm);
  padding: var(--dv-space-sm) var(--dv-space-xxs);
  margin: 0 calc(var(--dv-space-xxs) * -1);
  border-radius: var(--dv-radius-md);
  transition:
    background-color var(--dv-motion-fast) var(--dv-ease-standard),
    transform var(--dv-motion-fast) var(--dv-ease-standard);
  -webkit-user-select: none;
  user-select: none;
  cursor: pointer;
}
.tl-item:active {
  background: var(--dv-surface-alt);
}
/* 2.10.8 长按轻反馈：按压约 150ms 后轻微下沉（不抖动、不弹跳），触发/取消后恢复 */
.tl-item.is-pressing {
  transform: scale(0.985);
}
.tl-item + .tl-item {
  border-top: 1px solid color-mix(in srgb, var(--dv-outline) 60%, transparent);
}
.tl-item__emoji {
  flex-shrink: 0;
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--dv-radius-md);
  background: var(--dv-surface-alt);
  font-size: 20px;
}
.tl-item__main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.tl-item__name {
  font-size: 15px;
  font-weight: 500;
  color: var(--dv-on-surface);
}
.tl-item__note {
  font-size: 12px;
  color: var(--dv-on-surface-variant);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tl-item__amount {
  flex-shrink: 0;
  font-size: 15px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
/* 产品固定规则：支出=绿色，收入=红色 */
.tl-item__amount.is-expense {
  color: var(--dv-expense);
}
.tl-item__amount.is-income {
  color: var(--dv-income);
}
/* 到底反馈：真实账单内容结束标记之后、文档流内的轻量文案（不再是覆盖在账单上的浮层） */
.accounting__end-sentinel {
  height: 0;
}
.accounting__end {
  padding: var(--dv-space-md) 0 var(--dv-space-sm);
  text-align: center;
  color: var(--dv-on-surface-variant);
  font-size: 12px;
}
.dv-end-enter-active {
  transition:
    opacity var(--dv-motion-normal) cubic-bezier(0.2, 0, 0, 1),
    transform var(--dv-motion-normal) cubic-bezier(0.2, 0, 0, 1.2);
}
.dv-end-enter-from {
  opacity: 0;
  transform: translateY(6px) scale(0.96);
}
/* Wallpaper ON：图标小卡改半透明 Surface（统一 Token），其余行/分组仍透明靠 border 区分，
   不开 backdrop blur 以保滚动流畅 */
:global([data-wallpaper='on'] .tl-item__emoji) {
  background: var(--dv-surface-soft);
}
</style>
