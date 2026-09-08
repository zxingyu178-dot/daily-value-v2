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
import { computed, onMounted, ref } from 'vue';
import { DVCard } from '@/components/design';
import { useBillStore } from '@/core/store/bill';
import { useCategoryStore } from '@/core/store/category';
import { localDateKey, totalDailyValue } from '@/core/models/daily-value';
import { useLocalMidnightRefresh } from '@/core/hooks/useLocalMidnight';
import { computeDailyValueList, type DailyValueItem } from './daily-value-list';
import type { Bill, Category } from '@/core/models/types';
import DailyValueAddSheet from './DailyValueAddSheet.vue';
import DVCategoryIcon from '@/components/category/DVCategoryIcon.vue';

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

/** 右下角 FAB：打开「添加日价物品」面板（新增） */
function openAdd() {
  editingBill.value = null;
  sheetOpen.value = true;
}
/** 点击列表项：打开「编辑日价物品」面板（复用同一表单，patch 原 Bill） */
function openEdit(item: { id: string }) {
  editingBill.value = billStore.bills.find((b) => b.id === item.id) ?? null;
  if (editingBill.value) sheetOpen.value = true;
}
function onSheetSaved() {
  // billStore 已同步（add/update），本地 computed 即时刷新，无需额外处理
}

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
        outlined
        padding="md"
        @click="openEdit(item)"
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
      </DVCard>
    </div>

    <!-- FIX-05：日价页右下角独立「添加」入口（圆角方形 FAB，与记账页 FAB 风格统一）。
         Teleport 到 body：.primary-page-stage（2.10.2）拖动/动效时会为子元素创建 transform
         containing block，fixed 定位的 FAB 会随之移动；挂到 body 后 FAB 恒相对视口固定。 -->
    <Teleport to="body">
      <button class="dv__fab" type="button" aria-label="添加日价物品" @click="openAdd">＋</button>
    </Teleport>

    <!-- 2.9.6 稳定性修复：DailyValueAddSheet 移入 section 内，保证页面保持单根节点。
         根因（P0-1）：2.9.5 将 Sheet 放在 section 外，使 DailyValuePage 变成 Vue Fragment（多根），
         在 Transition(out-in)+KeepAlive 组合下触发路由空白。Sheet 内部自身的 Teleport/Fragment 可保留；
         一级 Route Component 必须保持单一稳定 root。 -->
    <DailyValueAddSheet
      :model-value="sheetOpen"
      :editing-bill="editingBill"
      @update:model-value="sheetOpen = $event"
      @saved="onSheetSaved"
    />
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
/* 每日总花费卡 */
.dv__summary {
  border-radius: var(--dv-radius-lg);
  background: var(--dv-month-card-bg);
  color: var(--dv-month-card-text);
  box-shadow: var(--dv-month-card-shadow);
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
/* FIX-05：日价页右下角添加 FAB（圆角方形，与记账页 FAB 风格统一：md 圆角 + 克制阴影 + + 居中） */
.dv__fab {
  position: fixed;
  right: var(--dv-space-lg);
  bottom: calc(var(--dv-space-lg) + var(--dv-safe-bottom));
  width: 56px;
  height: 56px;
  border-radius: var(--dv-radius-md);
  background: var(--dv-primary);
  color: var(--dv-on-primary);
  font-size: 30px;
  font-weight: 500;
  line-height: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 4px 12px color-mix(in srgb, var(--dv-primary) 32%, transparent);
  z-index: var(--dv-z-sticky);
  transition: transform var(--dv-motion-fast) var(--dv-ease-standard);
}
.dv__fab:active {
  transform: scale(0.94);
}
</style>
