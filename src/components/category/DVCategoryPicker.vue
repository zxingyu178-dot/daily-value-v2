<script setup lang="ts">
/**
 * DVCategoryPicker — 分类选择器（2.9.7 重构为「纯选择模式」）
 * 只负责「快速选择分类」；新增 / 编辑 / 修改图标 / 删除 统一走 DVCategoryManager（唯一管理实现）。
 * - 3~4 列网格自适应，点击分类立即选中并关闭
 * - 头部「管理」按钮 + 网格末尾 [＋ 添加分类] → 打开 DVCategoryManager（管理 / create mode）
 * - 长按自定义分类仍可快捷进入管理（但不再依赖长按发现管理能力，显式入口常驻）
 * - 共享同一 Category Store：周期记账 / 普通记账所见即同一套全局分类
 * - Android Back LIFO：DVCategoryManager → 本 Picker → 父级
 */
import { onBeforeUnmount, ref, watch } from 'vue';
import { useCategoryStore } from '@/core/store/category';
import { registerOverlayForBack, unregisterOverlayForBack } from '@/components/design/back-handler';
import DVCategoryIcon from '@/components/category/DVCategoryIcon.vue';
import DVCategoryManager from '@/components/category/DVCategoryManager.vue';
import type { Category } from '@/core/models/types';

const props = withDefaults(
  defineProps<{
    visible: boolean;
    /** 当前选中的分类 id（用于高亮选中态） */
    selectedId?: string | null;
    title?: string;
  }>(),
  { selectedId: null, title: '选择分类' },
);
const emit = defineEmits<{
  close: [];
  change: [category: Category];
  /** 分类被 Manager 删除：调用方立即纠正可能悬空的 selectedId / form.categoryId */
  deleted: [categoryId: string];
}>();

const categoryStore = useCategoryStore();
const loading = ref(false);

function close() {
  emit('close');
}
function pick(cat: Category) {
  emit('change', cat);
  close();
}

/* ---- 管理 / 新增：统一走 DVCategoryManager ---- */
const managerOpen = ref(false);
const managerCreateOnOpen = ref(false);

function openManage() {
  managerCreateOnOpen.value = false;
  managerOpen.value = true;
}
/** 「＋添加」直达 Manager create mode */
function openAddCategory() {
  managerCreateOnOpen.value = true;
  managerOpen.value = true;
}
/** 新增成功 / 重名命中：直接选中并关闭，保持快捷选择体验 */
function onManagerCreated(cat: Category) {
  managerOpen.value = false;
  emit('change', cat);
  close();
}
/** 长按快捷进入管理（显式「管理」按钮仍常驻） */
let pressTimer: ReturnType<typeof setTimeout> | null = null;
function startPress(cat: Category) {
  if (cat.builtin) return;
  pressTimer = setTimeout(() => {
    openManage();
  }, 500);
}
function cancelPress() {
  if (pressTimer) {
    clearTimeout(pressTimer);
    pressTimer = null;
  }
}
function onCategoryLongPress(cat: Category) {
  cancelPress();
  if (cat.builtin) return;
  openManage();
}

watch(
  () => props.visible,
  async (on) => {
    if (on) {
      registerOverlayForBack(close);
      loading.value = true;
      try {
        await categoryStore.load();
      } finally {
        loading.value = false;
      }
    } else {
      unregisterOverlayForBack(close);
      managerOpen.value = false;
    }
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  cancelPress();
  void unregisterOverlayForBack(close);
});
</script>

<template>
  <Teleport to="body">
    <Transition name="dv-picker">
      <div v-if="visible" class="dvpc" role="dialog" aria-modal="true" :aria-label="title">
        <div class="dvpc__mask" @click="close" />
        <div class="dvpc__panel">
          <header class="dvpc__head">
            <span>{{ title }}</span>
            <div class="dvpc__head-actions">
              <button class="dvpc__manage" type="button" aria-label="管理分类" @click="openManage">
                管理
              </button>
              <button class="dvpc__close" type="button" aria-label="关闭" @click="close">✕</button>
            </div>
          </header>

          <div class="dvpc__body">
            <div v-if="loading" class="dvpc__empty">加载中…</div>
            <div v-else class="dvpc__grid">
              <div v-for="cat in categoryStore.categories" :key="cat.id" class="dvpc__cell-wrap">
                <button
                  type="button"
                  class="dvpc__cell"
                  :class="{ 'is-active': cat.id === selectedId }"
                  @click="pick(cat)"
                  @contextmenu.prevent="onCategoryLongPress(cat)"
                  @touchstart="startPress(cat)"
                  @touchmove="cancelPress"
                  @touchend="cancelPress"
                  @touchcancel="cancelPress"
                >
                  <DVCategoryIcon :category="cat" :size="26" framed class="dvpc__icon" />
                  <span class="dvpc__name">{{ cat.name }}</span>
                </button>
              </div>

              <!-- [＋ 添加分类]：打开 DVCategoryManager create mode -->
              <button
                class="dvpc__cell dvpc__cell--add"
                type="button"
                aria-label="添加分类"
                @click="openAddCategory"
              >
                <span class="dvpc__add-glyph">＋</span>
                <span class="dvpc__name">添加分类</span>
              </button>
            </div>

            <div class="dvpc__actions">
              <button class="dvpc__cancel" type="button" @click="close">取消</button>
            </div>
          </div>
        </div>

        <DVCategoryManager
          :visible="managerOpen"
          :create-on-open="managerCreateOnOpen"
          @close="managerOpen = false"
          @created="onManagerCreated"
          @duplicate="onManagerCreated"
          @deleted="(id: string) => emit('deleted', id)"
        />
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.dvpc {
  position: fixed;
  inset: 0;
  z-index: var(--dv-z-picker);
  display: flex;
  align-items: center;
  justify-content: center;
}
.dvpc__mask {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
}
.dvpc__panel {
  position: relative;
  display: flex;
  flex-direction: column;
  width: min(88vw, 420px);
  max-height: 86dvh;
  background: var(--dv-overlay-panel-bg);
  backdrop-filter: var(--dv-overlay-panel-blur);
  -webkit-backdrop-filter: var(--dv-overlay-panel-blur);
  border: var(--dv-overlay-panel-border);
  border-radius: var(--dv-radius-lg);
  padding: var(--dv-space-md);
  padding-bottom: calc(var(--dv-space-md) + var(--dv-safe-bottom));
}
.dvpc__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 16px;
  font-weight: 600;
  margin-bottom: var(--dv-space-sm);
  flex-shrink: 0;
}
.dvpc__head-actions {
  display: flex;
  align-items: center;
  gap: var(--dv-space-sm);
}
.dvpc__manage {
  color: var(--dv-primary);
  font-size: 14px;
  font-weight: 600;
}
.dvpc__close {
  color: var(--dv-on-surface-variant);
  font-size: 16px;
}
.dvpc__body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
}
.dvpc__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(88px, 1fr));
  gap: var(--dv-space-xs);
}
.dvpc__cell-wrap {
  position: relative;
  min-width: 0;
}
.dvpc__cell {
  width: 100%;
  min-width: 0;
  height: 68px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--dv-space-xxs);
  padding: var(--dv-space-xxs) 0;
  border-radius: var(--dv-radius-md);
  border: 1px solid var(--dv-outline);
  background: var(--dv-surface);
  cursor: pointer;
  transition: background-color var(--dv-motion-fast) var(--dv-ease-standard);
}
.dvpc__cell.is-active {
  background: var(--dv-primary-soft);
  border-color: var(--dv-primary);
}
.dvpc__cell--add {
  border: 1px dashed var(--dv-outline);
  color: var(--dv-primary);
}
.dvpc__add-glyph {
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 22px;
}
.dvpc__name {
  font-size: 12px;
  color: var(--dv-on-surface-variant);
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dvpc__cell.is-active .dvpc__name {
  color: var(--dv-primary);
  font-weight: 600;
}
.dvpc__empty {
  padding: var(--dv-space-lg) var(--dv-space-md);
  text-align: center;
  color: var(--dv-on-surface-variant);
  font-size: 14px;
}
.dvpc__actions {
  display: flex;
  justify-content: center;
  margin-top: var(--dv-space-sm);
}
.dvpc__cancel {
  padding: var(--dv-space-xs) var(--dv-space-lg);
  border-radius: var(--dv-radius-pill);
  background: var(--dv-surface-alt);
  color: var(--dv-on-surface-variant);
  font-size: 14px;
}
</style>
