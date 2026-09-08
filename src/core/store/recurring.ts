/**
 * Daily Value v2 - recurringStore（Pinia）
 * 封装 IRecurringRuleService 的 CRUD + 触发到期 Bill 生成。
 * 周期记账不建独立账本：到期生成普通 Bill（source='recurring'），统计仍从 Bill 派生。
 */
import { defineStore } from 'pinia';
import { services } from '@/core/services';
import type { RecurringRule } from '@/core/models/types';
import { generateDueBills, type AllGenerateResult } from '@/core/recurring/generator';
import { runRecurringAndSync } from '@/core/recurring/orchestration';

/** 新建规则的完整入参（不含 id/createdAt/updatedAt 及游标） */
export type RecurringRuleInput = Omit<
  RecurringRule,
  'id' | 'createdAt' | 'updatedAt' | 'lastGeneratedDate' | 'nextOccurrence'
>;

export const useRecurringStore = defineStore('recurring', {
  state: () => ({
    rules: [] as RecurringRule[],
    loaded: false,
  }),
  getters: {
    byId: (state) => (id: string) => state.rules.find((r) => r.id === id),
    enabledRules: (state) => state.rules.filter((r) => r.enabled),
    inactiveRules: (state) => state.rules.filter((r) => !r.enabled),
  },
  actions: {
    async load(force = false) {
      if (this.loaded && !force) return;
      this.rules = await services.recurringRules.list();
      this.loaded = true;
    },
    async create(input: RecurringRuleInput): Promise<RecurringRule> {
      const rule = await services.recurringRules.add(input);
      this.rules.push(rule);
      return rule;
    },
    async update(id: string, patch: Partial<RecurringRule>) {
      await services.recurringRules.update(id, patch);
      const idx = this.rules.findIndex((r) => r.id === id);
      if (idx >= 0) this.rules[idx] = { ...this.rules[idx], ...patch, id };
    },
    async toggle(id: string, enabled: boolean) {
      await this.update(id, { enabled });
    },
    async remove(id: string) {
      // 只删除规则、停止未来生成；已生成的历史 Bill 保留，不删除。
      await services.recurringRules.remove(id);
      this.rules = this.rules.filter((r) => r.id !== id);
    },
    /** 触发一次到期生成（bootstrap/resume/手动）；完成后同步 billStore 使 Accounting/Statistics 立即可见 */
  async runGenerator(): Promise<AllGenerateResult> {
    return runRecurringAndSync();
  },
    /** 测试/工具用：强制全量重算（不经过 running 去重） */
    async forceGenerate(): Promise<AllGenerateResult> {
      return generateDueBills();
    },
  },
});