<script setup lang="ts">
/**
 * DVConfirmDialog — 轻量危险/确认对话框（Design System）
 * 替代 window.confirm / alert 等原生 WebView UI。
 * 面向「二次确认」场景（删除等），Back 键 / 取消关闭，不做复杂 Dialog Framework。
 * 危险按钮使用危险色；其余危险确认逻辑可复用。
 */
import { onBeforeUnmount, watch } from 'vue';
import { registerOverlayForBack, unregisterOverlayForBack } from '@/components/design/back-handler';

const props = withDefaults(
  defineProps<{
    modelValue: boolean;
    title?: string;
    confirmLabel?: string;
    cancelLabel?: string;
    /** 是否危险动作（确认按钮用危险色），默认 true */
    danger?: boolean;
    /** 单按钮模式：隐藏「取消」（仅保留确认，如「知道了」信息框） */
    hideCancel?: boolean;
  }>(),
  { title: '确认', confirmLabel: '确认', cancelLabel: '取消', danger: true, hideCancel: false },
);
const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  confirm: [];
  cancel: [];
}>();

function cancel() {
  emit('cancel');
  emit('update:modelValue', false);
}
function confirm() {
  emit('confirm');
  emit('update:modelValue', false);
}

watch(
  () => props.modelValue,
  (on) => {
    if (on) {
      registerOverlayForBack(cancel);
    } else {
      unregisterOverlayForBack(cancel);
    }
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  void unregisterOverlayForBack(cancel);
});
</script>

<template>
  <Teleport to="body">
    <Transition name="dv-picker">
      <div v-if="modelValue" class="dvcd" role="alertdialog" aria-modal="true" :aria-label="title">
        <div class="dvcd__mask" @click="cancel" />
        <div class="dvcd__panel">
          <h2 class="dvcd__title">{{ title }}</h2>
          <div class="dvcd__body">
            <slot>
              <p class="dvcd__text">确定执行该操作吗？</p>
            </slot>
          </div>
          <div class="dvcd__actions">
            <button
              v-if="!hideCancel"
              class="dvcd__btn dvcd__btn--cancel"
              type="button"
              @click="cancel"
            >
              {{ cancelLabel }}
            </button>
            <button
              class="dvcd__btn"
              :class="danger ? 'dvcd__btn--danger' : 'dvcd__btn--confirm'"
              type="button"
              @click="confirm"
            >
              {{ confirmLabel }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.dvcd {
  position: fixed;
  inset: 0;
  z-index: var(--dv-z-dialog);
  display: flex;
  align-items: center;
  justify-content: center;
}
.dvcd__mask {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
}
.dvcd__panel {
  position: relative;
  width: min(86vw, 380px);
  background: var(--dv-surface);
  border-radius: var(--dv-radius-lg);
  padding: var(--dv-space-lg) var(--dv-space-md) var(--dv-space-md);
  display: flex;
  flex-direction: column;
  gap: var(--dv-space-sm);
}
.dvcd__title {
  font-size: 17px;
  font-weight: 600;
  color: var(--dv-on-surface);
}
.dvcd__text {
  font-size: 14px;
  color: var(--dv-on-surface-variant);
  line-height: 1.6;
}
.dvcd__actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--dv-space-sm);
  margin-top: var(--dv-space-xs);
}
.dvcd__btn {
  padding: var(--dv-space-xs) var(--dv-space-lg);
  border-radius: var(--dv-radius-pill);
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
}
.dvcd__btn--cancel {
  background: var(--dv-surface-alt);
  color: var(--dv-on-surface);
}
.dvcd__btn--danger {
  background: var(--dv-danger);
  color: #fff;
}
.dvcd__btn--confirm {
  background: var(--dv-primary);
  color: var(--dv-on-primary);
}
</style>