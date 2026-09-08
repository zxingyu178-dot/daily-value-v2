<script setup lang="ts">
/**
 * DVCard - 统一卡片容器（Design System）
 * 统一：背景、圆角、阴影；提供毛玻璃（frosted）接口。
 */
withDefaults(
  defineProps<{
    /** 是否带描边 */
    outlined?: boolean;
    /** 是否可点击（整卡点击态） */
    clickable?: boolean;
    /** 内边距大小 */
    padding?: 'none' | 'sm' | 'md';
    /** 阴影级别 */
    elevation?: 'none' | 'sm' | 'md';
    /** 毛玻璃效果（半透明 + 背景模糊，需底层有内容） */
    frosted?: boolean;
    /** 玻璃加强（2.10.4）：24px 大圆角 + blur12 + 玻璃边框 Token；不设 background（沿用 surface/壁纸覆盖） */
    glass?: boolean;
  }>(),
  { outlined: false, clickable: false, padding: 'md', elevation: 'none', frosted: false, glass: false },
);
const emit = defineEmits<{ click: [event: MouseEvent] }>();
</script>

<template>
  <div
    class="dv-card"
    :class="[
      { 'dv-card--outlined': outlined, 'dv-card--clickable': clickable },
      `dv-card--pad-${padding}`,
      `dv-card--elev-${elevation}`,
      { 'dv-card--frosted': frosted, 'dv-card--glass': glass },
    ]"
    @click="emit('click', $event)"
  >
    <slot />
  </div>
</template>

<style scoped>
.dv-card {
  background: var(--dv-surface);
  border-radius: var(--dv-radius-lg);
  border: 1px solid transparent;
}
.dv-card--outlined {
  border-color: var(--dv-outline);
}
.dv-card--clickable {
  cursor: pointer;
  transition: transform var(--dv-motion-fast) var(--dv-ease-standard);
}
.dv-card--clickable:active {
  transform: scale(0.985);
}
/* 阴影 */
.dv-card--elev-sm {
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.08), 0 1px 2px rgba(15, 23, 42, 0.04);
}
.dv-card--elev-md {
  box-shadow: 0 4px 12px rgba(15, 23, 42, 0.1), 0 2px 4px rgba(15, 23, 42, 0.06);
}
/* 毛玻璃 */
.dv-card--frosted {
  background: color-mix(in srgb, var(--dv-surface) 72%, transparent);
  backdrop-filter: blur(16px) saturate(140%);
  -webkit-backdrop-filter: blur(16px) saturate(140%);
  border-color: color-mix(in srgb, var(--dv-outline) 60%, transparent);
}
.dv-card--pad-none {
  padding: 0;
}
.dv-card--pad-sm {
  padding: var(--dv-space-sm);
}
.dv-card--pad-md {
  padding: var(--dv-space-md);
}
</style>
