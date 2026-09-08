<script setup lang="ts">
/**
 * RecurringEditorSheet — 周期记账规则 新建/编辑 弹层（Phase 7A）。
 * 复用 Design System：DVSheet / DVInput / DVWheelPicker / DVDateTimeWheelPicker。
 * 保存：新建走 add；编辑走 update（只影响尚未发生的 occurrence；已生成历史 Bill 不变）。
 */
import { computed, ref, watch } from 'vue';
import { DVSheet, DVInput, DVDateTimeWheelPicker, toast } from '@/components/design';
import type { DateTimeValue } from '@/components/design/DVDateTimeWheelPicker.vue';
import { useRecurringStore, type RecurringRuleInput } from '@/core/store/recurring';
import { sanitizeRecurringRule } from '@/core/recurring/generator';
import { useCategoryStore } from '@/core/store/category';
import type { BillType, Category, RecurringFrequency, RecurringRule } from '@/core/models/types';
import { localDateKey } from '@/core/models/daily-value';
import RecurringPeriodPicker, { type PeriodFreq, type PeriodValue } from '@/pages/settings/RecurringPeriodPicker.vue';
import DVCategoryPicker from '@/components/category/DVCategoryPicker.vue';
import DVCategoryIcon from '@/components/category/DVCategoryIcon.vue';

const props = defineProps<{
  modelValue: boolean;
  /** 编辑模式：传入已有规则；null / undefined 为新建 */
  editing?: RecurringRule | null;
}>();
const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  saved: [];
}>();

const recurring = useRecurringStore();
const categoryStore = useCategoryStore();

interface FormState {
  type: BillType;
  amount: string;
  categoryId: string;
  note: string;
  frequency: RecurringFrequency;
  interval: number;
  day: number; // weekly->weekday(0-6)，monthly/yearly->day of month
  month: number; // yearly
  startDate: string;
  time: string;
}

const freqLabels: Record<RecurringFrequency, string> = {
  daily: '每天',
  weekly: '每周',
  monthly: '每月',
  yearly: '每年',
};
const weekdayLabels = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

const form = ref<FormState>({
  type: 'expense',
  amount: '',
  categoryId: 'c-food',
  note: '',
  frequency: 'monthly',
  interval: 1,
  day: 1,
  month: 1,
  startDate: localDateKey(),
  time: '09:00',
});

const saving = ref(false);
const pickerOpen = ref(false);
const periodPickerOpen = ref(false);
const categoryPickerOpen = ref(false);

/**
 * 用户是否已明确选择过分类（含新添加的自定义分类）。
 * 用于「切换到收入时清空默认 c-food」：仅当分类仍是初始默认且用户从未手动选择时才清空，
 * 用户自己明确选过（含选中 c-food 本身）则允许保留，不强改；编辑已有规则不自动改原分类。
 */
const userTouchedCategory = ref(false);

/**
 * 当前选中分类（供选择行展示）。
 * categoryId 为空（收入默认分类被清空，等待用户选择）时显示「请选择分类」提示。
 * 若类别已被删除（categoryId 不在 store），使用统一 fallback 📄 未分类，
 * 保证选择行不空白、保存不因缺失 categoryId 而失败（buildInput 同样兜底）。
 */
const selectedCategory = computed<Category>(() => {
  if (!form.value.categoryId) {
    return { id: '', emoji: '❓', name: '请选择分类', builtin: false, sort: 0 };
  }
  return (
    categoryStore.byId(form.value.categoryId) ?? { id: form.value.categoryId, emoji: '📄', name: '未分类', builtin: false, sort: 0 }
  );
});
function openCategoryPicker() {
  categoryPickerOpen.value = true;
}
function onCategoryChange(cat: Category) {
  form.value.categoryId = cat.id;
  userTouchedCategory.value = true;
  categoryPickerOpen.value = false;
}
/** DVCategoryPicker 转发的删除事件：删除的正是当前表单选中的分类时立即清空，禁止保存悬空分类 id */
function onPickedCategoryDeleted(deletedId: string) {
  if (form.value.categoryId === deletedId) {
    form.value.categoryId = '';
    toast.info('当前选中分类已删除，请重新选择分类');
  }
}

/** 类型切换：收入且分类仍为初始默认 c-food（用户未手动选过）时清空，提示重新选择分类 */
function setType(type: BillType) {
  form.value.type = type;
  if (type === 'income' && !userTouchedCategory.value && form.value.categoryId === 'c-food') {
    form.value.categoryId = '';
  }
}

/** 间隔单位（独立，不与频率「每天/每月…」混排，避免出现「每 1 每月」） */
const intervalUnits: Record<RecurringFrequency, string> = {
  daily: '天',
  weekly: '周',
  monthly: '月',
  yearly: '年',
};

/* ---- 周期日期：紧凑选择行 → 独立 Picker ---- */
/** monthly/yearly/day/weekly 行摘要文案 */
const periodSummary = computed(() => {
  switch (form.value.frequency) {
    case 'weekly':
      return weekdayLabels[form.value.day] ?? '周日';
    case 'monthly':
      return `${form.value.day} 日`;
    case 'yearly':
      return `${form.value.month ?? 1} 月 ${form.value.day} 日`;
    default:
      return '';
  }
});
function openPeriodPicker() {
  if (form.value.frequency === 'daily') return; // 每天：无额外周期日期
  periodPickerOpen.value = true;
}
/** 周期 Picker 只用于 weekly/monthly/yearly（daily 无额外周期日期） */
const periodFreq = computed<PeriodFreq>(() =>
  form.value.frequency === 'weekly' || form.value.frequency === 'monthly' || form.value.frequency === 'yearly'
    ? form.value.frequency
    : 'monthly',
);
function onPeriodChange(v: PeriodValue) {
  form.value.day = v.day;
  if (form.value.frequency === 'yearly' && v.month != null) form.value.month = v.month;
  periodPickerOpen.value = false;
}

/* ---- 日期时间选择（开始日期 + occurrence 时间；allowFuture=true 允许未来排期） ---- */
const dateTimeValue = ref<DateTimeValue>({
  year: new Date().getFullYear(),
  month: new Date().getMonth() + 1,
  day: new Date().getDate(),
  hour: 9,
  minute: 0,
});

function dateTimeFrom(form: FormState): DateTimeValue {
  const [y, m, d] = form.startDate.split('-').map(Number);
  const [hh, mm] = form.time.split(':').map(Number);
  return { year: y, month: m, day: d, hour: hh || 0, minute: mm || 0 };
}
function pad2(n: number): string {
  return String(n).padStart(2, '0');
}
function onDateTimePick(v: DateTimeValue) {
  // 同步 picker 模型值：二次打开时仍显示刚选择的新日期时间，避免回到旧值/覆盖
  dateTimeValue.value = { ...v };
  form.value.startDate = `${v.year}-${pad2(v.month)}-${pad2(v.day)}`;
  form.value.time = `${pad2(v.hour)}:${pad2(v.minute)}`;
  pickerOpen.value = false;
}

/* ---- 打开时初始化表单 ---- */
watch(
  () => props.modelValue,
  (open) => {
    if (!open) return;
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    (async () => {
      await categoryStore.load();
    })();
    if (props.editing) {
      // 编辑已有规则：不自动修改原分类（用户切换收入也不清空）
      userTouchedCategory.value = true;
      form.value = {
        type: props.editing.type,
        amount: String(props.editing.amount),
        categoryId: props.editing.categoryId,
        note: props.editing.note,
        frequency: props.editing.frequency,
        interval: props.editing.interval,
        day: props.editing.day,
        month: props.editing.month ?? new Date(props.editing.startDate + 'T00:00:00').getMonth() + 1,
        startDate: props.editing.startDate,
        time: props.editing.time,
      };
    } else {
      const now = new Date();
      const today = localDateKey(now);
      userTouchedCategory.value = false;
      form.value = {
        type: 'expense',
        amount: '',
        categoryId: 'c-food',
        note: '',
        frequency: 'monthly',
        interval: 1,
        day: now.getDate(),
        month: now.getMonth() + 1,
        startDate: today,
        time: '09:00',
      };
    }
    dateTimeValue.value = dateTimeFrom(form.value);
  },
  { immediate: true },
);

/* ---- 周期切换时规范化 day（weekly 0-6；monthly/yearly 1-31） ---- */
function normalizeDay(freq: RecurringFrequency, day: number): number {
  if (freq === 'weekly') {
    // 从 monthly 等切到 weekly：原来可能是 24 这类越界值，落到 0-6；越界则取当前星期
    return day >= 0 && day <= 6 ? day : new Date().getDay();
  }
  // weekly 切到 monthly/yearly：0（周日的含义）不合法，落到 1；否则 1-31 内
  return Math.min(31, Math.max(1, day));
}

function setFrequency(freq: RecurringFrequency) {
  form.value.frequency = freq;
  form.value.day = normalizeDay(freq, form.value.day);
}

/* ---- 校验 + 保存 ---- */
function buildInput(): RecurringRuleInput {
  const amount = Number(form.value.amount);
  // 复用 generator 的统一 sanitize，保证 interval/weekly day/monthly day/yearly month/day/time 一律合法，
  // 杜绝 2026-09-00 之类非法业务日期被写库后再由 generator 防御（双保险，此处提交前即规范化）
  return sanitizeRecurringRule({
    enabled: props.editing ? props.editing.enabled : true,
    type: form.value.type,
    amount,
    categoryId: form.value.categoryId,
    categoryEmoji: categoryStore.byId(form.value.categoryId)?.emoji ?? '📄',
    categoryName: categoryStore.byId(form.value.categoryId)?.name ?? '未分类',
    note: form.value.note,
    frequency: form.value.frequency,
    interval: Math.max(1, form.value.interval || 1),
    day: normalizeDay(form.value.frequency, form.value.day),
    month: form.value.frequency === 'yearly' ? form.value.month : undefined,
    startDate: form.value.startDate,
    time: form.value.time,
  });
}

async function save() {
  if (saving.value) return;
  const amount = Number(form.value.amount);
  if (!amount || amount <= 0) {
    toast.error('金额必须大于 0');
    return;
  }
  if (!form.value.categoryId) {
    toast.info('请选择分类');
    return;
  }
  if (form.value.startDate < localDateKey()) {
    toast.info('开始日期早于今天，将按到期日补齐生成历史账单');
  }
  saving.value = true;
  try {
    if (props.editing) {
      // 编辑已有规则 → 打上生效边界(now)，历史 occurrence 不再回填，只影响未来
      await recurring.update(props.editing.id, {
        ...buildInput(),
        scheduleEffectiveAt: Date.now(),
      });
    } else {
      // 新建规则 → 允许按 startDate 正常历史 catch-up，scheduleEffectiveAt 留空
      await recurring.create(buildInput());
    }
    emit('saved');
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <DVSheet :model-value="modelValue" :title="editing ? '编辑周期规则' : '新建周期规则'" :scrollable="false" @update:model-value="emit('update:modelValue', $event)">
    <div class="rr-form">
      <!-- 表单主体：独立滚动（flex 填满非 scrollable body），超高时整体滚动而不是压缩表单字号 -->
      <div class="rr-form__fields">
      <!-- 类型 -->
      <div class="rf-seg" role="radiogroup" aria-label="类型">
        <button
          type="button"
          class="rf-seg__item"
          :class="[`is-${form.type}`, { 'is-active': form.type === 'expense' }]"
          @click="setType('expense')"
        >支出</button>
        <button
          type="button"
          class="rf-seg__item"
          :class="[`is-${form.type}`, { 'is-active': form.type === 'income' }]"
          @click="setType('income')"
        >收入</button>
      </div>

      <!-- 金额：¥ 前缀 + 左对齐（DVInput 默认右对齐全局行为不变，此处显式 left/lg） -->
      <DVInput
        v-model="form.amount"
        mode="amount"
        amount-align="left"
        prefix="¥"
        size="lg"
        label="金额"
        placeholder="0.00"
      />

      <!-- 分类：紧凑选择行 → 打开自定义 DVCategoryPicker（不再使用原生 <select>） -->
      <label class="rf-label">分类</label>
      <button type="button" class="rf-cat-row" aria-label="选择分类" @click="openCategoryPicker">
        <span class="rf-cat__value"><span class="rf-cat__emoji"><DVCategoryIcon :category="selectedCategory" :size="22" /></span>{{ selectedCategory.name }}</span>
        <span class="rf-cat-row__chev" aria-hidden="true">›</span>
      </button>

      <!-- 备注（可选）：新建可填、编辑回显、保存写回；已生成历史 Bill 不受规则编辑影响 -->
      <DVInput v-model="form.note" mode="text" label="备注（可选）" placeholder="例如：工资 / Netflix / 房租" />

      <!-- 频率 -->
      <label class="rf-label">周期</label>
      <div class="rf-freq">
        <button
          v-for="(label, key) in freqLabels"
          :key="key"
          type="button"
          class="rf-freq__item"
          :class="{ 'is-active': form.frequency === key }"
          @click="setFrequency(key as RecurringFrequency)"
        >{{ label }}</button>
      </div>

      <!-- 间隔：unit 用「天/周/月/年」，不用「每天/每月…」 -->
      <div class="rf-row">
        <label class="rf-label">间隔</label>
        <div class="rf-interval">
          <span class="rf-interval__prefix">每</span>
          <input v-model.number="form.interval" type="number" min="1" max="999" class="rf-interval__input" />
          <span class="rf-interval__suffix">{{ intervalUnits[form.frequency] }}</span>
        </div>
      </div>

      <!-- 周期日期：紧凑选择行 → 点击打开独立 Picker（不内嵌常驻滚轮） -->
      <template v-if="form.frequency === 'weekly'">
        <label class="rf-label">重复星期</label>
        <button type="button" class="rf-period" @click="openPeriodPicker">
          <span>{{ periodSummary }}</span>
          <span class="rf-period__chev" aria-hidden="true">›</span>
        </button>
      </template>
      <template v-else-if="form.frequency === 'monthly'">
        <label class="rf-label">每月日期</label>
        <button type="button" class="rf-period" @click="openPeriodPicker">
          <span>{{ periodSummary }}</span>
          <span class="rf-period__chev" aria-hidden="true">›</span>
        </button>
      </template>
      <template v-else-if="form.frequency === 'yearly'">
        <label class="rf-label">每年日期</label>
        <button type="button" class="rf-period" @click="openPeriodPicker">
          <span>{{ periodSummary }}</span>
          <span class="rf-period__chev" aria-hidden="true">›</span>
        </button>
      </template>

      <!-- 开始日期 / 时间 -->
      <label class="rf-label">开始日期 / 时间</label>
      <button type="button" class="rf-datetime" @click="pickerOpen = true">
        <span>{{ form.startDate }} {{ form.time }}</span>
        <span class="rf-datetime__chev" aria-hidden="true">›</span>
      </button>

      </div>

      <!-- 保存：Sheet 内 sticky footer，始终完整可见（safe-bottom 由 DVSheet 面板底部 padding 承载） -->
      <div class="rr-footer">
        <button type="button" class="rr-footer__save" :disabled="saving" @click="save">
          {{ saving ? '保存中…' : '保存' }}
        </button>
      </div>
    </div>
  </DVSheet>

  <DVDateTimeWheelPicker
    :model-value="dateTimeValue"
    :visible="pickerOpen"
    allow-future
    @close="pickerOpen = false"
    @update:model-value="onDateTimePick"
  />

  <RecurringPeriodPicker
    :visible="periodPickerOpen"
    :frequency="periodFreq"
    :day="form.day"
    :month="form.frequency === 'yearly' ? form.month : undefined"
    @close="periodPickerOpen = false"
    @change="onPeriodChange"
  />

  <DVCategoryPicker
    :visible="categoryPickerOpen"
    :selected-id="form.categoryId"
    @close="categoryPickerOpen = false"
    @change="onCategoryChange"
    @deleted="onPickedCategoryDeleted"
  />
</template>

<style scoped>
.rr-form {
  display: flex;
  flex-direction: column;
  /* flex 填满非 scrollable body（同 QuickEntrySheet .qe 模式），不用 height:100% */
  flex: 1 1 auto;
  min-height: 0;
}
/* 表单主体：独立滚动；子项不参与压缩，超高时整体滚动而不是压缩表单字号 */
.rr-form__fields {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
  display: flex;
  flex-direction: column;
  gap: var(--dv-space-sm);
  /* 底部预留足够空间：最后一项（开始日期/时间）滚到最底部也能完整停在 sticky footer 之上；
     scroll-padding-bottom 让聚焦/滚动锚定同样尊重该间距（IME 打开时亦成立） */
  padding-bottom: var(--dv-space-lg);
  scroll-padding-bottom: var(--dv-space-lg);
}
.rr-form__fields > * {
  flex-shrink: 0;
}
.rf-seg {
  display: flex;
  gap: var(--dv-space-xs);
  padding: 3px;
  background: var(--dv-surface-alt);
  border-radius: var(--dv-radius-md);
}
.rf-seg__item {
  flex: 1;
  padding: 8px 10px;
  border: none;
  border-radius: var(--dv-radius-sm);
  background: transparent;
  color: var(--dv-on-surface-variant);
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
}
.rf-seg__item.is-expense.is-active {
  background: var(--dv-expense);
}
.rf-seg__item.is-income.is-active {
  background: var(--dv-income);
}
.rf-seg__item.is-active {
  color: var(--dv-on-primary);
}
.rf-label {
  font-size: 12px;
  color: var(--dv-on-surface-variant);
}
.rf-cat__value {
  display: inline-flex;
  align-items: center;
  gap: var(--dv-space-xxs);
}
.rf-cat__emoji {
  font-size: 22px; /* 图标放大：选择行更明显的识别元素 */
}
.rf-freq {
  display: flex;
  gap: var(--dv-space-xs);
  padding: 3px;
  background: var(--dv-surface-alt);
  border-radius: var(--dv-radius-md);
}
.rf-freq__item {
  flex: 1;
  padding: 8px 4px;
  border: none;
  border-radius: var(--dv-radius-sm);
  background: transparent;
  color: var(--dv-on-surface-variant);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
}
.rf-freq__item.is-active {
  background: var(--dv-primary);
  color: var(--dv-on-primary);
}
.rf-row {
  display: flex;
  flex-direction: column;
  gap: var(--dv-space-xs);
}
.rf-interval {
  display: flex;
  align-items: center;
  gap: var(--dv-space-sm);
}
.rf-interval__input {
  width: 72px;
  height: 44px;
  text-align: center;
  border: 1px solid var(--dv-outline);
  border-radius: var(--dv-radius-md);
  background: var(--dv-surface-alt);
  color: var(--dv-on-surface);
  font-size: 18px;
  font-weight: 600;
}
.rf-interval__prefix,
.rf-interval__suffix {
  color: var(--dv-on-surface-variant);
  font-size: 14px;
}
/* 周期日期选择行：紧凑列表项，点击打开独立 Picker（不再内嵌滚轮撑高表单） */
.rf-period {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 44px;
  padding: 0 var(--dv-space-sm);
  border: 1px solid var(--dv-outline);
  border-radius: var(--dv-radius-md);
  background: var(--dv-surface-alt);
  color: var(--dv-on-surface);
  font-size: 15px;
  cursor: pointer;
}
.rf-period__chev {
  color: var(--dv-on-surface-variant);
  font-size: 18px;
}
/* 分类选择行：与周期日期选择行同一视觉语言（独立类名，避免与 .rf-period 混淆） */
.rf-cat-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 44px;
  padding: 0 var(--dv-space-sm);
  border: 1px solid var(--dv-outline);
  border-radius: var(--dv-radius-md);
  background: var(--dv-surface-alt);
  color: var(--dv-on-surface);
  font-size: 15px;
  cursor: pointer;
}
.rf-cat-row__chev {
  color: var(--dv-on-surface-variant);
  font-size: 18px;
}
.rf-datetime {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 44px;
  padding: 0 var(--dv-space-sm);
  border: 1px solid var(--dv-outline);
  border-radius: var(--dv-radius-md);
  background: var(--dv-surface-alt);
  color: var(--dv-on-surface);
  font-size: 15px;
  cursor: pointer;
}
.rf-datetime__chev {
  color: var(--dv-on-surface-variant);
  font-size: 18px;
}
.rr-footer {
  flex-shrink: 0;
  margin-top: var(--dv-space-sm);
  padding-top: var(--dv-space-sm);
  border-top: 1px solid var(--dv-outline);
  /* safe-bottom 由 DVSheet 面板底部 padding 承载，此处不重复叠加 */
}
.rr-footer__save {
  width: 100%;
  height: 48px;
  border: none;
  border-radius: var(--dv-radius-pill);
  background: var(--dv-primary);
  color: var(--dv-on-primary);
  font-size: 16px;
  font-weight: 600;
  cursor: pointer;
}
.rr-footer__save:disabled {
  opacity: 0.5;
}
</style>