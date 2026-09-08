/**
 * Daily Value v2 - billStore（Pinia）
 * 封装 IBillService，业务页面只允许经 store 访问账单数据。
 * 作用域规则（ledgerImpact）：
 * - normalBills：进入账单时间线 / 月度支出 / 统计
 * - dailyValueBills：仅日价模块（含 normal+dailyValue 与 daily-value-only）
 */
import { defineStore } from 'pinia';
import { services } from '@/core/services';
import type { Bill } from '@/core/models/types';
import { isDailyValueEnabled } from '@/core/models/daily-value';

export const useBillStore = defineStore('bill', {
  state: () => ({
    bills: [] as Bill[],
    loaded: false,
  }),
  getters: {
    /** 普通账单（进入账单/统计） */
    normalBills: (state) => state.bills.filter((b) => b.ledgerImpact !== 'daily-value-only'),
    /** 参与日价计算的账单（日价模块用） */
    dailyValueBills: (state) => state.bills.filter(isDailyValueEnabled),
    billsByMonth: (state) => (ym: string) =>
      state.bills.filter((b) => b.ledgerImpact !== 'daily-value-only' && b.date.startsWith(ym)),
    monthSummary: (state) => (ym: string) => {
      const list = state.bills.filter(
        (b) => b.ledgerImpact !== 'daily-value-only' && b.date.startsWith(ym),
      );
      let expense = 0;
      let income = 0;
      for (const b of list) {
        if (b.type === 'expense') expense += b.amount;
        else if (b.type === 'income') income += b.amount;
      }
      return { expense, income, net: income - expense };
    },
  },
  actions: {
    async load(force = false) {
      if (this.loaded && !force) return;
      this.bills = await services.bills.list();
      this.loaded = true;
    },
    async add(bill: Omit<Bill, 'id'> & { id?: string }): Promise<Bill> {
      const created = await services.bills.add(bill);
      this.bills.unshift(created);
      return created;
    },
    async update(id: string, patch: Partial<Bill>) {
      await services.bills.update(id, patch);
      const idx = this.bills.findIndex((b) => b.id === id);
      if (idx >= 0) this.bills[idx] = { ...this.bills[idx], ...patch, id };
    },
    async remove(id: string) {
      await services.bills.remove(id);
      this.bills = this.bills.filter((b) => b.id !== id);
    },
  },
});
