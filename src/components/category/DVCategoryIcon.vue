<script setup lang="ts">
/**
 * DVCategoryIcon — 分类图标统一渲染（2.9.7 Category Final Refactor）
 * 所有分类展示都经此组件，不再由页面自己 `{{ cat.emoji }}`：
 * - Category.iconType='builtin' → 本地 SVG（lucide-vue-next，统一线性/圆角风格，颜色随 Theme Token）
 * - iconType='emoji' / 旧数据（无 iconType）→ emoji 兜底（SVG 不可用 / 自定义 emoji 第二选择）
 */
import { computed } from 'vue';
import { categoryIconComponent } from '@/core/models/icons';

const props = withDefaults(
  defineProps<{
    category:
      | { iconType?: 'emoji' | 'builtin'; iconValue?: string; emoji?: string }
      | undefined;
    /** 图标尺寸 px（SVG 与 emoji 共用） */
    size?: number;
    /** 是否渲染为「图标格」背景（主色浅底圆角），与 2.9.5 内置图标格视觉一致 */
    framed?: boolean;
  }>(),
  { size: 22, framed: false },
);

const Comp = computed(() => categoryIconComponent(props.category ?? {}));
/** emoji 兜底字形：builtin 用分类 emoji 快照；emoji 类型用 iconValue；旧数据回退 emoji/📦 */
const glyph = computed(() => {
  const c = props.category;
  if (c?.iconType === 'emoji') return c.iconValue || c.emoji || '📦';
  return c?.emoji || '📦';
});
</script>

<template>
  <span
    class="dvci"
    :class="{ 'is-svg': !!Comp, 'is-framed': framed }"
    :style="{ width: size + 'px', height: size + 'px' }"
    role="img"
    :aria-label="glyph"
  >
    <component :is="Comp" v-if="Comp" :size="size" stroke-width="1.8" class="dvci__svg" />
    <span v-else class="dvci__emoji" :style="{ fontSize: size * 0.82 + 'px' }">{{ glyph }}</span>
  </span>
</template>

<style scoped>
.dvci {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  line-height: 1;
  color: var(--dv-primary);
}
.dvci__svg {
  stroke: currentColor;
}
.dvci__emoji {
  line-height: 1;
}
/* 图标格（framed）：主色浅底圆角，与 2.9.5 内置图标格视觉一致 */
.dvci.is-framed {
  border-radius: var(--dv-radius-md);
  background: var(--dv-primary-soft);
}
</style>
