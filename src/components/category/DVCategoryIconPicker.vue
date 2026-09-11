<script setup lang="ts">
/**
 * DVCategoryIconPicker — 分类图标选择器（2.9.7 Category Final Refactor）
 * 真正 v-model：modelValue = { iconType, iconValue }，emit update:modelValue。
 * - 新增 / 编辑 / QuickEntry / Recurring / DailyValue 全部使用同一个图标状态，
 *   重新打开 Picker 也能可靠高亮当前临时选择（不再依赖 category? 入参猜状态）。
 * - 主方案「预置图标」：本地 SVG（lucide-vue-next）网格，点选即写回并关闭
 * - 次要「自定义 emoji」：手输 emoji 兜底（iconType='emoji'），非主方案
 * - Android Back：先关本选择器
 */
import { computed, ref, watch, onBeforeUnmount } from 'vue';
import { BUILTIN_ICONS } from '@/core/models/icons';
import { registerOverlayForBack, unregisterOverlayForBack } from '@/components/design/back-handler';

export interface CategoryIconValue {
  iconType: 'emoji' | 'builtin';
  iconValue: string;
}

const props = withDefaults(
  defineProps<{
    visible: boolean;
    modelValue: CategoryIconValue;
  }>(),
  { modelValue: () => ({ iconType: 'builtin' as const, iconValue: 'other' }) },
);
const emit = defineEmits<{
  'update:modelValue': [value: CategoryIconValue];
  close: [];
}>();

const tab = ref<'builtin' | 'emoji'>('builtin');
const customEmoji = ref('');

function close() {
  emit('close');
}
function commit(value: CategoryIconValue) {
  emit('update:modelValue', value);
  close();
}
function selectBuiltin(id: string) {
  commit({ iconType: 'builtin', iconValue: id });
}
function selectCustom() {
  const glyph = customEmoji.value.trim();
  if (!glyph) {
    customEmoji.value = '';
    return;
  }
  commit({ iconType: 'emoji', iconValue: glyph });
}

/** 当前高亮的内置图标 id（builtin 类型时） */
function currentBuiltinId(): string {
  return props.modelValue.iconType === 'builtin' ? props.modelValue.iconValue : '';
}
/** 当前选中内置图标的展示（底部预览） */
const activeBuiltin = computed(() =>
  props.modelValue.iconType === 'builtin'
    ? BUILTIN_ICONS.find((i) => i.id === props.modelValue.iconValue)
    : undefined,
);

watch(
  () => props.visible,
  (on) => {
    if (on) {
      registerOverlayForBack(close);
      // 打开时回到预置页；自定义输入框带当前 emoji（若有）
      tab.value = 'builtin';
      customEmoji.value =
        props.modelValue.iconType === 'emoji' ? props.modelValue.iconValue : '';
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
      <div v-if="visible" class="dvic" role="dialog" aria-modal="true" aria-label="选择分类图标">
        <div class="dvic__mask" @click="close" />
        <div class="dvic__panel">
          <header class="dvic__head">
            <span>选择图标</span>
            <button class="dvic__close" type="button" aria-label="关闭" @click="close">✕</button>
          </header>

          <!-- 页签：预置图标（主） / 自定义 emoji（兜底） -->
          <div class="dvic__tabs">
            <button
              type="button"
              class="dvic__tab"
              :class="{ 'is-active': tab === 'builtin' }"
              @click="tab = 'builtin'"
            >
              预置图标
            </button>
            <button
              type="button"
              class="dvic__tab"
              :class="{ 'is-active': tab === 'emoji' }"
              @click="tab = 'emoji'"
            >
              自定义 emoji
            </button>
          </div>

          <!-- 预置图标网格：本地 SVG（统一线性/圆角风格），当前选中高亮 -->
          <div v-if="tab === 'builtin'" class="dvic__grid">
            <button
              v-for="icon in BUILTIN_ICONS"
              :key="icon.id"
              type="button"
              class="dvic__icon"
              :class="{ 'is-active': icon.id === currentBuiltinId() }"
              :aria-label="`图标 ${icon.label}`"
              @click="selectBuiltin(icon.id)"
            >
              <span class="dvic__icon-box">
                <component :is="icon.component" :size="24" stroke-width="1.8" class="dvic__svg" />
              </span>
              <span class="dvic__label">{{ icon.label }}</span>
            </button>
          </div>

          <!-- 自定义 emoji（兜底，非主方案） -->
          <div v-else class="dvic__custom">
            <input
              v-model="customEmoji"
              class="dvic__custom-input"
              maxlength="4"
              placeholder="输入任意 emoji 字符"
              aria-label="自定义 emoji"
              @keydown.enter="selectCustom"
            />
            <button class="dvic__custom-ok" type="button" @click="selectCustom">确定</button>
          </div>

          <!-- 当前选择预览（重新打开仍高亮正确） -->
          <footer v-if="activeBuiltin" class="dvic__foot">
            当前：
            <component :is="activeBuiltin.component" :size="16" stroke-width="1.8" class="dvic__svg" />
            <span class="dvic__foot-label">{{ activeBuiltin.label }}</span>
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.dvic {
  position: fixed;
  inset: 0;
  z-index: var(--dv-z-subpicker);
  display: flex;
  align-items: center;
  justify-content: center;
}
.dvic__mask {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
}
.dvic__panel {
  position: relative;
  width: min(88vw, 420px);
  max-height: 72vh;
  overflow-y: auto;
  background: var(--dv-overlay-panel-bg);
  backdrop-filter: var(--dv-overlay-panel-blur);
  -webkit-backdrop-filter: var(--dv-overlay-panel-blur);
  border: var(--dv-overlay-panel-border);
  border-radius: var(--dv-radius-lg);
  padding: var(--dv-space-md) var(--dv-space-md) calc(var(--dv-space-md) + var(--dv-safe-bottom));
}
.dvic__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 16px;
  font-weight: 600;
  margin-bottom: var(--dv-space-sm);
}
.dvic__close {
  color: var(--dv-on-surface-variant);
  font-size: 16px;
}
.dvic__tabs {
  display: flex;
  gap: var(--dv-space-xs);
  margin-bottom: var(--dv-space-sm);
}
.dvic__tab {
  flex: 1;
  height: 34px;
  border-radius: var(--dv-radius-md);
  background: var(--dv-surface-alt);
  color: var(--dv-on-surface-variant);
  font-size: 13px;
  font-weight: 600;
}
.dvic__tab.is-active {
  background: var(--dv-primary);
  color: var(--dv-on-primary);
}
.dvic__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(72px, 1fr));
  gap: var(--dv-space-xs);
}
.dvic__icon {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--dv-space-xxs);
  padding: var(--dv-space-xs) 0;
  border-radius: var(--dv-radius-md);
  border: 1px solid var(--dv-outline);
  background: var(--dv-surface);
  cursor: pointer;
  transition: background-color var(--dv-motion-fast) var(--dv-ease-standard);
}
.dvic__icon.is-active {
  background: var(--dv-primary-soft);
  border-color: var(--dv-primary);
}
/* 统一图标格：圆角 + 主色浅底，本地 SVG 线性图标 */
.dvic__icon-box {
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--dv-radius-md);
  background: var(--dv-primary-soft);
  color: var(--dv-primary);
}
.dvic__svg {
  stroke: currentColor;
}
.dvic__label {
  font-size: 11px;
  color: var(--dv-on-surface-variant);
}
.dvic__icon.is-active .dvic__label {
  color: var(--dv-primary);
  font-weight: 600;
}
.dvic__custom {
  display: flex;
  gap: var(--dv-space-xs);
  padding-top: var(--dv-space-sm);
}
.dvic__custom-input {
  flex: 1;
  min-width: 0;
  height: 42px;
  text-align: center;
  border: 1px solid var(--dv-outline);
  border-radius: var(--dv-radius-md);
  background: var(--dv-surface-alt);
  color: var(--dv-on-surface);
  font-size: 18px;
}
.dvic__custom-ok {
  flex-shrink: 0;
  height: 42px;
  padding: 0 var(--dv-space-md);
  border: none;
  border-radius: var(--dv-radius-md);
  background: var(--dv-primary);
  color: var(--dv-on-primary);
  font-size: 14px;
  font-weight: 600;
}
.dvic__foot {
  display: flex;
  align-items: center;
  gap: var(--dv-space-xxs);
  margin-top: var(--dv-space-sm);
  padding-top: var(--dv-space-xs);
  border-top: 1px solid var(--dv-outline);
  font-size: 12px;
  color: var(--dv-on-surface-variant);
}
.dvic__foot-label {
  color: var(--dv-primary);
  font-weight: 600;
}
</style>
