<script setup lang="ts">
/**
 * DailyValueAddSheet — 日价页独立「新增/编辑日价物品」面板（2.9.5 FIX-05/06）
 * - 日价页无需绕到记账页即可独立添加一条日价项目
 * - 保存为 Bill：type=expense / source=manual / ledgerImpact='daily-value-only'
 *   （只进入日价模块，不进账单时间线/月支出/统计，不污染现金流）
 * - dailyValue = { enabled: true, mode: 'elapsed', startDate: 选择的起算日期 }
 * - 编辑模式：复用同一表单 patch 对应 Bill（保持 id / ledgerImpact 不变）
 */
import { computed, ref, watch } from 'vue';
import { DVSheet, DVInput, DVButton, toast } from '@/components/design';
import type { DateTimeValue } from '@/components/design/DVDateTimeWheelPicker.vue';
import DVDateTimeWheelPicker from '@/components/design/DVDateTimeWheelPicker.vue';
import DVCategoryPicker from '@/components/category/DVCategoryPicker.vue';
import DVCategoryIcon from '@/components/category/DVCategoryIcon.vue';
import { useCategoryStore } from '@/core/store/category';
import { useBillStore } from '@/core/store/bill';
import { localDateKey } from '@/core/models/daily-value';
import type { Bill, Category } from '@/core/models/types';

const props = withDefaults(
  defineProps<{
    modelValue: boolean;
    /** 编辑模式：传入 bill 时为编辑（保存调用 update），否则为新增（add） */
    editingBill?: Bill | null;
  }>(),
  { modelValue: false, editingBill: null },
);
const emit = defineEmits<{ 'update:modelValue': [value: boolean]; saved: [] }>();

const categoryStore = useCategoryStore();
const billStore = useBillStore();

/* ---- 表单状态 ---- */
const title = ref('');
const amount = ref('');
const categoryId = ref<string | null>(null);
const startDate = ref(localDateKey());
const note = ref('');
const categoryPickerOpen = ref(false);
const datePickerOpen = ref(false);
const saving = ref(false);

const isEdit = computed(() => Boolean(props.editingBill));
const selectedCategory = computed<Category | null>(() =>
  categoryId.value ? (categoryStore.byId(categoryId.value) ?? null) : null,
);

/** DVCategoryPicker 转发的删除事件：删除的正是当前选中的分类时立即清空，禁止保存悬空分类 id */
function onPickedCategoryDeleted(deletedId: string) {
  if (categoryId.value === deletedId) {
    categoryId.value = null;
    toast.info('当前选中分类已删除，请重新选择分类');
  }
}

/** 起算日期展示（如 8月26日） */
function dateText(date: string): string {
  const [, m, d] = date.split('-').map(Number);
  return `${m}月${d}日`;
}

/* ---- 打开：新增重置 / 编辑回显 ---- */
watch(
  () => props.modelValue,
  (open) => {
    if (!open) return;
    void categoryStore.load();
    if (props.editingBill) {
      const b = props.editingBill;
      title.value = b.title ?? '';
      amount.value = b.amount ? String(b.amount) : '';
      categoryId.value = b.categoryId;
      startDate.value = b.dailyValue?.startDate ?? b.date;
      note.value = b.note ?? '';
    } else {
      title.value = '';
      amount.value = '';
      categoryId.value = null;
      startDate.value = localDateKey();
      note.value = '';
    }
  },
  { immediate: true },
);

/* ---- 日期滚轮 ---- */
const wheelValue = ref<DateTimeValue>({ year: 0, month: 1, day: 1, hour: 0, minute: 0 });
function syncWheelFromStartDate() {
  const [y, m, d] = startDate.value.split('-').map(Number);
  wheelValue.value = { year: y, month: m, day: d, hour: 0, minute: 0 };
}
function openDatePicker() {
  syncWheelFromStartDate();
  datePickerOpen.value = true;
}
function onWheelChange(v: DateTimeValue) {
  startDate.value = `${v.year}-${String(v.month).padStart(2, '0')}-${String(v.day).padStart(2, '0')}`;
}

/* ---- 保存 ---- */
async function save() {
  if (saving.value) return;
  const name = title.value.trim();
  const amt = Number(amount.value);
  if (!name) {
    toast.info('请输入名称');
    return;
  }
  if (!amt || amt <= 0) {
    toast.info('请输入金额');
    return;
  }
  if (!categoryId.value) {
    toast.info('请选择分类');
    return;
  }
  const cat = selectedCategory.value;
  saving.value = true;
  try {
    const dailyValue = { enabled: true, mode: 'elapsed' as const, startDate: startDate.value };
    const editable = {
      title: name,
      amount: Math.round(amt * 100) / 100,
      categoryId: categoryId.value,
      categoryEmoji: cat?.emoji ?? '📦',
      categoryName: cat?.name ?? '未分类',
      note: note.value.trim(),
      date: startDate.value,
      dailyValue,
    };
    if (isEdit.value && props.editingBill) {
      // 编辑：只 patch 用户可编辑字段，保持 id / source / ledgerImpact 不变
      await billStore.update(props.editingBill.id, editable);
      toast.success('已保存修改');
    } else {
      await billStore.add({
        ...editable,
        type: 'expense',
        source: 'manual',
        // 关键：仅日价作用域，不进账单时间线 / 月支出 / 统计
        ledgerImpact: 'daily-value-only',
        timestamp: Date.now(),
      });
      toast.success('已添加日价物品');
    }
    emit('saved');
    emit('update:modelValue', false);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <DVSheet
    :model-value="modelValue"
    :title="isEdit ? '编辑日价物品' : '添加日价物品'"
    :max-height="'82vh'"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div class="dvas">
      <DVInput v-model="title" mode="text" label="名称" placeholder="如：MacBook / 咖啡" maxlength="30" />
      <DVInput v-model="amount" mode="amount" prefix="¥" size="lg" label="金额" placeholder="0.00" />
      <DVInput v-model="note" mode="text" label="备注（可选）" placeholder="补充说明" />

      <!-- 分类：紧凑选择行 → 打开 DVCategoryPicker -->
      <label class="dvas__label">分类</label>
      <button type="button" class="dvas__row" aria-label="选择分类" @click="categoryPickerOpen = true">
        <span class="dvas__row-value">
          <DVCategoryIcon :category="selectedCategory ?? { emoji: '📦' }" :size="20" class="dvas__row-glyph" />
          <span>{{ selectedCategory?.name ?? '请选择分类' }}</span>
        </span>
        <span class="dvas__row-chev" aria-hidden="true">›</span>
      </button>

      <!-- 起算日期：紧凑选择行 → 打开日期滚轮（仅日期） -->
      <label class="dvas__label">起算日期</label>
      <button type="button" class="dvas__row" aria-label="选择起算日期" @click="openDatePicker">
        <span class="dvas__row-value">{{ startDate }}（{{ dateText(startDate) }}）</span>
        <span class="dvas__row-chev" aria-hidden="true">›</span>
      </button>

      <p class="dvas__hint">
        该物品只进入「日价」模块，不会出现在记账时间线 / 月度支出 / 统计中。
      </p>

      <!-- 保存：Sheet 内 sticky footer -->
      <div class="dvas__footer">
        <DVButton block size="lg" :disabled="saving" @click="save">
          {{ saving ? '保存中…' : (isEdit ? '保存修改' : '添加') }}
        </DVButton>
      </div>
    </div>
  </DVSheet>

  <DVCategoryPicker
    :visible="categoryPickerOpen"
    :selected-id="categoryId"
    @close="categoryPickerOpen = false"
    @change="(cat) => { categoryId = cat.id; categoryPickerOpen = false; }"
    @deleted="onPickedCategoryDeleted"
  />

  <DVDateTimeWheelPicker
    :model-value="wheelValue"
    :visible="datePickerOpen"
    :show-time="false"
    @close="datePickerOpen = false"
    @update:model-value="onWheelChange"
  />
</template>

<style scoped>
.dvas {
  display: flex;
  flex-direction: column;
  gap: var(--dv-space-sm);
}
.dvas__label {
  font-size: 12px;
  color: var(--dv-on-surface-variant);
  margin-top: var(--dv-space-xxs);
}
.dvas__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 44px;
  padding: 0 var(--dv-space-sm);
  border: 1px solid var(--dv-outline);
  border-radius: var(--dv-radius-md);
  background: var(--dv-surface-alt);
  color: var(--dv-on-surface);
  font-size: 14px;
}
.dvas__row-value {
  display: flex;
  align-items: center;
  gap: var(--dv-space-xs);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dvas__row-glyph {
  font-size: 18px;
  line-height: 1;
}
.dvas__row-chev {
  color: var(--dv-on-surface-variant);
  font-size: 16px;
}
.dvas__hint {
  font-size: 12px;
  color: var(--dv-on-surface-variant);
  line-height: 1.6;
  padding: var(--dv-space-xxs) var(--dv-space-xxs) 0;
}
.dvas__footer {
  margin-top: var(--dv-space-xs);
}
</style>
