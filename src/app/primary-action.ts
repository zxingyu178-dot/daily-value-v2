/**
 * 2.10.10 - 全局主操作（Primary FAB）命令总线
 *
 * 2.10.10 架构收口：App 内只存在一个 Primary FAB（App.vue），
 * 页面不再各自渲染/Teleport FAB。本模块是 FAB → 页面 之间的唯一通道：
 *
 * - App.vue 的 Global FAB 点击 → triggerPrimaryAction(currentRouteAction)
 * - AccountingPage 订阅 'accounting-add'
 * - DailyValuePage 订阅 'daily-value-add'
 *
 * command 带递增 sequence：每次点击 sequence + 1，
 * 避免「boolean 触点」的 true→true 无法触发第二次的问题。
 *
 * 订阅方必须自行做 route.path 校验（页面只响应当前路由对应的命令）。
 */

export type PrimaryAction = 'accounting-add' | 'daily-value-add';

export interface PrimaryActionCommand {
  type: PrimaryAction;
  /** 单调递增序号：每次 trigger +1，订阅方可据此感知「新的一次点击」 */
  sequence: number;
}

type Listener = (command: PrimaryActionCommand) => void;

let listeners: Listener[] = [];
let sequence = 0;

/** 触发一次全局主操作（由 App.vue 唯一 FAB 调用） */
export function triggerPrimaryAction(type: PrimaryAction): void {
  sequence += 1;
  const command: PrimaryActionCommand = { type, sequence };
  for (const listener of [...listeners]) listener(command);
}

/** 订阅命令；返回取消订阅函数（页面 onBeforeUnmount 时调用） */
export function onPrimaryAction(listener: Listener): () => void {
  listeners.push(listener);
  return () => {
    listeners = listeners.filter((fn) => fn !== listener);
  };
}

/** 测试/调试只读：当前已触发序号 */
export function getPrimaryActionSequence(): number {
  return sequence;
}