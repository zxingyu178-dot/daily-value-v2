<script setup lang="ts">
/**
 * DVPicker - 统一选择器（Design System）
 * type: 'options' 选项选择（分类等）| 'date' 日期选择（日历）
 * 通过内部 DVSheet 弹出。
 */
import { computed, ref } from 'vue';
import DVSheet from '@/components/design/DVSheet.vue';

defineOptions({ name: 'DVPicker' });

const props = withDefaults(
  defineProps<{
    modelValue?: string | number;
    placeholder?: string;
    type?: 'options' | 'date';
    options?: Array<{ label: string; value: string | number }>;
    disabled?: boolean;
    /** 日期范围（type=date）：起 */
    minDate?: string;
    /** 日期范围（type=date）：止 */
    maxDate?: string;
  }>(),
  {
    modelValue: undefined,
    placeholder: '请选择',
    type: 'options',
    options: () => [],
    disabled: false,
    minDate: '',
    maxDate: '',
  },
);
const emit = defineEmits<{
  'update:modelValue': [value: string | number];
  open: [];
}>();

const visible = ref(false);

/* ---- options ---- */
const selectedLabel = computed(() => {
  if (props.modelValue === undefined || props.modelValue === '') return '';
  const hit = props.options.find((o) => String(o.value) === String(props.modelValue));
  return hit ? hit.label : String(props.modelValue);
});

function selectOption(value: string | number) {
  emit('update:modelValue', value);
  visible.value = false;
}

/* ---- date 日历 ---- */
const today = new Date();
const viewYear = ref(today.getFullYear());
const viewMonth = ref(today.getMonth() + 1); // 1-12

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

function pad(n: number): string {
  return String(n).padStart(2, '0');
}
function fmt(y: number, m: number, d: number): string {
  return `${y}-${pad(m)}-${pad(d)}`;
}

const selectedDate = computed(() => (props.modelValue ? String(props.modelValue) : ''));

/** 日期是否超出 minDate / maxDate 范围（type=date 时限制可选日期） */
function isOutOfRange(date: string): boolean {
  if (props.type !== 'date') return false;
  if (props.minDate && date < props.minDate) return true;
  if (props.maxDate && date > props.maxDate) return true;
  return false;
}

function openSheet() {
  if (props.disabled) return;
  if (props.type === 'date' && selectedDate.value) {
    const [y, m] = selectedDate.value.split('-').map(Number);
    viewYear.value = y;
    viewMonth.value = m;
  }
  visible.value = true;
  emit('open');
}

/** 当月网格：前置空位 + 日期 */
const monthCells = computed<Array<{ date: string; day: number; inMonth: boolean }>>(() => {
  const firstDay = new Date(viewYear.value, viewMonth.value - 1, 1);
  const lead = firstDay.getDay();
  const daysInMonth = new Date(viewYear.value, viewMonth.value, 0).getDate();
  const cells: Array<{ date: string; day: number; inMonth: boolean }> = [];
  for (let i = 0; i < lead; i++) cells.push({ date: '', day: 0, inMonth: false });
  for (let d = 1; d <= daysInMonth; d++) cells.push({ date: fmt(viewYear.value, viewMonth.value, d), day: d, inMonth: true });
  return cells;
});

function shiftMonth(delta: number) {
  let y = viewYear.value;
  let m = viewMonth.value + delta;
  if (m < 1) { m = 12; y--; }
  if (m > 12) { m = 1; y++; }
  viewYear.value = y;
  viewMonth.value = m;
}

function selectDate(date: string) {
  if (isOutOfRange(date)) return;
  emit('update:modelValue', date);
  visible.value = false;
}
</script>

<template>
  <button
    class="dv-picker"
    :class="{ 'dv-picker--disabled': disabled }"
    type="button"
    @click="openSheet"
  >
    <span class="dv-picker__value" :class="{ 'is-empty': !modelValue && !selectedLabel }">
      <slot name="value">{{ type === 'date' ? selectedDate || placeholder : selectedLabel || placeholder }}</slot>
    </span>
    <span class="dv-picker__arrow">▾</span>
  </button>

  <DVSheet v-model="visible" :title="type === 'date' ? '选择日期' : '请选择'">
    <!-- 选项列表 -->
    <div v-if="type === 'options'" class="dv-picker__options">
      <button
        v-for="opt in options"
        :key="String(opt.value)"
        class="dv-picker__option"
        :class="{ 'is-active': String(opt.value) === String(modelValue) }"
        @click="selectOption(opt.value)"
      >
        <span>{{ opt.label }}</span>
      </button>
      <p v-if="options.length === 0" class="dv-picker__empty">暂无选项</p>
    </div>

    <!-- 日期日历 -->
    <div v-else class="dv-picker__calendar">
      <div class="dv-picker__cal-head">
        <button class="dv-picker__cal-nav" aria-label="上一月" @click="shiftMonth(-1)">‹</button>
        <span class="dv-picker__cal-title">{{ viewYear }}年{{ viewMonth }}月</span>
        <button class="dv-picker__cal-nav" aria-label="下一月" @click="shiftMonth(1)">›</button>
      </div>
      <div class="dv-picker__cal-week">
        <span v-for="w in WEEKDAYS" :key="w" class="dv-picker__cal-weekday">{{ w }}</span>
      </div>
      <div class="dv-picker__cal-grid">
        <span
          v-for="(cell, i) in monthCells"
          :key="i"
          class="dv-picker__cal-cell"
          :data-date="cell.date || undefined"
          :class="{
            'is-empty': !cell.inMonth,
            'is-selected': cell.inMonth && cell.date === selectedDate,
            'is-disabled': cell.inMonth && isOutOfRange(cell.date),
          }"
          @click="cell.inMonth && !isOutOfRange(cell.date) && selectDate(cell.date)"
        >
          {{ cell.inMonth ? cell.day : '' }}
        </span>
      </div>
    </div>
  </DVSheet>
</template>

<style scoped>
.dv-picker {
  display: inline-flex;
  align-items: center;
  gap: var(--dv-space-xs);
  height: 44px;
  padding: 0 var(--dv-space-sm);
  border: 1px solid var(--dv-outline);
  border-radius: var(--dv-radius-md);
  background: var(--dv-surface-alt);
  color: var(--dv-on-surface);
  font-size: 14px;
  width: 100%;
  justify-content: space-between;
}
.dv-picker__value.is-empty {
  color: var(--dv-on-surface-variant);
}
.dv-picker__arrow {
  color: var(--dv-on-surface-variant);
  font-size: 12px;
}
.dv-picker--disabled {
  opacity: 0.5;
}
/* options */
.dv-picker__options {
  display: flex;
  flex-direction: column;
  gap: var(--dv-space-xs);
}
.dv-picker__option {
  display: flex;
  align-items: center;
  padding: var(--dv-space-sm) var(--dv-space-sm);
  border-radius: var(--dv-radius-md);
  font-size: 15px;
  color: var(--dv-on-surface);
  text-align: left;
}
.dv-picker__option.is-active {
  background: var(--dv-primary-soft);
  color: var(--dv-primary);
  font-weight: 600;
}
.dv-picker__empty {
  color: var(--dv-on-surface-variant);
  text-align: center;
  padding: var(--dv-space-lg) 0;
}
/* calendar */
.dv-picker__cal-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--dv-space-sm);
}
.dv-picker__cal-title {
  font-weight: 600;
}
.dv-picker__cal-nav {
  width: 32px;
  height: 32px;
  border-radius: var(--dv-radius-pill);
  color: var(--dv-on-surface);
  font-size: 18px;
}
.dv-picker__cal-week,
.dv-picker__cal-grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
}
.dv-picker__cal-weekday {
  text-align: center;
  font-size: 12px;
  color: var(--dv-on-surface-variant);
  padding: var(--dv-space-xxs) 0;
}
.dv-picker__cal-cell {
  aspect-ratio: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  border-radius: var(--dv-radius-pill);
  color: var(--dv-on-surface);
}
.dv-picker__cal-cell.is-empty {
  color: transparent;
}
.dv-picker__cal-cell.is-selected {
  background: var(--dv-primary);
  color: var(--dv-on-primary);
  font-weight: 600;
}
.dv-picker__cal-cell.is-disabled {
  color: var(--dv-on-surface-variant);
  opacity: 0.4;
}
</style>
