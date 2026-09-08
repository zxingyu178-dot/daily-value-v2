<script setup lang="ts">
/**
 * RecurringPage — 周期记账页（Phase 7A，/settings/recurring）
 * 设置主页「周期记账」入口进入。列表：新建 / 编辑 / 启用停用 / 删除。
 * 规则列表 + 到期自动生成 Bill（source='recurring'）进入记账/统计。
 */
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { DVButton, DVConfirmDialog, toast } from '@/components/design';
import { useRecurringStore } from '@/core/store/recurring';
import type { RecurringRule } from '@/core/models/types';
import RecurringEditorSheet from '@/pages/settings/RecurringEditorSheet.vue';

const router = useRouter();
const recurring = useRecurringStore();

const loading = ref(false);
const editorOpen = ref(false);
const editingRule = ref<RecurringRule | null>(null);
/** 待删除确认的规则；null 表示未打开确认框 */
const confirmTarget = ref<RecurringRule | null>(null);

const weekdayLabels = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

const rules = computed(() => recurring.rules);

function goBackToSettings() {
  if ((window.history?.length ?? 0) > 1) {
    router.back();
    return;
  }
  router.push('/settings');
}

function periodText(r: RecurringRule): string {
  switch (r.frequency) {
    case 'weekly':
      return `· ${weekdayLabels[r.day] ?? '周日'}`;
    case 'monthly':
      return `· ${r.day} 日`;
    case 'yearly':
      return `· ${r.month ?? 1} 月 ${r.day} 日`;
    default:
      // daily：频率已由 freqText 表达（每天 / 每 N 天），不再重复输出单位
      return '';
  }
}

/** 频率主文案：interval=1 → 每天/每周/每月/每年；interval>1 → 每 N 天/周/月/年（不再与右侧细节重复单位） */
function freqText(r: RecurringRule): string {
  const itv = r.interval > 1 ? `每 ${r.interval} ` : '';
  switch (r.frequency) {
    case 'daily':
      return itv === '' ? '每天' : `${itv}天`;
    case 'weekly':
      return itv === '' ? '每周' : `${itv}周`;
    case 'monthly':
      return itv === '' ? '每月' : `${itv}月`;
    case 'yearly':
      return itv === '' ? '每年' : `${itv}年`;
  }
}

function amountText(r: RecurringRule): string {
  const sign = r.type === 'income' ? '+' : '-';
  return `${sign}¥${r.amount.toFixed(2)}`;
}

function openCreate() {
  editingRule.value = null;
  editorOpen.value = true;
}

function openEdit(rule: RecurringRule) {
  editingRule.value = rule;
  editorOpen.value = true;
}

async function onSaved() {
  editorOpen.value = false;
  await recurring.load(true);
  // 保存/新建/启用后立即生成到期 Bill，避免用户必须切后台/恢复/重启才看到周期账单
  await recurring.runGenerator();
  await recurring.load(true);
  toast.success('已保存');
}

async function toggleRule(rule: RecurringRule) {
  await recurring.toggle(rule.id, !rule.enabled);
  if (!rule.enabled) {
    // 启用 disabled 规则 → 立即补一次生成，立刻生效到账单
    await recurring.runGenerator();
    await recurring.load(true);
  }
  toast.success(rule.enabled ? '已停用' : '已启用');
}

function requestRemove(rule: RecurringRule) {
  // 打开自定义确认框（不再使用 window.confirm）
  confirmTarget.value = rule;
}
function removeRule() {
  const rule = confirmTarget.value;
  if (!rule) return;
  // 删除规则 = 停止未来生成；已生成历史 Bill 保留不删。
  void recurring.remove(rule.id).then(() => {
    toast.success('已删除（历史账单保留）');
  });
  confirmTarget.value = null;
}

onMounted(async () => {
  loading.value = true;
  try {
    await recurring.load(true);
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <section class="page">
    <header class="page__head">
      <button class="page__back" type="button" aria-label="返回设置" @click="goBackToSettings">
        ‹ 设置
      </button>
      <h1 class="page__title">周期记账</h1>
      <p class="page__desc">到期自动生成账单，计入记账与统计</p>
    </header>

    <div class="rr-list">
      <div v-if="rules.length === 0 && !loading" class="rr-empty">还没有周期规则，点击下方按钮新建一条。</div>

      <div v-for="rule in rules" :key="rule.id" class="rr-item" :class="{ 'is-off': !rule.enabled }">
        <div class="rr-item__main">
          <div class="rr-item__row">
            <span class="rr-item__amount" :class="rule.type">{{ amountText(rule) }}</span>
            <span class="rr-item__note">{{ rule.note || (rule.type === 'income' ? '收入' : '支出') }}</span>
          </div>
          <div class="rr-item__row">
            <span class="rr-item__tag">{{ freqText(rule) }}</span>
            <span class="rr-item__period">{{ periodText(rule) }}</span>
          </div>
          <div class="rr-item__row rr-item__row--muted">
            <span>{{ rule.enabled ? '下次：' + (rule.nextOccurrence ?? '启动后生成') : '已停用' }}</span>
            <span>{{ rule.time }}</span>
          </div>
        </div>
        <div class="rr-item__actions">
          <button type="button" class="rr-act" @click="toggleRule(rule)">
            {{ rule.enabled ? '停用' : '启用' }}
          </button>
          <button type="button" class="rr-act" @click="openEdit(rule)">编辑</button>
          <button type="button" class="rr-act rr-act--danger" @click="requestRemove(rule)">删除</button>
        </div>
      </div>
    </div>

    <div class="rr-add">
      <DVButton class="rr-add__btn" @click="openCreate">＋ 新建周期规则</DVButton>
    </div>

    <RecurringEditorSheet
      v-model="editorOpen"
      :editing="editingRule"
      @saved="onSaved"
    />

    <DVConfirmDialog
      :model-value="confirmTarget !== null"
      title="删除周期规则？"
      confirm-label="删除"
      :danger="true"
      @cancel="confirmTarget = null"
      @confirm="removeRule"
    >
      <p v-if="confirmTarget" class="rr-confirm__note">「{{ confirmTarget.note || amountText(confirmTarget) }}」</p>
      <p class="rr-confirm__hint">删除规则只会停止未来自动记账，已经生成的历史账单不会删除。</p>
    </DVConfirmDialog>
  </section>
</template>

<style scoped>
.page {
  padding: var(--dv-space-md);
  padding-top: calc(var(--dv-space-md) + var(--dv-safe-top));
}
.page__head {
  display: flex;
  flex-direction: column;
  gap: var(--dv-space-xs);
  margin-bottom: var(--dv-space-md);
}
.page__back {
  align-self: flex-start;
  border: none;
  background: none;
  padding: 4px 0;
  color: var(--dv-primary);
  font-size: 14px;
  cursor: pointer;
}
.page__title {
  font-size: 20px;
  color: var(--dv-on-surface);
}
.page__desc {
  color: var(--dv-on-surface-variant);
  font-size: 13px;
}
.rr-list {
  display: flex;
  flex-direction: column;
  gap: var(--dv-space-sm);
}
.rr-empty {
  padding: var(--dv-space-lg) var(--dv-space-md);
  text-align: center;
  color: var(--dv-on-surface-variant);
  font-size: 14px;
  background: var(--dv-surface-alt);
  border-radius: var(--dv-radius-md);
}
.rr-item {
  border: 1px solid var(--dv-outline);
  border-radius: var(--dv-radius-md);
  background: var(--dv-surface);
  padding: var(--dv-space-sm) var(--dv-space-md);
  display: flex;
  flex-direction: column;
  gap: var(--dv-space-xs);
}
.rr-item.is-off {
  opacity: 0.55;
}
.rr-item__row {
  display: flex;
  align-items: baseline;
  gap: var(--dv-space-xs);
}
.rr-item__row--muted {
  font-size: 12px;
  color: var(--dv-on-surface-variant);
  justify-content: space-between;
}
.rr-item__amount {
  font-size: 17px;
  font-weight: 700;
}
.rr-item__amount.expense {
  color: var(--dv-expense);
}
.rr-item__amount.income {
  color: var(--dv-income);
}
.rr-item__note {
  font-size: 14px;
  color: var(--dv-on-surface);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.rr-item__tag {
  font-size: 12px;
  padding: 1px 8px;
  border-radius: var(--dv-radius-pill);
  background: var(--dv-surface-alt);
  color: var(--dv-on-surface-variant);
}
.rr-item__period {
  font-size: 13px;
  color: var(--dv-on-surface-variant);
}
.rr-item__actions {
  display: flex;
  gap: var(--dv-space-xs);
}
.rr-act {
  border: 1px solid var(--dv-outline);
  border-radius: var(--dv-radius-pill);
  background: var(--dv-surface-alt);
  color: var(--dv-on-surface);
  font-size: 12px;
  padding: 4px 12px;
  cursor: pointer;
}
.rr-act--danger {
  color: var(--dv-danger);
}
.rr-add {
  margin-top: var(--dv-space-lg);
}
.rr-add__btn {
  width: 100%;
}
.rr-confirm__note {
  font-size: 15px;
  font-weight: 600;
  color: var(--dv-on-surface);
}
.rr-confirm__hint {
  font-size: 13px;
  color: var(--dv-on-surface-variant);
  line-height: 1.5;
}
</style>