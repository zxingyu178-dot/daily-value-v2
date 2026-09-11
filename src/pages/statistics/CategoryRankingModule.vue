<script setup lang="ts">
/**
 * 统计模块 - 分类支出排行（2.12.0）
 * 横向柱状：按支出金额降序，前 6 个分类 + 剩余合并「其他」行（占比合计 100%）。
 * 每行=分类图标 + 名称 + 金额 + 占比 + 横向柱条。用 HTML/CSS 横向条实现（更易读、无横向溢出），
 * 不使用 ECharts；底部摘要：分类数量 / 本月总支出。
 */
defineOptions({ name: 'CategoryRankingModule' });
import { computed } from 'vue';
import { DVCard } from '@/components/design';
import { useCategoryStore } from '@/core/store/category';
import type { Bill, Category } from '@/core/models/types';
import { computeCategoryRanking } from './statistics-modules';
import DVCategoryIcon from '@/components/category/DVCategoryIcon.vue';

const categoryStore = useCategoryStore();

const props = defineProps<{
  bills: Bill[];
  activeYm: string;
  today: string;
  monthLabel: string;
}>();

const data = computed(() =>
  computeCategoryRanking(props.bills, props.activeYm, props.today),
);

/** 榜首位金额 = 柱条满宽的基准 */
const maxAmount = computed(() => data.value.rows[0]?.amount ?? 0);

function catFor(row: { categoryId: string; title: string; emoji: string }): Category {
  return categoryStore.byId(row.categoryId) ?? {
    id: row.categoryId,
    name: row.title,
    emoji: row.emoji,
    builtin: false,
    sort: 0,
  };
}
function barWidth(amount: number): string {
  if (maxAmount.value <= 0) return '0%';
  const pct = Math.min(100, (amount / maxAmount.value) * 100);
  return `${Math.max(4, pct)}%`;
}
</script>

<template>
  <DVCard class="stats-module" outlined>
    <div class="stats-module__head">
      <h3 class="stats-module__title">分类支出排行</h3>
      <span class="stats-module__range">{{ monthLabel }}</span>
    </div>
    <div v-if="data.hasData" class="stats-module__body stats-rank">
      <ul class="stats-rank__list">
        <li
          v-for="(row, i) in data.rows"
          :key="row.categoryId"
          class="stats-rank__row"
        >
          <span class="stats-rank__idx">{{ i + 1 }}</span>
          <span v-if="!row.isOther" class="stats-rank__icon">
            <DVCategoryIcon :category="catFor(row)" :size="18" />
          </span>
          <span v-else class="stats-rank__icon is-other">⋯</span>
          <div class="stats-rank__mid">
            <div class="stats-rank__top">
              <span class="stats-rank__name">{{ row.title }}</span>
              <span class="stats-rank__amt">¥ {{ row.amount.toFixed(2) }}</span>
              <span class="stats-rank__pct">{{ row.percent }}%</span>
            </div>
            <div class="stats-rank__bar">
              <div class="stats-rank__fill" :style="{ width: barWidth(row.amount) }" />
            </div>
          </div>
        </li>
      </ul>
    </div>
    <p v-else class="stats-module__empty">当前时间范围暂无数据</p>
    <div v-if="data.hasData" class="stats-module__foot">
      <span class="stats-module__metric">
        <b>分类数量</b><em>{{ data.categoryCount }} 类</em>
      </span>
      <span class="stats-module__metric">
        <b>本月总支出</b><em>¥ {{ data.total.toFixed(2) }}</em>
      </span>
    </div>
  </DVCard>
</template>

<style scoped>
.stats-module {
  padding: var(--dv-space-md);
}
.stats-module__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--dv-space-sm);
  margin-bottom: var(--dv-space-sm);
}
.stats-module__title {
  font-size: 15px;
  font-weight: 600;
  color: var(--dv-on-surface);
}
.stats-module__range {
  flex-shrink: 0;
  font-size: 12px;
  color: var(--dv-on-surface-variant);
  white-space: nowrap;
}
.stats-rank__list {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: var(--dv-space-sm);
}
.stats-rank__row {
  display: flex;
  align-items: center;
  gap: var(--dv-space-xs);
}
.stats-rank__idx {
  flex-shrink: 0;
  width: 16px;
  text-align: center;
  font-size: 12px;
  font-weight: 600;
  color: var(--dv-on-surface-variant);
  font-variant-numeric: tabular-nums;
}
.stats-rank__icon {
  flex-shrink: 0;
  width: 24px;
  height: 24px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.stats-rank__icon.is-other {
  font-size: 15px;
  color: var(--dv-on-surface-variant);
}
.stats-rank__mid {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.stats-rank__top {
  min-width: 0;
  display: flex;
  align-items: baseline;
  gap: var(--dv-space-xs);
}
.stats-rank__name {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  color: var(--dv-on-surface);
}
.stats-rank__amt {
  flex-shrink: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--dv-on-surface);
  font-variant-numeric: tabular-nums;
}
.stats-rank__pct {
  flex-shrink: 0;
  min-width: 42px;
  text-align: right;
  font-size: 12px;
  color: var(--dv-on-surface-variant);
  font-variant-numeric: tabular-nums;
}
.stats-rank__bar {
  height: 6px;
  border-radius: var(--dv-radius-pill);
  background: var(--dv-surface-alt);
  overflow: hidden;
}
.stats-rank__fill {
  height: 100%;
  border-radius: var(--dv-radius-pill);
  background: var(--dv-primary);
}
.stats-module__empty {
  padding: var(--dv-space-xl) 0;
  text-align: center;
  color: var(--dv-on-surface-variant);
  font-size: 13px;
}
.stats-module__foot {
  display: flex;
  align-items: center;
  gap: var(--dv-space-xs);
  margin-top: var(--dv-space-sm);
  padding-top: var(--dv-space-sm);
  border-top: 1px solid var(--dv-surface-border);
}
.stats-module__metric {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.stats-module__metric b {
  font-size: 11px;
  font-weight: 400;
  color: var(--dv-on-surface-variant);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.stats-module__metric em {
  font-style: normal;
  font-size: 13px;
  font-weight: 600;
  color: var(--dv-on-surface);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>