<script setup lang="ts">
/**
 * 日价主页（Phase 5）
 * - 核心体验：用户打开日价，看到自己购买过的物品，以及它"截至今天，每天值多少钱"。
 * - 日价 = amount / elapsedDays(startDate, 今天)，每天打开自动重算（不持久化摊销天数）。
 * - 每日总花费 = 全部启用日价的账单当日日价合计。
 * - 数据从 Bill 派生（billStore.dailyValueBills），不维护第二套数据。
 * - 保持展示感：不引入复杂资产管理 / 折旧模型 / 预测寿命。
 */
// 显式组件名：App.vue KeepAlive include 按名字精确缓存一级页面，保证切页不丢滚动位置
defineOptions({ name: 'DailyValuePage' });
import {
  computed,
  onBeforeUnmount,
  onDeactivated,
  onMounted,
  ref,
} from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { DVCard, DVConfirmDialog, toast } from '@/components/design';
import { useBillStore } from '@/core/store/bill';
import { useCategoryStore } from '@/core/store/category';
import { localDateKey, totalDailyValue } from '@/core/models/daily-value';
import { useLocalMidnightRefresh } from '@/core/hooks/useLocalMidnight';
import { useLongPress } from '@/core/hooks/useLongPress';
import { computeDailyValueList, type DailyValueItem } from './daily-value-list';
import type { Bill, Category } from '@/core/models/types';
import DailyValueAddSheet from './DailyValueAddSheet.vue';
import DVCategoryIcon from '@/components/category/DVCategoryIcon.vue';
import { onPrimaryAction } from '@/app/primary-action';

const billStore = useBillStore();
const categoryStore = useCategoryStore();

onMounted(async () => {
  await Promise.all([billStore.load(), categoryStore.load()]);
});

/**
 * 日价物品 → 分类（统一图标渲染）：优先取实时分类（修改图标后立即反映 SVG），
 * 分类已不存在（旧数据 / 已删除）时回退账单快照 emoji。
 */
function categoryOf(item: DailyValueItem): Category | undefined {
  return categoryStore.byId(item.categoryId) ?? {
    id: item.categoryId,
    name: item.name,
    emoji: item.emoji,
    builtin: false,
    sort: 0,
  };
}

/* ---- FIX-05/06：日价页独立新增/编辑入口（只进日价模块，不进记账时间线/统计） ---- */
const sheetOpen = ref(false);
const editingBill = ref<Bill | null>(null);

/**
 * 2.10.10 架构收口：FAB 已上移 App.vue 全局唯一（GlobalPrimaryFab），页面不再渲染/Teleport FAB。
 * 本页只订阅命令：收到 daily-value-add 且当前路由仍为本页时立即开 Sheet。
 * 入口归属以 route 为唯一事实来源（不再依赖 KeepAlive activated / ownsRoute 时序）。
 */
const route = useRoute();
const router = useRouter();

let stopPrimaryAction: (() => void) | null = null;
onMounted(() => {
  stopPrimaryAction = onPrimaryAction((cmd) => {
    if (cmd.type === 'daily-value-add' && route.path === '/daily-value') openAdd();
  });
});
onBeforeUnmount(() => {
  stopPrimaryAction?.();
  longPress.reset();
});

/** 主操作命令（Global FAB）：打开「添加日价物品」面板（新增） */
function openAdd() {
  if (route.path !== '/daily-value') return;
  editingBill.value = null;
  sheetOpen.value = true;
}
/**
 * 2.20.0 Gate B：点击日价卡 → 进入日价详情（不再直接编辑）。
 * 编辑入口移动到详情页右上角；长按删除/移出语义保持不变。
 */
function openDetail(item: { id: string }) {
  if (route.path !== '/daily-value') return;
  void router.push(`/daily-value/${item.id}`);
}
function onSheetSaved() {
  // billStore 已同步（add/update），本地 computed 即时刷新，无需额外处理
}

/* ---- 2.10.8 长按两类语义（数据安全规则）----
 * A. ledgerImpact === 'daily-value-only'：独立日价项目 → 删除整条 Bill（删掉即从日价/统计一并消失）。
 * B. ledgerImpact === 'normal' 且 dailyValue.enabled：普通账单产生的日价 → 只移出日价，
 *    保留 id/amount/type/category/date/source/ledgerImpact，原 Bill、记账与统计完全不变。
 * 长按永远只打开确认框；最终删除/移出必须二次确认。 */
const pressedItem = ref<DailyValueItem | null>(null);
const pressingId = ref<string | null>(null);
const removeKind = ref<'delete' | 'remove'>('delete');
const removeTarget = ref<Bill | null>(null);
const removeConfirmOpen = ref(false);
const removing = ref(false);
const removeDialogTitle = computed(() =>
  removeKind.value === 'delete' ? '删除这个日价项目？' : '移出日价？',
);
const removeDialogText = computed(() =>
  removeKind.value === 'delete'
    ? '删除后无法恢复。'
    : '原账单仍会保留，只停止显示日价。',
);
const removeDialogConfirmLabel = computed(() =>
  removeKind.value === 'delete' ? '删除' : '移出',
);
const longPress = useLongPress({
  onTrigger: () => {
    const item = pressedItem.value;
    if (!item) return;
    const bill = billStore.bills.find((b) => b.id === item.id);
    if (!bill) return;
    removeKind.value = bill.ledgerImpact === 'daily-value-only' ? 'delete' : 'remove';
    removeTarget.value = bill;
    removeConfirmOpen.value = true;
  },
  onFeedbackStart: () => {
    pressingId.value = pressedItem.value?.id ?? null;
  },
  onFeedbackEnd: () => {
    pressingId.value = null;
  },
});
function onItemPointerDown(item: DailyValueItem, e: PointerEvent) {
  pressedItem.value = item;
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
/** 轻点：若前一次是长按触发（已吞掉 click），则不再打开详情 */
function onItemClick(item: DailyValueItem) {
  if (longPress.consumeSuppressedClick()) return;
  openDetail(item);
}
async function confirmRemoveDailyValue() {
  const bill = removeTarget.value;
  if (!bill || removing.value) return;
  removing.value = true;
  try {
    if (removeKind.value === 'delete') {
      await billStore.remove(bill.id);
      toast.success('已删除日价项目');
    } else {
      // 只移出日价：保留 id/amount/type/category/date/source/ledgerImpact='normal'
      await billStore.update(bill.id, { dailyValue: undefined });
      toast.success('已移出日价');
    }
    removeConfirmOpen.value = false;
    removeTarget.value = null;
    pressedItem.value = null;
  } finally {
    removing.value = false;
  }
}

// 2.10.6 修复：页面被 KeepAlive 缓存，切走时若不关闭 Sheet，其 Teleport 到 body 的
// DVSheet DOM 在 deactivated 期间仍悬浮显示（体现在「日价打开添加面板后切到记账，
// 仍看到日价的面板」）。deactivated 时强制关闭并清编辑态。
// 2.10.8 收紧：入口归属（isActive=false）+ 关闭确认框/清长按态/blur，避免失活残留。
// 2.10.10：FAB 归属不再依赖本钩子（route 驱动），此处只负责清理本页 Sheet/弹层。
onDeactivated(() => {
  sheetOpen.value = false;
  editingBill.value = null;
  removeConfirmOpen.value = false;
  removeTarget.value = null;
  pressedItem.value = null;
  pressingId.value = null;
  longPress.reset();
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
});

/** 今天（跨午夜自动刷新，避免停留至昨日日价） */
const today = ref<string>(localDateKey());

/** 日价物品列表（按当前日价降序） */
const items = computed(() => computeDailyValueList(billStore.bills, today.value));

/** 每日总花费 */
const total = computed(() => totalDailyValue(billStore.bills, today.value));

const itemCount = computed(() => items.value.length);

// 跨午夜：today 推进到新的一天后，elapsed 天数 + 每日日价自动重算，无需重进页面
useLocalMidnightRefresh(() => {
  today.value = localDateKey();
});

function fmt(n: number): string {
  return n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function dateText(date: string): string {
  const [, m, d] = date.split('-').map(Number);
  return `${m}月${d}日`;
}
</script>

<template>
  <section class="dv">
    <!-- 每日总花费卡片（绿色成本视觉，与记账月卡一致）。
         空状态时不再在卡片内重复文案：绿色卡只保留「每日总花费 ¥0.00」，
         统一由下方单一空状态说明，避免信息重复。 -->
    <div class="dv__summary">
      <p class="dv__summary-label">每日总花费</p>
      <p class="dv__summary-value">¥ {{ fmt(total) }}</p>
      <p v-if="itemCount > 0" class="dv__summary-sub">
        {{ itemCount }} 件物品 · 今天起每天的花费
      </p>
    </div>

    <!-- 日价物品列表 -->
    <div class="dv__list">
      <p v-if="itemCount === 0" class="dv__empty">
        还没有日价物品<br />点击右下角 ＋ 可直接添加，或在记账时开启「计算日价」。
      </p>

      <DVCard
        v-for="item in items"
        :key="item.id"
        class="dv__item"
        :class="{ 'is-pressing': pressingId === item.id }"
        outlined
        padding="md"
        @click="onItemClick(item)"
        @pointerdown.passive="onItemPointerDown(item, $event)"
        @pointermove.passive="onItemPointerMove($event)"
        @pointerup.passive="onItemPointerUp($event)"
        @pointercancel.passive="onItemPointerCancel($event)"
      >
        <span class="dv__item-emoji">
          <DVCategoryIcon :category="categoryOf(item)" :size="22" />
        </span>
        <div class="dv__item-main">
          <span class="dv__item-name">{{ item.name }}</span>
          <span class="dv__item-meta">
            原价 ¥ {{ fmt(item.amount) }} · {{ dateText(item.date) }} · 已用 {{ item.elapsed }} 天
          </span>
        </div>
        <div class="dv__item-daily">
          <span class="dv__item-daily-value">¥ {{ fmt(item.daily) }}</span>
          <span class="dv__item-daily-label">/ 天</span>
        </div>
        <!-- 2.20.0：轻量 ›，表示点击进入详情 -->
        <span class="dv__item-chevron" aria-hidden="true">›</span>
      </DVCard>
    </div>

    <!-- 2.10.10：主操作入口已上移 App 全局唯一 GlobalPrimaryFab（本页不再渲染 FAB）。
         本页只负责自己的 Sheet：路由为本页时挂载，切走由 route 条件/失活清理关闭。 -->
    <DailyValueAddSheet
      v-if="route.path === '/daily-value'"
      :model-value="sheetOpen"
      :editing-bill="editingBill"
      @update:model-value="sheetOpen = $event"
      @saved="onSheetSaved"
    />

    <!-- 2.10.8 长按确认框：daily-value-only → 删除整条 Bill；normal → 只移出日价。
         删除/移出一律需要用户二次确认；Back 先关 Dialog，不退出 App。 -->
    <DVConfirmDialog
      :model-value="removeConfirmOpen"
      :title="removeDialogTitle"
      :confirm-label="removeDialogConfirmLabel"
      @update:model-value="(v: boolean) => { if (!v) removeConfirmOpen = false }"
      @confirm="confirmRemoveDailyValue"
    >
      <p class="dv__remove-text">{{ removeDialogText }}</p>
    </DVConfirmDialog>
  </section>
</template>

<style scoped>
.dv {
  display: flex;
  flex-direction: column;
  gap: var(--dv-space-sm);
  padding: var(--dv-space-md);
  padding-bottom: calc(var(--dv-space-xl) + var(--dv-safe-bottom));
}
/* 每日总花费卡（Hero Surface，2.13.1：随 Theme Color + Theme Style） */
.dv__summary {
  border-radius: var(--dv-radius-lg);
  background: var(--dv-hero-bg);
  color: var(--dv-hero-text);
  box-shadow: var(--dv-hero-shadow);
  border: var(--dv-hero-border);
  padding: var(--dv-space-md);
}
.dv__summary-label {
  font-size: 13px;
  text-align: center;
  opacity: 0.85;
}
.dv__summary-value {
  margin-top: var(--dv-space-xxs);
  font-size: 30px;
  font-weight: 700;
  letter-spacing: 0.5px;
  text-align: center;
  font-variant-numeric: tabular-nums;
}
.dv__summary-sub {
  margin-top: var(--dv-space-sm);
  font-size: 12px;
  text-align: center;
  opacity: 0.9;
}
/* 物品列表 */
.dv__list {
  display: flex;
  flex-direction: column;
  gap: var(--dv-space-xs);
}
.dv__empty {
  /* 精简空状态：单一提示，两行内；垂直位置轻微上移（绿卡空态不再叠加文案后自然更紧凑） */
  padding: var(--dv-space-sm) var(--dv-space-md) var(--dv-space-md);
  text-align: center;
  color: var(--dv-on-surface-variant);
  font-size: 14px;
  line-height: 1.8;
}
.dv__item {
  display: flex;
  align-items: center;
  gap: var(--dv-space-sm);
  -webkit-user-select: none;
  user-select: none;
  /* 2.10.8 长按轻反馈平滑恢复 */
  transition: transform var(--dv-motion-fast) var(--dv-ease-standard);
}
/* 2.10.8 长按轻反馈：按压约 150ms 后轻微下沉（不抖动、不弹跳），触发/取消后恢复 */
.dv__item.is-pressing {
  transform: scale(0.985);
}
.dv__remove-text {
  font-size: 13px;
  color: var(--dv-on-surface-variant);
  line-height: 1.6;
}
.dv__item-emoji {
  flex-shrink: 0;
  width: 44px;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--dv-radius-md);
  background: var(--dv-surface-alt);
  font-size: 22px;
}
.dv__item-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--dv-space-xxs);
}
.dv__item-name {
  font-size: 15px;
  font-weight: 600;
  color: var(--dv-on-surface);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dv__item-meta {
  font-size: 12px;
  color: var(--dv-on-surface-variant);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dv__item-daily {
  flex-shrink: 0;
  display: flex;
  align-items: baseline;
  gap: 2px;
}
/* 产品固定规则：支出=绿色（日价为成本语义，使用绿色） */
.dv__item-daily-value {
  font-size: 18px;
  font-weight: 700;
  color: var(--dv-expense);
  font-variant-numeric: tabular-nums;
}
.dv__item-daily-label {
  font-size: 11px;
  color: var(--dv-on-surface-variant);
}
/* 2.20.0：点击进入详情的轻量提示箭头 */
.dv__item-chevron {
  flex-shrink: 0;
  font-size: 16px;
  color: var(--dv-on-surface-variant);
}
/* Wallpaper Surface Mode（ON）：
   - 物品卡改半透明面（浮在壁纸上，不整卡实底遮住壁纸）
   - 空状态加一个很轻的 translucent information surface，只包住提示文字，
     不在壁纸上直接压低对比度灰字，避免可读性不稳
   颜色统一来自 base.css Token；全部走半透明，避免大量 backdrop blur 拖慢滚动。 */
:global([data-wallpaper='on'] .dv__item) {
  background: var(--dv-surface-soft);
  border-color: var(--dv-surface-border);
  box-shadow: var(--dv-surface-shadow);
}
:global([data-wallpaper='on'] .dv__item-emoji) {
  background: var(--dv-surface-soft);
}
:global([data-wallpaper='on'] .dv__empty) {
  background: var(--dv-surface-soft);
  border: 1px solid var(--dv-surface-border);
  border-radius: var(--dv-radius-md);
}
</style>
