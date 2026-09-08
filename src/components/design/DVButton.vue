<script setup lang="ts">
/**
 * DVButton - 统一按钮组件（Design System）
 * 变体：primary / secondary / danger / ghost
 * 统一：尺寸、圆角、点击反馈（按压缩放）、禁用态。
 */
withDefaults(
  defineProps<{
    variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
    size?: 'sm' | 'md' | 'lg';
    block?: boolean;
    disabled?: boolean;
    type?: 'button' | 'submit';
  }>(),
  { variant: 'primary', size: 'md', block: false, disabled: false, type: 'button' },
);
const emit = defineEmits<{ click: [event: MouseEvent] }>();
</script>

<template>
  <button
    class="dv-button"
    :class="[
      `dv-button--${variant}`,
      `dv-button--${size}`,
      { 'dv-button--block': block, 'dv-button--disabled': disabled },
    ]"
    :type="type"
    :disabled="disabled"
    :aria-disabled="disabled"
    @click="!disabled && emit('click', $event)"
  >
    <slot />
  </button>
</template>

<style scoped>
.dv-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--dv-space-xs);
  border-radius: var(--dv-radius-md);
  font-weight: 600;
  line-height: 1;
  user-select: none;
  transition:
    background-color var(--dv-motion-fast) var(--dv-ease-standard),
    color var(--dv-motion-fast) var(--dv-ease-standard),
    opacity var(--dv-motion-fast) var(--dv-ease-standard),
    transform var(--dv-motion-fast) var(--dv-ease-standard);
}
/* 点击反馈：按压缩放 */
.dv-button:not(.dv-button--disabled):active {
  transform: scale(0.96);
}
.dv-button--primary {
  background: var(--dv-primary);
  color: var(--dv-on-primary);
}
.dv-button--secondary {
  background: var(--dv-primary-soft);
  color: var(--dv-primary);
}
.dv-button--danger {
  background: var(--dv-danger);
  color: #fff;
}
.dv-button--ghost {
  background: transparent;
  color: var(--dv-primary);
}
.dv-button--ghost.dv-button--disabled {
  color: var(--dv-on-surface-variant);
}
/* 尺寸 */
.dv-button--sm {
  height: 32px;
  padding: 0 var(--dv-space-sm);
  font-size: 13px;
  border-radius: var(--dv-radius-sm);
}
.dv-button--md {
  height: 40px;
  padding: 0 var(--dv-space-md);
  font-size: 14px;
}
.dv-button--lg {
  height: 48px;
  padding: 0 var(--dv-space-lg);
  font-size: 16px;
}
.dv-button--block {
  width: 100%;
}
.dv-button--disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
</style>
