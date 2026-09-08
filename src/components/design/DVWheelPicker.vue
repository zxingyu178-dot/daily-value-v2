<script setup lang="ts">
/**
 * DVWheelPicker - 通用纵向滚轮（Design System，重建 v1 统一 WheelPicker）
 * 特性：
 * - 纵向拖动 + 惯性滚动（原生 overflow-y）
 * - scroll-snap 停止后自动吸附到有效项
 * - 中央选中区 + 上下项目渐弱（mask-image + 透明度）
 * - 点击附近项目也可定位（scrollTo smooth）
 * - 滚动过程中不误触外部（touchmove.stop.prevent，避免带动整个 Sheet）
 * 复用约定：后续编辑账单/日价日期等都用本组件，不再复制多套实现。
 */
import { computed, onMounted, ref, watch } from 'vue';

defineOptions({ name: 'DVWheelPicker' });

export interface WheelOption {
  label: string;
  value: number;
}

const props = withDefaults(
  defineProps<{
    modelValue: number;
    options: ReadonlyArray<WheelOption>;
    /** 单项高度（px，默认 44） */
    itemHeight?: number;
    /** 是否禁用项（返回 true 的 value 不可选，仅展示） */
    isDisabled?: (value: number) => boolean;
    ariaLabel?: string;
  }>(),
  {
    itemHeight: 44,
    isDisabled: () => false,
    ariaLabel: '滚轮选择',
  },
);
const emit = defineEmits<{ 'update:modelValue': [value: number]; change: [value: number] }>();

const ITEM = 44;
const H = computed(() => props.itemHeight || ITEM);
/** 可视窗口展示 3 项 */ 
const VIEW = 3;

const scroller = ref<HTMLElement | null>(null);
const activeIndex = ref(props.options.findIndex((o) => o.value === props.modelValue));
if (activeIndex.value < 0) activeIndex.value = 0;

/** 中央项在数据中的下标（scrollTop / H） */
const selectedIndex = computed(() => Math.round(activeIndex.value));

/** 由 value 反查是否禁用 */
function indexLocked(i: number): boolean {
  return props.isDisabled(props.options[i]?.value ?? NaN);
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/** 滚动到指定下标居中 */
function scrollToIndex(i: number, smooth = false) {
  const el = scroller.value;
  if (!el) return;
  // paddingTop 已把第 0 项推到中央：index i 居中所需 scrollTop = i * H
  const target = clamp(i * H.value, 0, (props.options.length - 1) * H.value);
  if (typeof el.scrollTo === 'function') {
    el.scrollTo({ top: target, behavior: smooth ? 'smooth' : 'auto' });
  } else {
    // 非浏览器环境（jsdom 单测）无 scrollTo，直接赋值 scrollTop
    el.scrollTop = target;
  }
}

function onScroll() {
  const el = scroller.value;
  if (!el) return;
  const idx = Math.round(el.scrollTop / H.value);
  const next = clamp(idx, 0, props.options.length - 1);
  if (next === selectedIndex.value) return;
  if (indexLocked(next)) {
    // 禁用项不能成为选中的静止项：吸附到最近合法项（视觉同步校正 + 发出该值）
    const target = nearestSelectable(next);
    activeIndex.value = target;
    if (target !== next) {
      // 直接校正 scrollTop（同步更新避免再触发一轮滚动事件），滚动停在最近可选项
      el.scrollTop = target * H.value;
    }
    const opt = props.options[target];
    if (opt) {
      emit('update:modelValue', opt.value);
      emit('change', opt.value);
    }
    return;
  }
  activeIndex.value = next;
  const opt = props.options[next];
  emit('update:modelValue', opt.value);
  emit('change', opt.value);
}

/** 点击附近的项目定位（smooth） */
function onClickItem(i: number) {
  if (indexLocked(i)) return;
  scrollToIndex(i, true);
}

watch(
  () => props.modelValue,
  (v) => {
    const i = props.options.findIndex((o) => o.value === v);
    if (i >= 0 && i !== selectedIndex.value) {
      activeIndex.value = i;
      scrollToIndex(i);
    }
  },
);

onMounted(() => {
  const i = props.options.findIndex((o) => o.value === props.modelValue);
  if (i >= 0) {
    activeIndex.value = i;
    scrollToIndex(i);
  }
});

/** 供上层主动滚动到禁用区附近时跳过锁定项：返回最近可选下标 */
function nearestSelectable(index: number): number {
  const n = props.options.length;
  for (let step = 0; step < n; step++) {
    for (const cand of [index + step, index - step]) {
      if (cand >= 0 && cand < n && !indexLocked(cand)) return cand;
    }
  }
  return 0;
}
defineExpose({ nearestSelectable, scrollToIndex });
</script>

<template>
  <div
    class="dv-wheel"
    :style="{
      '--dv-wheel-h': H + 'px',
      '--dv-wheel-view': VIEW + 'px',
      height: H * VIEW + 'px',
    }"
    :aria-label="ariaLabel"
  >
    <div
      ref="scroller"
      class="dv-wheel__scroller"
      tabindex="0"
      @scroll.passive="onScroll"
      @touchmove.stop
    >
      <div
        v-for="(opt, i) in options"
        :key="opt.value"
        class="dv-wheel__item"
        :class="{
          'is-center': i === selectedIndex,
          'is-disabled': indexLocked(i),
        }"
        :style="{ ['--dv-wheel-pos' as string]: Math.abs(i - selectedIndex) }"
        @click="onClickItem(i)"
      >
        <span class="dv-wheel__label">{{ opt.label }}</span>
      </div>
    </div>
    <!-- 中央选择线 -->
    <div class="dv-wheel__sel" />
  </div>
</template>

<style scoped>
.dv-wheel {
  position: relative;
  display: flex;
  flex-direction: column;
  justify-content: center;
  overflow: hidden;
  min-width: 0;
}
/* 上下渐弱遮罩（视觉上中央增强、上下渐隐） */
.dv-wheel::before,
.dv-wheel::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  height: var(--dv-wheel-h);
  z-index: 2;
  pointer-events: none;
}
.dv-wheel::before {
  top: 0;
  background: linear-gradient(to bottom, var(--dv-surface-alt), transparent);
}
.dv-wheel::after {
  bottom: 0;
  background: linear-gradient(to top, var(--dv-surface-alt), transparent);
}
.dv-wheel__scroller {
  height: 100%;
  overflow-y: auto;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
  touch-action: pan-y;
  scroll-snap-type: y mandatory;
  scrollbar-width: none;
  -ms-overflow-style: none;
  outline: none;
}
.dv-wheel__scroller::-webkit-scrollbar {
  display: none;
}
/* paddingTop = paddingBottom = H，使第 0 项与最后一项都能居中 */
.dv-wheel__scroller {
  padding-top: var(--dv-wheel-h);
  padding-bottom: var(--dv-wheel-h);
}
.dv-wheel__item {
  height: var(--dv-wheel-h);
  display: flex;
  align-items: center;
  justify-content: center;
  scroll-snap-align: center;
  transition:
    color var(--dv-motion-fast) var(--dv-ease-standard),
    font-weight var(--dv-motion-fast) var(--dv-ease-standard);
  color: var(--dv-on-surface-variant);
  -webkit-user-select: none;
  user-select: none;
}
.dv-wheel__item.is-center {
  color: var(--dv-on-surface);
  font-weight: 700;
}
.dv-wheel__item.is-disabled {
  opacity: 0.35;
}
.dv-wheel__label {
  font-size: 18px;
  font-variant-numeric: tabular-nums;
}
/* 中央选择线（固定于容器中央） */
.dv-wheel__sel {
  position: absolute;
  left: 0;
  right: 0;
  top: 50%;
  height: var(--dv-wheel-h);
  transform: translateY(-50%);
  border-top: 1px solid var(--dv-outline);
  border-bottom: 1px solid var(--dv-outline);
  z-index: 1;
  pointer-events: none;
  background: color-mix(in srgb, var(--dv-surface-alt) 30%, transparent);
}
</style>