<script setup lang="ts">
/**
 * DVDateTimeWheelPicker - 统一日期时间滚轮选择器（Design System）
 * - 日期：年 / 月 / 日 三个独立滚轮（一排三个）
 * - 时间：时 / 分 两个独立滚轮（一排两个），分钟按 1 分钟选择
 * - 只配置日期模式（showTime=false）时隐藏时分，供日价等仅日期场景复用
 * - 闰年动态处理：2 月按年份计算 28/29
 * - maxDateTime：不允许选择未来本地时间（滚到今天时未来小时/分钟同样禁用）
 * - 停止滚动后 snap 到有效项（scroll-snap + 吸附）
 * - 层级：Picker 恒在 Sheet 之上（--dv-z-picker）
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import DVWheelPicker from '@/components/design/DVWheelPicker.vue';
import { registerOverlayForBack, unregisterOverlayForBack } from '@/components/design/back-handler';

defineOptions({ name: 'DVDateTimeWheelPicker' });

export interface DateTimeValue {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number; // 0-23
  minute: number; // 0-59
}

const props = withDefaults(
  defineProps<{
    modelValue: DateTimeValue;
    /** 是否显示时间（时/分）。仅日期场景（如日价）可关闭 */
    showTime?: boolean;
    /** 是否允许未来（默认 false：maxDateTime = 当前本地时间） */
    allowFuture?: boolean;
    /** 允许的最新年份（往前可无限，默认取当前年份） */
    maxYear?: number;
    /** 允许的最旧年份（默认 2000；业务如需更早的旧账单日期可下调） */
    minYear?: number;
    visible: boolean;
  }>(),
  {
    showTime: true,
    allowFuture: false,
    maxYear: 0,
    minYear: 2000,
    visible: false,
  },
);
const emit = defineEmits<{
  'update:modelValue': [value: DateTimeValue];
  close: [];
}>();

/* ---- 当前本地时间基准 ---- */
const now = ref(new Date());
const curYear = computed(() => now.value.getFullYear());
/** 年份滚轮上限：显式 maxYear 优先；
 *  allowFuture=true 且未传 maxYear 时放宽到当前年 +5（否则未来年份滚不到）；
 *  默认（禁止未来）卡在当前年。 */
const MAX_YEAR = computed(() => {
  if (props.maxYear) return props.maxYear;
  return props.allowFuture ? curYear.value + 5 : curYear.value;
});
/**
 * 有效最旧年份（P2-1）：默认 minYear=2000 可能不含历史账单年份（如 1998）。
 * 动态下限同时包含 modelValue 的年份，确保旧账单编辑时其年份一定出现在滚轮选项里，
 * 而不被 hardcode 的业务下限“切断”。
 */
const effectiveMinYear = computed(() => Math.min(props.minYear, value.value.year));

/* ---- 各滚轮数据 ---- */
const years = computed(() => {
  // 上限再并入当前已选年份：编辑已有未来规则时（年份可能超出 +5 放宽范围）其年份一定出现在滚轮里
  const maxY = Math.max(MAX_YEAR.value, value.value.year);
  const list: Array<{ label: string; value: number }> = [];
  for (let y = effectiveMinYear.value; y <= maxY; y++) list.push({ label: String(y), value: y });
  return list;
});
const months = computed(() => {
  const list: Array<{ label: string; value: number }> = [];
  for (let m = 1; m <= 12; m++) list.push({ label: String(m), value: m });
  return list;
});
/** 日：按当前年月动态 28/29/30/31（闰年 2 月 = 29） */
const days = computed(() => {
  const y = value.value.year;
  const m = value.value.month;
  const last = new Date(y, m, 0).getDate();
  const list: Array<{ label: string; value: number }> = [];
  for (let d = 1; d <= last; d++) list.push({ label: String(d), value: d });
  return list;
});
const hours = computed(() => {
  const list: Array<{ label: string; value: number }> = [];
  for (let h = 0; h <= 23; h++) list.push({ label: String(h), value: h });
  return list;
});
const minutes = computed(() => {
  const list: Array<{ label: string; value: number }> = [];
  for (let m = 0; m <= 59; m++) list.push({ label: String(m), value: m });
  return list;
});

/* ---- 当前值 ---- */
const value = ref<DateTimeValue>({ ...props.modelValue });

/* ---- 未来时间禁用 ---- */
function isFutureDate(y: number, m: number, d: number): boolean {
  if (props.allowFuture) return false;
  return y > curYear.value ||
    (y === curYear.value && m > now.value.getMonth() + 1) ||
    (y === curYear.value && m === now.value.getMonth() + 1 && d > now.value.getDate());
}
function isFutureTime(h: number, min: number): boolean {
  if (props.allowFuture) return false;
  const sameDay =
    value.value.year === curYear.value &&
    value.value.month === now.value.getMonth() + 1 &&
    value.value.day === now.value.getDate();
  if (!sameDay) return false;
  return h > now.value.getHours() || (h === now.value.getHours() && min > now.value.getMinutes());
}
function isFutureCombined(): boolean {
  if (isFutureDate(value.value.year, value.value.month, value.value.day)) return true;
  if (props.showTime && isFutureTime(value.value.hour, value.value.minute)) return true;
  return false;
}

/* ---- 未来项禁用谓词（传给各滚轮的 :is-disabled，防止未来项成为选中/停留项）----
 * 规则：未来年份 disabled；今年未来月份 disabled；本月未来日期 disabled；
 *       今天未来小时 disabled；当前小时未来分钟 disabled。
 * 依赖当前已选 value，因此切换年月后会联动刷新各列的禁用范围。 */
const nowMonth = computed(() => now.value.getMonth() + 1);
const nowDay = computed(() => now.value.getDate());
// allowFuture=true 时全部解除“禁止未来”；false 保持原禁止逻辑（普通记账日期场景不受影响）
const yearDisabled = (v: number) => (props.allowFuture ? false : v > curYear.value);
const monthDisabled = (v: number) =>
  props.allowFuture ? false : value.value.year === curYear.value && v > nowMonth.value;
const dayDisabled = (v: number) =>
  props.allowFuture
    ? false
    : value.value.year === curYear.value && value.value.month === nowMonth.value && v > nowDay.value;
// 时/分禁用已走 isFutureTime（内部已按 allowFuture 直接放行），无需重复判断
const hourDisabled = (v: number) => isFutureTime(v, value.value.minute);
const minuteDisabled = (v: number) => isFutureTime(value.value.hour, v);

/* ---- 局部状态（避免直接改 props） ---- */
const year = computed<number>(() => value.value.year);
const month = computed<number>(() => value.value.month);
const day = computed<number>(() => value.value.day);
const hour = computed<number>(() => value.value.hour);
const minute = computed<number>(() => value.value.minute);

/* ---- 更新：自动裁剪非法日（如 2-31 → 2-29）与未来时间 ---- */
function setDate(patch: Partial<DateTimeValue>) {
  let y = patch.year ?? value.value.year;
  let m = patch.month ?? value.value.month;
  let d = patch.day ?? value.value.day;
  // 动态裁剪日：若目标月天数不足，取当月最后一天
  const last = new Date(y, m, 0).getDate();
  if (d > last) d = last;
  const base = { ...value.value, year: y, month: m, day: d };
  value.value = clampToNow(base);
}
function setTime(patch: Partial<DateTimeValue>) {
  const base = { ...value.value, ...patch };
  value.value = clampToNow(base);
}
/** 把可能超出的未来本地时间钳制到当前本地时间 */
function clampToNow(b: DateTimeValue): DateTimeValue {
  if (props.allowFuture) return b;
  const maxNow = new Date(now.value.getFullYear(), now.value.getMonth(), now.value.getDate(), now.value.getHours(), now.value.getMinutes());
  const candidate = new Date(b.year, b.month - 1, b.day, b.hour, b.minute);
  if (candidate.getTime() > maxNow.getTime()) {
    return {
      year: now.value.getFullYear(),
      month: now.value.getMonth() + 1,
      day: now.value.getDate(),
      hour: now.value.getHours(),
      minute: now.value.getMinutes(),
    };
  }
  return b;
}

/* ---- 对外：确定 / 取消 ---- */
function confirm() {
  const final = isFutureCombined() ? clampToNow(value.value) : value.value;
  emit('update:modelValue', { ...final });
  close();
}
function close() {
  emit('close');
}

/* ---- Android 返回键：Picker 打开时优先关闭 Picker ---- */
watch(
  () => props.visible,
  (on) => {
    if (on) registerOverlayForBack(close);
    else unregisterOverlayForBack(close);
  },
);

/* ---- 修旧时间/旧值：每次打开重新读取 modelValue 与当前本地时间 ---- */
watch(
  () => props.visible,
  (on) => {
    if (on) {
      value.value = { ...props.modelValue };
      now.value = new Date();
    }
  },
);

/* ---- 父层外部修改 modelValue 时同步内部状态 ---- */
watch(
  () => props.modelValue,
  (v) => {
    value.value = { ...v };
  },
  { deep: true },
);

/* ---- 卸载清理：若 Picker 在打开时被直接路由切换/父组件卸载，
       必须从全局 backStack 移除 close，避免残留 stale 回调导致后续按 Back 误触已不存在的组件 ---- */
onBeforeUnmount(() => {
  void unregisterOverlayForBack(close);
});
</script>

<template>
  <Teleport to="body">
    <Transition name="dv-picker">
      <div v-if="visible" class="dv-dtp" role="dialog" aria-modal="true" aria-label="选择日期时间">
        <div class="dv-dtp__mask" @click="close" />
        <div class="dv-dtp__panel">
          <header class="dv-dtp__head">
            <span>{{ showTime ? '选择日期时间' : '选择日期' }}</span>
            <button class="dv-dtp__close" type="button" aria-label="关闭" @click="close">✕</button>
          </header>

          <div class="dv-dtp__group" :class="{ 'dv-dtp__group--only-date': !showTime }">
            <div class="dv-dtp__row dv-dtp__row--date">
              <DVWheelPicker
                :model-value="year"
                :options="years"
                :is-disabled="yearDisabled"
                aria-label="年份"
                @update:model-value="(v: number) => setDate({ year: v })"
              />
              <DVWheelPicker
                :model-value="month"
                :options="months"
                :is-disabled="monthDisabled"
                aria-label="月份"
                @update:model-value="(v: number) => setDate({ month: v })"
              />
              <DVWheelPicker
                :model-value="day"
                :options="days"
                :is-disabled="dayDisabled"
                aria-label="日"
                @update:model-value="(v: number) => setDate({ day: v })"
              />
            </div>
            <div class="dv-dtp__unit dv-dtp__unit--date">
              <span>年</span>
              <span>月</span>
              <span>日</span>
            </div>
          </div>

          <template v-if="showTime">
            <div class="dv-dtp__group">
              <div class="dv-dtp__row dv-dtp__row--time">
                <DVWheelPicker
                  :model-value="hour"
                  :options="hours"
                  :is-disabled="hourDisabled"
                  aria-label="小时"
                  @update:model-value="(v: number) => setTime({ hour: v })"
                />
                <DVWheelPicker
                  :model-value="minute"
                  :options="minutes"
                  :is-disabled="minuteDisabled"
                  aria-label="分钟"
                  @update:model-value="(v: number) => setTime({ minute: v })"
                />
              </div>
              <div class="dv-dtp__unit dv-dtp__unit--time">
                <span>时</span>
                <span>分</span>
              </div>
            </div>
          </template>

          <div class="dv-dtp__actions">
            <button class="dv-dtp__cancel" type="button" @click="close">取消</button>
            <button class="dv-dtp__ok" type="button" @click="confirm">确定</button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.dv-dtp {
  position: fixed;
  inset: 0;
  z-index: var(--dv-z-picker);
  display: flex;
  align-items: center;
  justify-content: center;
}
.dv-dtp__mask {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
}
.dv-dtp__panel {
  position: relative;
  width: min(88vw, 420px);
  max-height: 86dvh;
  overflow-y: auto;
  background: var(--dv-surface);
  border-radius: var(--dv-radius-lg);
  padding: var(--dv-space-md) var(--dv-space-md) calc(var(--dv-space-md) + var(--dv-safe-bottom));
}
.dv-dtp__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 16px;
  font-weight: 600;
  margin-bottom: var(--dv-space-sm);
}
.dv-dtp__close {
  color: var(--dv-on-surface-variant);
  font-size: 16px;
}
.dv-dtp__group {
  display: flex;
  flex-direction: column;
  gap: var(--dv-space-xxs);
  margin-bottom: var(--dv-space-sm);
}
.dv-dtp__row {
  display: flex;
  gap: var(--dv-space-sm);
}
.dv-dtp__row > * {
  flex: 1;
  min-width: 0;
}
.dv-dtp__unit {
  display: flex;
  gap: var(--dv-space-sm);
}
.dv-dtp__unit > span {
  flex: 1;
  text-align: center;
  font-size: 12px;
  color: var(--dv-on-surface-variant);
}
.dv-dtp__actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--dv-space-sm);
  margin-top: var(--dv-space-sm);
}
.dv-dtp__cancel {
  padding: var(--dv-space-xs) var(--dv-space-md);
  border-radius: var(--dv-radius-pill);
  background: var(--dv-surface-alt);
  color: var(--dv-on-surface-variant);
  font-size: 14px;
}
.dv-dtp__ok {
  padding: var(--dv-space-xs) var(--dv-space-md);
  border-radius: var(--dv-radius-pill);
  background: var(--dv-primary);
  color: var(--dv-on-primary);
  font-size: 14px;
  font-weight: 600;
}
.dv-picker-enter-active,
.dv-picker-leave-active {
  transition: opacity var(--dv-motion-normal) var(--dv-ease-standard);
}
.dv-picker-enter-active .dv-dtp__panel,
.dv-picker-leave-active .dv-dtp__panel {
  transition: transform var(--dv-motion-normal) var(--dv-ease-standard);
}
.dv-picker-enter-from,
.dv-picker-leave-to {
  opacity: 0;
}
.dv-picker-enter-from .dv-dtp__panel,
.dv-picker-leave-to .dv-dtp__panel {
  transform: scale(0.96);
}
</style>