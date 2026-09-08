<script setup lang="ts">
/**
 * DVSheet - 底部弹出面板（Design System）
 * - 上拉动画打开
 * - 下拉手势关闭（超过阈值触发）
 * - safe-area 底部适配
 * - Android 返回键关闭（经 back-handler 注册）
 * 供后续记账半屏弹窗等场景复用。
 */
import { ref, watch, onBeforeUnmount } from 'vue';
import { registerOverlayForBack, unregisterOverlayForBack } from '@/components/design/back-handler';

const props = withDefaults(
  defineProps<{
    modelValue: boolean;
    title?: string;
    /** 内容是否可滚动（面板内） */
    scrollable?: boolean;
    /** 面板最大高度（默认 85vh；快速记账 Sheet 可用半屏高度） */
    maxHeight?: string;
  }>(),
  { title: '', scrollable: true, maxHeight: '85vh' },
);
const emit = defineEmits<{ 'update:modelValue': [value: boolean]; close: [] }>();

function close() {
  emit('update:modelValue', false);
  emit('close');
}

/* ---- 下拉关闭手势 ---- */
const dragY = ref(0);
const dragging = ref(false);
const dragStartY = ref(0);
/** 面板元素自身 ref（避免多 Sheet 并存时 querySelector 取到错误实例） */
const panelRef = ref<HTMLElement | null>(null);

function onPointerDown(event: PointerEvent) {
  dragging.value = true;
  dragStartY.value = event.clientY;
  dragY.value = 0;
}
function onPointerMove(event: PointerEvent) {
  if (!dragging.value) return;
  const delta = event.clientY - dragStartY.value;
  dragY.value = Math.max(0, delta);
}
function onPointerUp() {
  if (!dragging.value) return;
  dragging.value = false;
  // 阈值：拖拽距离 > 120px 或超过面板高度 30% 时关闭
  const panelHeight = panelRef.value?.getBoundingClientRect().height ?? 0;
  if (dragY.value > 120 || (panelHeight > 0 && dragY.value > panelHeight * 0.3)) {
    dragY.value = 0;
    close();
  } else {
    dragY.value = 0;
  }
}

/* ---- 返回键与 body 滚动锁定 ---- */
watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      document.body.style.overflow = 'hidden';
      registerOverlayForBack(close);
    } else {
      document.body.style.overflow = '';
      unregisterOverlayForBack(close);
    }
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  document.body.style.overflow = '';
  unregisterOverlayForBack(close);
});
</script>

<template>
  <Teleport to="body">
    <Transition name="dv-sheet">
      <div v-if="modelValue" class="dv-sheet" role="dialog" aria-modal="true">
        <div class="dv-sheet__mask" @click="close" />
        <div
          ref="panelRef"
          class="dv-sheet__panel"
          :style="{ transform: `translateY(${dragY}px)`, maxHeight: props.maxHeight }"
          @pointermove="onPointerMove"
          @pointerup="onPointerUp"
          @pointerleave="onPointerUp"
        >
          <div
            class="dv-sheet__handle"
            @pointerdown="onPointerDown"
            @pointercancel="onPointerUp"
          />
          <header v-if="title" class="dv-sheet__header">
            <span class="dv-sheet__title">{{ title }}</span>
            <div class="dv-sheet__actions">
              <!-- 2.10.0：头部右侧 actions 区（如编辑账单的删除入口），不占用 Sheet 主内容高度 -->
              <slot name="actions" />
              <button class="dv-sheet__close" aria-label="关闭" @click="close">✕</button>
            </div>
          </header>
          <div class="dv-sheet__body" :class="{ 'is-scrollable': scrollable }">
            <slot />
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.dv-sheet {
  position: fixed;
  inset: 0;
  z-index: var(--dv-z-sheet);
}
.dv-sheet__mask {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
}
.dv-sheet__panel {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--dv-surface);
  border-radius: var(--dv-radius-xl) var(--dv-radius-xl) 0 0;
  padding: var(--dv-space-sm) var(--dv-space-md) calc(var(--dv-space-lg) + var(--dv-safe-bottom));
  max-height: 85vh;
  transition: transform var(--dv-motion-fast) var(--dv-ease-standard);
}
.dv-sheet__handle {
  width: 40px;
  height: 4px;
  border-radius: var(--dv-radius-pill);
  background: var(--dv-outline);
  margin: 0 auto var(--dv-space-sm);
  touch-action: none;
}
.dv-sheet__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 16px;
  font-weight: 600;
  margin-bottom: var(--dv-space-sm);
}
.dv-sheet__title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dv-sheet__actions {
  display: flex;
  align-items: center;
  gap: var(--dv-space-xs);
  flex-shrink: 0;
}
.dv-sheet__close {
  color: var(--dv-on-surface-variant);
  font-size: 16px;
}
.dv-sheet__body {
  flex: 1;
  min-height: 0;
}
/* 非 scrollable 的 body：作为 flex 列容器，让 slot 内容（如 .qe）用 flex 填满面板。
   flex 链（panel→body→内容→内部可滚区）不会像 height:100% 那样在 max-height 面板下失效，
   确保固定输入区不被裁掉。 */
.dv-sheet__body:not(.is-scrollable) {
  display: flex;
  flex-direction: column;
}
.dv-sheet__body.is-scrollable {
  overflow-y: auto;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
}
.dv-sheet-enter-active,
.dv-sheet-leave-active {
  transition: opacity var(--dv-motion-normal) var(--dv-ease-standard);
}
.dv-sheet-enter-active .dv-sheet__panel,
.dv-sheet-leave-active .dv-sheet__panel {
  transition: transform var(--dv-motion-normal) var(--dv-ease-standard);
}
.dv-sheet-enter-from,
.dv-sheet-leave-to {
  opacity: 0;
}
.dv-sheet-enter-from .dv-sheet__panel,
.dv-sheet-leave-to .dv-sheet__panel {
  transform: translateY(100%);
}
</style>
