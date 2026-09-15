/**
 * Daily Value v2 - 自动记账 Pinia Store（2.16.4：+accessStatus / +三态计数）
 * - 实时刷新由 App 级 AutoBill Runtime 驱动（pendingChanged 事件 / resume / 首屏）
 * - 权限状态（通知使用权）也在 Runtime 同步后刷新，页面无自带 listener
 */
import { defineStore } from 'pinia';
import { ref } from 'vue';
import { services } from '@/core/services';
import { getAccessStatus, type AutoBillAccessStatus } from '@/feature/autobill/service/notification-bridge';
import type { AutoBillCandidate, AutoBillCandidateStatus } from '@/core/models/types';

export const useAutoBillStore = defineStore('autobill', () => {
  /** 待确认候选（倒序） */
  const pending = ref<AutoBillCandidate[]>([]);
  /** 待确认数量（首页「待确认账单 N 笔」入口 / 审核页） */
  const pendingCount = ref(0);
  /** 2.16.4：三态计数（待确认 / 已确认 / 已忽略） */
  const counts = ref<Record<AutoBillCandidateStatus, number>>({
    WAIT_CONFIRM: 0,
    CONFIRMED: 0,
    IGNORED: 0,
  });
  /** 2.16.4：通知使用权状态（Runtime 同步后刷新） */
  const accessStatus = ref<AutoBillAccessStatus>({
    granted: false,
    connected: false,
    pendingCount: 0,
  });

  async function load(): Promise<void> {
    pending.value = await services.autoBill.listCandidates('WAIT_CONFIRM');
    pendingCount.value = pending.value.length;
    const [confirmed, ignored] = await Promise.all([
      services.autoBill.listCandidates('CONFIRMED'),
      services.autoBill.listCandidates('IGNORED'),
    ]);
    counts.value = {
      WAIT_CONFIRM: pending.value.length,
      CONFIRMED: confirmed.length,
      IGNORED: ignored.length,
    };
  }

  /** 2.16.4：刷新系统「通知使用权」状态（Runtime 在 resume/事件同步后调用） */
  async function refreshStatus(): Promise<void> {
    accessStatus.value = await getAccessStatus();
  }

  return { pending, pendingCount, counts, accessStatus, load, refreshStatus };
});