<script setup lang="ts">
/**
 * DVToast - 轻提示容器（Design System）
 * 消费全局 toast 服务（toast.ts），支持 success / error / info。
 * 在应用根节点放置一个 <DVToast /> 即可全局使用。
 */
import { toasts, dismiss } from '@/components/design/toast';
</script>

<template>
  <Teleport to="body">
    <div class="dv-toast-wrap" aria-live="polite">
      <TransitionGroup name="dv-toast">
        <div
          v-for="t in toasts"
          :key="t.id"
          class="dv-toast"
          :class="`dv-toast--${t.type}`"
          role="status"
        >
          <span class="dv-toast__msg">{{ t.message }}</span>
          <button class="dv-toast__close" aria-label="关闭" @click="dismiss(t.id)">✕</button>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<style scoped>
.dv-toast-wrap {
  position: fixed;
  left: 0;
  right: 0;
  bottom: calc(88px + var(--dv-safe-bottom));
  z-index: var(--dv-z-toast);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--dv-space-xs);
  pointer-events: none;
}
.dv-toast {
  display: flex;
  align-items: center;
  gap: var(--dv-space-xs);
  max-width: 82%;
  padding: var(--dv-space-sm) var(--dv-space-md);
  border-radius: var(--dv-radius-pill);
  color: #fff;
  font-size: 13px;
  pointer-events: auto;
  box-shadow: 0 4px 12px rgba(15, 23, 42, 0.18);
}
.dv-toast--success {
  background: var(--dv-success);
}
.dv-toast--error {
  background: var(--dv-danger);
}
.dv-toast--info {
  background: var(--dv-info);
}
.dv-toast__close {
  color: rgba(255, 255, 255, 0.8);
  font-size: 12px;
}
.dv-toast-enter-active,
.dv-toast-leave-active {
  transition: opacity var(--dv-motion-normal) var(--dv-ease-standard),
    transform var(--dv-motion-normal) var(--dv-ease-standard);
}
.dv-toast-enter-from,
.dv-toast-leave-to {
  opacity: 0;
  transform: translateY(8px);
}
</style>
