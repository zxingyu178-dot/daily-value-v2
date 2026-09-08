/**
 * Daily Value v2 - categoryStore（Pinia）
 * 封装 ICategoryService，业务页面只允许经 store 访问分类数据。
 *
 * 2.9.7 Category Final Refactor：
 * - updateCategoryMetadata：分类元数据（名称/图标）修改必须全局生效——同步更新引用该分类的
 *   Bill / RecurringRule 快照（categoryName/categoryEmoji），并 reload 相关 Pinia，
 *   保证「记账列表 / 编辑账单 / 日价项目 / 周期规则选择行」立即刷新，不要求重启 App。
 * - removeCategory：删除自定义分类的统一 domain 入口——先检查周期规则引用（被引用则阻止删除，
 *   提示用户先修改周期规则），删除后记录预置分类删除（防止 initCore 复活）。
 * - findDuplicateName / countRecurringUsage：分类管理 UI 的校验支撑。
 */
import { defineStore } from 'pinia';
import { services } from '@/core/services';
import { recordPresetDeletion } from '@/core/services';
import { categoryGlyph } from '@/core/models/icons';
import { useBillStore } from '@/core/store/bill';
import { useRecurringStore } from '@/core/store/recurring';
import type { Bill, Category } from '@/core/models/types';

export const useCategoryStore = defineStore('category', {
  state: () => ({
    categories: [] as Category[],
    loaded: false,
  }),
  getters: {
    byId: (state) => (id: string) => state.categories.find((c) => c.id === id),
    /** 系统核心分类（builtin=true，🔒 不可删除） */
    coreCategories: (state) => state.categories.filter((c) => c.builtin),
    /** 自定义分类（builtin=false，可改名/改图标/删除） */
    customCategories: (state) => state.categories.filter((c) => !c.builtin),
  },
  actions: {
    async load(force = false) {
      if (this.loaded && !force) return;
      this.categories = await services.categories.list();
      this.loaded = true;
    },
    async add(category: Omit<Category, 'id'>): Promise<Category> {
      const created = await services.categories.add(category);
      this.categories.push(created);
      this.categories.sort((a, b) => a.sort - b.sort);
      return created;
    },
    async update(id: string, patch: Partial<Category>) {
      await services.categories.update(id, patch);
      const idx = this.categories.findIndex((c) => c.id === id);
      if (idx >= 0) this.categories[idx] = { ...this.categories[idx], ...patch, id };
    },
    async remove(id: string) {
      await services.categories.remove(id);
      this.categories = this.categories.filter((c) => c.id !== id);
    },

    /**
     * 重名检查（trim 后比较；excludeId 用于编辑时排除自身）。
     * 返回已存在的同名分类（未命中返回 undefined）。
     */
    findDuplicateName(name: string, excludeId?: string): Category | undefined {
      const trimmed = name.trim();
      if (!trimmed) return undefined;
      return this.categories.find((c) => c.id !== excludeId && c.name.trim() === trimmed);
    },

    /** 被周期规则引用的条数（分类删除前的安全检查） */
    async countRecurringUsage(id: string): Promise<number> {
      const rules = await services.recurringRules.list();
      return rules.filter((r) => r.categoryId === id).length;
    },

    /**
     * 分类元数据修改统一入口（全局生效）：
     * 1. 更新 Category 本身
     * 2. 更新引用该 categoryId 的 Bill 分类快照（categoryName / categoryEmoji）
     * 3. 更新引用该 categoryId 的 RecurringRule 分类快照
     * 4. reload 相关 Pinia（bill / recurring），所有展示分类的页面立即刷新
     * 页面不得自行循环改数据库，统一走本 Store/Service 层。
     */
    async updateCategoryMetadata(id: string, patch: Partial<Category>): Promise<void> {
      await this.update(id, patch);
      const cat = this.byId(id);
      if (!cat) return;
      const snapshots: Partial<Pick<Bill, 'categoryName' | 'categoryEmoji'>> = {};
      if (patch.name !== undefined) snapshots.categoryName = cat.name;
      if (patch.emoji !== undefined || patch.iconType !== undefined || patch.iconValue !== undefined) {
        // 图标变化 → 同步快照 emoji（DVCategoryIcon 用分类表 SVG，旧渲染路径用快照 emoji）
        snapshots.categoryEmoji = categoryGlyph(cat);
      }
      if (Object.keys(snapshots).length === 0) return;

      const billStore = useBillStore();
      await billStore.load();
      for (const b of billStore.bills) {
        if (b.categoryId === id) await billStore.update(b.id, snapshots);
      }

      const recurringStore = useRecurringStore();
      await recurringStore.load();
      for (const r of recurringStore.rules) {
        if (r.categoryId === id) await recurringStore.update(r.id, snapshots);
      }

      // 兜底强刷：任何已挂载但未经由本 store 更新的页面也能立即读到最新快照
      await billStore.load(true);
      await recurringStore.load(true);
    },

    /**
     * 删除自定义分类（统一 domain 入口）：
     * - 若被周期规则引用：阻止删除，返回 { ok:false, recurringCount }（UI 提示先改周期规则）
     * - 否则删除分类 + 记录预置分类删除（防止 initCore 复活）；历史 Bill 快照保留，不受影响
     */
    async removeCategory(id: string): Promise<{ ok: boolean; recurringCount?: number }> {
      const recurringCount = await this.countRecurringUsage(id);
      if (recurringCount > 0) return { ok: false, recurringCount };
      await this.remove(id);
      await recordPresetDeletion(id);
      return { ok: true };
    },
  },
});
