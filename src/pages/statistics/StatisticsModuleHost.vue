<script setup lang="ts">
/**
 * 统计模块 Host（2.12.0）—「我的统计模块」区
 * - 单列纵向渲染已启用模块（按目录顺序，禁止随操作先后变序）。
 * - 默认 4 个模块全开；「＋ 添加 / 管理」打开 DVSheet 开关式增删。
 * - 空态：没有启用任何模块时显示轻量「＋ 添加统计模块」入口。
 * - 切走统计页（KeepAlive 失活）时关闭管理 Sheet，避免子弹层跨页残留。
 */
defineOptions({ name: 'StatisticsModuleHost' });
import { computed, ref, onDeactivated } from 'vue';
import { DVSheet, toast } from '@/components/design';
import type { Bill } from '@/core/models/types';
import type { StatisticsModuleId } from './statistics-module-types';
import { STATISTICS_MODULES } from './statistics-module-types';
import { useSettingsStore } from '@/core/store/settings';
import DailyExpenseTrendModule from './DailyExpenseTrendModule.vue';
import IncomeExpenseCompareModule from './IncomeExpenseCompareModule.vue';
import CategoryRankingModule from './CategoryRankingModule.vue';
import CumulativeExpenseModule from './CumulativeExpenseModule.vue';

// 模块 id → 组件映射（后续扩展模块只需在此登记）
const MODULE_COMPONENTS: Record<StatisticsModuleId, unknown> = {
  'daily-expense-trend': DailyExpenseTrendModule,
  'income-expense-compare': IncomeExpenseCompareModule,
  'category-ranking': CategoryRankingModule,
  'cumulative-expense': CumulativeExpenseModule,
};

const props = defineProps<{
  bills: Bill[];
  activeYm: string;
  today: string;
  monthLabel: string;
}>();

const settingsStore = useSettingsStore();

/** 已启用模块：按目录顺序过滤（显示顺序固定为目录顺序）；旧用户未选过（undefined）默认全开 */
const enabledIds = computed<StatisticsModuleId[]>(() => {
  const raw = settingsStore.statisticsModules;
  if (!raw) return STATISTICS_MODULES.map((m) => m.id);
  const selected = new Set(raw);
  return STATISTICS_MODULES.map((m) => m.id).filter((id) => selected.has(id));
});

const sheetOpen = ref(false);
function openSheet() {
  sheetOpen.value = true;
}
function closeSheet() {
  sheetOpen.value = false;
}
async function toggleModule(id: StatisticsModuleId) {
  const has = enabledIds.value.includes(id);
  const allIds = STATISTICS_MODULES.map((m) => m.id);
  // 2.13.2：只剩最后一个开启项时禁止关闭（保持 ON + 轻量 Toast，不弹确认框）
  if (has && enabledIds.value.length === 1) {
    toast.info('至少保留一个统计模块');
    return;
  }
  const next = has
    ? allIds.filter((mid) => mid !== id)
    : [...allIds.filter((mid) => enabledIds.value.includes(mid)), id];
  // 数据层兜底：空数组被 store 拒绝保存
  const ok = await settingsStore.setStatisticsModules(next);
  if (!ok) toast.info('至少保留一个统计模块');
}
onDeactivated(() => {
  sheetOpen.value = false;
});
</script>

<template>
  <section class="stats-modules">
    <div class="stats-modules__head">
      <h2 class="stats-modules__title">我的统计模块</h2>
      <button class="stats-modules__add" type="button" @click="openSheet">＋ 添加</button>
    </div>

    <div v-if="enabledIds.length" class="stats-modules__list">
      <component
        :is="MODULE_COMPONENTS[id]"
        v-for="id in enabledIds"
        :key="id"
        :bills="props.bills"
        :active-ym="props.activeYm"
        :today="props.today"
        :month-label="props.monthLabel"
      />
    </div>
    <button v-else class="stats-modules__empty" type="button" @click="openSheet">
      ＋ 添加统计模块
    </button>

    <!-- 模块管理 Sheet：开关式添加/移除，不做排序；关闭即回到统计页 -->
    <DVSheet v-model="sheetOpen" title="统计模块" @close="closeSheet">
      <ul class="stats-modules__manage">
        <li
          v-for="meta in STATISTICS_MODULES"
          :key="meta.id"
          class="stats-modules__option"
        >
          <div class="stats-modules__option-text">
            <span class="stats-modules__option-title">{{ meta.title }}</span>
            <span class="stats-modules__option-desc">{{ meta.desc }}</span>
          </div>
          <button
            type="button"
            class="stats-modules__switch"
            role="switch"
            :aria-checked="enabledIds.includes(meta.id)"
            :aria-label="meta.title"
            @click="toggleModule(meta.id)"
          >
            <span
              class="stats-modules__switch-track"
              :class="{ 'is-on': enabledIds.includes(meta.id) }"
            >
              <span class="stats-modules__switch-thumb" />
            </span>
          </button>
        </li>
      </ul>
      <button type="button" class="stats-modules__done" @click="closeSheet">完成</button>
    </DVSheet>
  </section>
</template>

<style scoped>
.stats-modules {
  margin-top: var(--dv-space-xs);
}
.stats-modules__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--dv-space-sm);
  margin-bottom: var(--dv-space-sm);
}
.stats-modules__title {
  font-size: 15px;
  font-weight: 600;
  color: var(--dv-on-surface);
}
.stats-modules__add {
  padding: var(--dv-space-xxs) var(--dv-space-sm);
  border-radius: var(--dv-radius-pill);
  background: var(--dv-surface);
  border: 1px solid var(--dv-outline);
  color: var(--dv-primary);
  font-size: 12px;
  transition: background-color var(--dv-motion-fast) var(--dv-ease-standard);
}
.stats-modules__add:active {
  background: var(--dv-surface-alt);
}
.stats-modules__list {
  display: flex;
  flex-direction: column;
  gap: var(--dv-space-sm);
}
.stats-modules__empty {
  width: 100%;
  padding: var(--dv-space-md);
  border-radius: var(--dv-radius-lg);
  background: var(--dv-surface);
  border: 1px dashed var(--dv-outline);
  color: var(--dv-primary);
  font-size: 13px;
  text-align: center;
}
.stats-modules__manage {
  list-style: none;
  display: flex;
  flex-direction: column;
}
.stats-modules__option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--dv-space-sm);
  padding: var(--dv-space-sm) 0;
}
.stats-modules__option + .stats-modules__option {
  border-top: 1px solid var(--dv-surface-border);
}
.stats-modules__option-text {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
}
.stats-modules__option-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--dv-on-surface);
}
.stats-modules__option-desc {
  font-size: 12px;
  color: var(--dv-on-surface-variant);
}
.stats-modules__switch {
  flex-shrink: 0;
  padding: 0;
  background: transparent;
  border: none;
}
.stats-modules__switch-track {
  position: relative;
  display: block;
  width: 40px;
  height: 24px;
  border-radius: var(--dv-radius-pill);
  background: var(--dv-outline);
  transition: background-color var(--dv-motion-fast) var(--dv-ease-standard);
}
.stats-modules__switch-track.is-on {
  background: var(--dv-primary);
}
.stats-modules__switch-thumb {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: var(--dv-on-primary);
  transition: transform var(--dv-motion-fast) var(--dv-ease-standard);
}
.stats-modules__switch-track.is-on .stats-modules__switch-thumb {
  transform: translateX(16px);
}
.stats-modules__done {
  width: 100%;
  margin-top: var(--dv-space-sm);
  padding: var(--dv-space-sm);
  border-radius: var(--dv-radius-md);
  background: var(--dv-primary);
  color: var(--dv-on-primary);
  font-size: 15px;
  font-weight: 600;
}
</style>