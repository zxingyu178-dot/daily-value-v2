<script setup lang="ts">
/**
 * RecurringPeriodPicker — Recurring Editor 的「独立周期日期选择器」（Phase 7A-Fix3-UX）
 * 复用 Design System 的 DVWheelPicker（高度固定 H*VIEW=132px，不随父层拉伸）。
 * 主表单不再内嵌常驻滚轮，而是点击「每月日期 / 重复星期 / 每年日期」行后打开本覆盖层：
 *  - weekly：单个星期滚轮（7 项，一次见 3 项）
 *  - monthly：单个日期滚轮（1..31，一次见 3 项，不露完整 31 项）
 *  - yearly：月 + 日 两个滚轮左右并排（1..12 / 1..31）
 *  - 中央选择线 / 上下渐弱 / scroll-snap 由 DVWheelPicker 自带
 *  - 确定才写回 Form；取消不改 Form；Android Back 先关闭 Picker（LIFO）
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import DVWheelPicker from '@/components/design/DVWheelPicker.vue';
import { registerOverlayForBack, unregisterOverlayForBack } from '@/components/design/back-handler';

export type PeriodFreq = 'weekly' | 'monthly' | 'yearly';

export interface PeriodValue {
  day: number; // weekly: weekday 0-6；monthly/yearly: day of month 1-31
  month?: number; // yearly: 1-12
}

const props = withDefaults(
  defineProps<{
    visible: boolean;
    frequency: PeriodFreq;
    day: number;
    month?: number;
  }>(),
  { month: 1 },
);
const emit = defineEmits<{
  close: [];
  change: [value: PeriodValue];
}>();

const weekdayLabels = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

const weekdayOptions = computed(() => weekdayLabels.map((label, i) => ({ label, value: i })));
const dayOptions = computed(() => {
  const list: Array<{ label: string; value: number }> = [];
  for (let d = 1; d <= 31; d++) list.push({ label: `${d} 日`, value: d });
  return list;
});
const monthOptions = computed(() => {
  const list: Array<{ label: string; value: number }> = [];
  for (let m = 1; m <= 12; m++) list.push({ label: `${m} 月`, value: m });
  return list;
});

const title = computed(() =>
  props.frequency === 'weekly'
    ? '选择重复星期'
    : props.frequency === 'monthly'
      ? '选择每月日期'
      : '选择每年日期',
);

// 局部草稿值：打开时从父层同步，确认后才 emit，取消不改父层
const draftDay = ref(1);
const draftMonth = ref(1);

function close() {
  emit('close');
}
function confirm() {
  emit('change', {
    day: draftDay.value,
    month: props.frequency === 'yearly' ? draftMonth.value : undefined,
  });
  close();
}

watch(
  () => props.visible,
  (on) => {
    if (on) {
      draftDay.value = props.day;
      draftMonth.value = props.month ?? 1;
      registerOverlayForBack(close);
    } else {
      unregisterOverlayForBack(close);
    }
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  void unregisterOverlayForBack(close);
});
</script>

<template>
  <Teleport to="body">
    <Transition name="dv-picker">
      <div v-if="visible" class="rpp" role="dialog" aria-modal="true" :aria-label="title">
        <div class="rpp__mask" @click="close" />
        <div class="rpp__panel">
          <header class="rpp__head">
            <span>{{ title }}</span>
            <button class="rpp__close" type="button" aria-label="关闭" @click="close">✕</button>
          </header>

          <!-- 每周：重复星期（星期滚轮） -->
          <div v-if="frequency === 'weekly'" class="rpp__row">
            <DVWheelPicker
              :model-value="draftDay"
              :options="weekdayOptions"
              aria-label="重复星期"
              @update:model-value="draftDay = $event"
            />
          </div>

          <!-- 每月：日期滚轮（1..31，不露完整 31 项） -->
          <div v-else-if="frequency === 'monthly'" class="rpp__row">
            <DVWheelPicker
              :model-value="draftDay"
              :options="dayOptions"
              aria-label="每月日期"
              @update:model-value="draftDay = $event"
            />
          </div>

          <!-- 每年：月 + 日 双滚轮左右并排（禁止纵向堆叠） -->
          <div v-else class="rpp__row rpp__row--double">
            <DVWheelPicker
              :model-value="draftMonth"
              :options="monthOptions"
              aria-label="月份"
              @update:model-value="draftMonth = $event"
            />
            <DVWheelPicker
              :model-value="draftDay"
              :options="dayOptions"
              aria-label="日期"
              @update:model-value="draftDay = $event"
            />
          </div>

          <div class="rpp__actions">
            <button class="rpp__cancel" type="button" @click="close">取消</button>
            <button class="rpp__ok" type="button" @click="confirm">确定</button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.rpp {
  position: fixed;
  inset: 0;
  z-index: var(--dv-z-picker);
  display: flex;
  align-items: center;
  justify-content: center;
}
.rpp__mask {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
}
.rpp__panel {
  position: relative;
  width: min(86vw, 400px);
  background: var(--dv-surface);
  border-radius: var(--dv-radius-lg);
  padding: var(--dv-space-md) var(--dv-space-md) calc(var(--dv-space-md) + var(--dv-safe-bottom));
}
.rpp__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 16px;
  font-weight: 600;
  margin-bottom: var(--dv-space-sm);
}
.rpp__close {
  color: var(--dv-on-surface-variant);
  font-size: 16px;
}
/* 滚轮行：横向排列；DVWheelPicker 自带固定高度(44*3=132px)，不受父层拉伸 */
.rpp__row {
  display: flex;
  gap: var(--dv-space-sm);
}
.rpp__row > * {
  flex: 1;
  min-width: 0;
}
.rpp__actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--dv-space-sm);
  margin-top: var(--dv-space-sm);
}
.rpp__cancel {
  padding: var(--dv-space-xs) var(--dv-space-md);
  border-radius: var(--dv-radius-pill);
  background: var(--dv-surface-alt);
  color: var(--dv-on-surface-variant);
  font-size: 14px;
}
.rpp__ok {
  padding: var(--dv-space-xs) var(--dv-space-md);
  border-radius: var(--dv-radius-pill);
  background: var(--dv-primary);
  color: var(--dv-on-primary);
  font-size: 14px;
  font-weight: 600;
}
</style>