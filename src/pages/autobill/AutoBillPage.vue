<script setup lang="ts">
/**
 * 2.16.4 —— AutoBill 单路由 + 内部 Panel 状态机
 * /autobill 是唯一路由；ReviewTab 与 SettingsPanel 通过 currentPanel 切换（禁止 router 跳转）。
 * 内部切换不产生任何 Web History；Back 一次 = 退出模块（或其父级）。
 * 实时刷新由 AutoBill Runtime 驱动（pendingChanged / resume / 首屏 → Store）。
 */
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { DVCard, toast } from '@/components/design';
import { useAutoBillStore } from '@/core/store/autobill';
import { useCategoryStore } from '@/core/store/category';
import { services } from '@/core/services';
import { resolveCategory, buildBillFromCandidate } from '@/feature/autobill/service/candidate';
import type { Bill, AutoBillCandidate, AutoBillCandidateStatus } from '@/core/models/types';
import QuickEntrySheet from '@/pages/accounting/QuickEntrySheet.vue';
import AutoBillSettingsPanel from './AutoBillSettingsPanel.vue';

defineOptions({ name: 'AutoBillPage' });

const route = useRoute();
const router = useRouter();
const ab = useAutoBillStore();
const categoryStore = useCategoryStore();

/** 2.16.4：内部面板状态（ReviewTab / SettingsPanel），非路由 */
const panel = ref<'review' | 'settings'>(route.query.panel === 'settings' ? 'settings' : 'review');
const settingsPanel = ref<InstanceType<typeof AutoBillSettingsPanel> | null>(null);

const isSettings = computed(() => panel.value === 'settings');

/** 当前展示的状态分段 */
const activeStatus = ref<AutoBillCandidateStatus>('WAIT_CONFIRM');
const list = ref<AutoBillCandidate[]>([]);

const STATUS_TABS: Array<{ value: AutoBillCandidateStatus; label: string }> = [
  { value: 'WAIT_CONFIRM', label: '待确认' },
  { value: 'CONFIRMED', label: '已确认' },
  { value: 'IGNORED', label: '已忽略' },
];

/** 2.16.4 P4：Tab 数量 */
function tabCount(t: (typeof STATUS_TABS)[number]): number {
  return ab.counts[t.value] ?? 0;
}

async function loadList(status: AutoBillCandidateStatus = activeStatus.value) {
  list.value = await services.autoBill.listCandidates(status);
}

async function switchTab(status: AutoBillCandidateStatus) {
  activeStatus.value = status;
  await loadList(status);
}

// 2.16.4：进入设置面板时刷新一次设置相关状态（权限/来源）
watch(panel, (p) => {
  if (p === 'settings') void settingsPanel.value?.refreshSettings();
});

/* ---- 修改模式：候选预填快速记账 ---- */
const editCandidateId = ref<string | null>(null);
const editPrefill = ref<Bill | null>(null);
const sheetOpen = ref(false);

function fmtTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function categoryNameOf(c: AutoBillCandidate): string {
  if (c.suggestCategoryId) {
    const hit = categoryStore.categories.find((x) => x.id === c.suggestCategoryId);
    if (hit) return hit.name;
  }
  return '待选';
}

async function confirmCandidate(id: string) {
  try {
    await services.autoBill.confirm(id);
    toast.success('已记入账本');
  } catch {
    toast.info('该笔已处理');
  }
  await ab.load();
  await loadList();
}

async function ignoreCandidate(id: string) {
  await services.autoBill.ignore(id);
  toast.info('已忽略');
  await ab.load();
  await loadList();
}

/** 修改：候选预填快速记账（保存后候选标记已处理） */
async function openModify(candidate: AutoBillCandidate) {
  await categoryStore.load();
  const category = resolveCategory(categoryStore.categories, candidate.suggestCategoryId, candidate.type);
  editPrefill.value = buildBillFromCandidate(candidate, category);
  editCandidateId.value = candidate.id;
  sheetOpen.value = true;
}

async function onSheetSaved() {
  sheetOpen.value = false;
  if (editCandidateId.value) {
    await services.autoBill.ignore(editCandidateId.value);
    editCandidateId.value = null;
  }
  editPrefill.value = null;
  toast.success('已记账');
  await ab.load();
  await loadList();
}

/** Header 返回：设置面板 → 回审核；审核 → 退出模块（返回父级） */
function goBack() {
  if (isSettings.value) {
    openPanel('review');
    return;
  }
  router.back();
}

/** 2.16.4：内部面板切换（纯状态，无路由） */
function openPanel(name: 'review' | 'settings') {
  panel.value = name;
}

onMounted(async () => {
  await categoryStore.load();
  await ab.load();
  await ab.refreshStatus();
  await loadList();
});
</script>

<template>
  <section class="page">
    <header class="page__head">
      <button class="page__back" type="button" aria-label="返回" @click="goBack">‹</button>
      <h1 class="page__title">{{ isSettings ? '自动记账设置' : '自动记账' }}</h1>
      <button
        v-if="!isSettings"
        class="page__nav"
        type="button"
        @click="openPanel('settings')"
      >
        设置 ›
      </button>
      <button
        v-else
        class="page__nav"
        type="button"
        @click="openPanel('review')"
      >
        待确认{{ ab.pendingCount > 0 ? ` ${ab.pendingCount}` : '' }} ›
      </button>
    </header>

    <!-- ===== SettingsPanel（内部面板，非路由） ===== -->
    <template v-if="isSettings">
      <AutoBillSettingsPanel ref="settingsPanel" />
      <button class="back-review" type="button" @click="openPanel('review')">
        ‹ 返回待确认账单
      </button>
    </template>

    <!-- ===== ReviewTab ===== -->
    <template v-else>
      <!-- 2.16.4 P2：完整设置入口卡（两行文案，整卡可点进入 SettingsPanel，非路由） -->
      <button class="settings-entry" type="button" @click="openPanel('settings')">
        <span class="settings-entry__main">
          <span class="settings-entry__title">自动记账设置</span>
          <span class="settings-entry__desc">管理通知权限 · 管理自动识别来源</span>
        </span>
        <span class="settings-entry__chevron" aria-hidden="true">›</span>
      </button>

      <!-- 状态分段 + 数量（2.16.4 P4） -->
      <div class="seg" role="tablist" aria-label="账单状态">
        <button
          v-for="t in STATUS_TABS"
          :key="t.value"
          class="seg__item"
          :class="{ 'is-active': activeStatus === t.value }"
          type="button"
          role="tab"
          @click="switchTab(t.value)"
        >
          {{ t.label }}{{ tabCount(t) > 0 ? ` ${tabCount(t)}` : '' }}
        </button>
      </div>

      <p v-if="list.length === 0" class="empty">
        {{ activeStatus === 'WAIT_CONFIRM' ? '没有待确认账单' : activeStatus === 'CONFIRMED' ? '没有已确认账单' : '没有已忽略账单' }}
      </p>

      <DVCard
        v-for="c in list"
        :key="c.id"
        outlined
        class="cand"
        :class="{ 'is-dim': c.status !== 'WAIT_CONFIRM' }"
      >
        <div class="cand__top">
          <span class="cand__badge">{{ c.sourceApp }}</span>
          <span class="cand__time">{{ fmtTime(c.transactionTime) }}</span>
        </div>
        <div class="cand__body">
          <div class="cand__info">
            <p class="cand__merchant">{{ c.merchant || c.sourceApp }}</p>
            <p class="cand__cat">
              建议分类：{{ categoryNameOf(c) }}
              <template v-if="c.status === 'CONFIRMED'"> · 已确认</template>
              <template v-else-if="c.status === 'IGNORED'"> · 已忽略</template>
            </p>
          </div>
          <p class="cand__amount" :class="c.type === 'income' ? 'is-income' : 'is-expense'">
            {{ c.type === 'income' ? '+' : '-' }}{{ c.amount.toFixed(2) }}
          </p>
        </div>
        <div v-if="c.status === 'WAIT_CONFIRM'" class="cand__actions">
          <button class="act act--confirm" type="button" @click="confirmCandidate(c.id)">确认</button>
          <button class="act" type="button" @click="openModify(c)">修改</button>
          <button class="act act--ignore" type="button" @click="ignoreCandidate(c.id)">忽略</button>
        </div>
      </DVCard>
    </template>

    <QuickEntrySheet v-model="sheetOpen" :prefill-bill="editPrefill" @saved="onSheetSaved" />
  </section>
</template>

<style scoped>
.page {
  padding: var(--dv-space-md);
  padding-top: calc(var(--dv-space-sm) + var(--dv-safe-top));
  display: flex;
  flex-direction: column;
  gap: var(--dv-space-sm);
  min-height: 100%;
  background: var(--dv-bg, var(--dv-surface));
  color: var(--dv-on-surface);
}
.page__head {
  display: flex;
  align-items: center;
  gap: var(--dv-space-sm);
  min-height: 44px;
}
.page__back {
  font-size: 24px;
  line-height: 1;
  padding: 6px 10px;
  min-width: 44px;
  min-height: 44px;
  background: none;
  border: none;
  color: var(--dv-on-surface);
}
.page__title {
  font-size: 18px;
  font-weight: 600;
  margin: 0;
}
.page__nav {
  margin-left: auto;
  min-height: 44px;
  padding: 0 4px;
  background: none;
  border: none;
  color: var(--dv-primary);
  font-size: 14px;
}

.settings-entry {
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: center;
  gap: var(--dv-space-sm);
  width: 100%;
  min-height: 56px;
  padding: var(--dv-space-sm) var(--dv-space-md);
  border: 1px solid var(--dv-outline, rgba(128, 128, 128, 0.3));
  border-radius: 14px;
  background: var(--dv-surface-card, var(--dv-surface));
  color: var(--dv-on-surface);
  text-align: left;
}
.settings-entry__main {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}
.settings-entry__title {
  font-size: 15px;
  font-weight: 600;
}
.settings-entry__desc {
  font-size: 12px;
  line-height: 1.4;
  color: var(--dv-on-surface-dim, inherit);
}
.settings-entry__chevron {
  font-size: 18px;
  color: var(--dv-on-surface-dim, inherit);
}

.seg {
  display: flex;
  gap: var(--dv-space-xs);
}
.seg__item {
  flex: 1;
  min-height: 40px;
  border: 1px solid var(--dv-outline, rgba(128, 128, 128, 0.3));
  border-radius: 999px;
  background: none;
  color: var(--dv-on-surface-dim, inherit);
  font-size: 13px;
}
.seg__item.is-active {
  background: var(--dv-primary);
  border-color: var(--dv-primary);
  color: var(--dv-on-primary, #fff);
}

.empty {
  text-align: center;
  color: var(--dv-on-surface-dim, inherit);
  font-size: 14px;
  padding: 40px 0;
}
.cand {
  display: flex;
  flex-direction: column;
  gap: var(--dv-space-sm);
}
.cand.is-dim {
  opacity: 0.72;
}
.cand__top {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.cand__badge {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--dv-primary-soft, rgba(91, 103, 240, 0.14));
  color: var(--dv-primary);
}
.cand__time {
  font-size: 12px;
  color: var(--dv-on-surface-dim, inherit);
}
.cand__body {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.cand__merchant {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}
.cand__cat {
  margin: 2px 0 0;
  font-size: 12px;
  color: var(--dv-on-surface-dim, inherit);
}
.cand__amount {
  font-size: 18px;
  font-weight: 700;
  margin: 0;
}
.cand__amount.is-expense { color: var(--dv-expense, #22c55e); }
.cand__amount.is-income { color: var(--dv-income, #ef4444); }
.cand__actions {
  display: flex;
  gap: var(--dv-space-sm);
}
.act {
  flex: 1;
  min-height: 40px;
  border-radius: 999px;
  border: 1px solid var(--dv-outline, rgba(128, 128, 128, 0.3));
  background: none;
  color: var(--dv-on-surface);
  font-size: 14px;
}
.act--confirm {
  background: var(--dv-primary);
  border-color: var(--dv-primary);
  color: var(--dv-on-primary, #fff);
}
.act--ignore {
  color: var(--dv-on-surface-dim, inherit);
}
.back-review {
  min-height: 44px;
  background: none;
  border: none;
  color: var(--dv-primary);
  font-size: 14px;
  text-align: center;
}
</style>