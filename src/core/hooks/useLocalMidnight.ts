/**
 * useLocalMidnight - 极简本地午夜刷新调度器（跨日感知）
 * - 每次精确排到“下一个本地午夜”，触发 onMidnight 后按新差值递归重新调度。
 * - 不用固定 24h interval（规避 DST 切换日 23/25 小时漂移）。
 * - 组件挂载启动、卸载自动清理；同一时刻只存在一个待触发的午夜定时器。
 *
 * 用法：
 *   const today = ref(localDateKey());
 *   useLocalMidnightRefresh(() => { today.value = localDateKey(); });
 */
import { onBeforeUnmount, onMounted } from 'vue';
import { msUntilNextLocalMidnight } from '@/core/models/daily-value';

export function useLocalMidnightRefresh(onMidnight: () => void) {
  let timer: ReturnType<typeof setTimeout> | null = null;

  function schedule() {
    timer = setTimeout(() => {
      onMidnight();
      schedule(); // 触发后重算下一次本地午夜
    }, msUntilNextLocalMidnight());
  }

  onMounted(schedule);
  onBeforeUnmount(() => {
    if (timer) clearTimeout(timer);
    timer = null;
  });
}