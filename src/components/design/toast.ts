/**
 * Daily Value v2 - 全局 Toast 服务（Design System）
 * 提供 success / error / info 三种类型，自动消失，最多同时展示 3 条。
 * 由 DVToast 组件消费渲染。
 */
import { ref, type Ref } from 'vue';

export type DVToastType = 'success' | 'error' | 'info';

export interface DVToastItem {
  id: number;
  message: string;
  type: DVToastType;
}

const DURATION = 2500;
const MAX_STACK = 3;

export const toasts: Ref<DVToastItem[]> = ref([]);

let seq = 0;

function push(message: string, type: DVToastType) {
  const item: DVToastItem = { id: ++seq, message, type };
  toasts.value.push(item);
  if (toasts.value.length > MAX_STACK) toasts.value.shift();
  setTimeout(() => dismiss(item.id), DURATION);
}

export function dismiss(id: number) {
  toasts.value = toasts.value.filter((t) => t.id !== id);
}

export function showToast(message: string, type: DVToastType = 'info') {
  push(message, type);
}

export const toast = {
  success: (message: string) => push(message, 'success'),
  error: (message: string) => push(message, 'error'),
  info: (message: string) => push(message, 'info'),
};

/** 组合式入口 */
export function useToast() {
  return { toasts, showToast, success: toast.success, error: toast.error, info: toast.info, dismiss };
}
