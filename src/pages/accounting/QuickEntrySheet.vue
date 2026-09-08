<script setup lang="ts">
/**
 * 快速记账 Bottom Sheet（Phase 3 记账主界面 + 2.9.7 Category Final Refactor）
 * - 支出 / 收入切换
 * - 金额数字键盘（自定义，无系统键盘干扰）
 * - 日期 / 时间入口：默认今天 / 当前时间，点击才展开选择（QUICK-01）
 * - 分类选择：最近使用（按最近使用时间排序，最多 5 个）+ 第 6 位展开按钮
 * - 展开后显示全部分类，末尾 [＋ 添加分类]（CATEGORY-01~04）
 * - 备注输入：点击切换到系统文字键盘（数字键盘 / 文字键盘切换，IME-01）
 * - 分类「新增 / 编辑 / 修改图标 / 删除」统一走 DVCategoryManager（唯一实现）：
 *   头部显式「管理」按钮 + 展开网格末尾「添加分类」按钮 + 长按分类快捷进入管理
 * - saving 状态防止快速双击生成两笔账（QUICK-02）
 *
 * 2.10.0（P0）：编辑模式「删除账单」入口从主内容区移入 Sheet Header actions
 * （约 40×40 danger icon），不再额外占用 QuickEntry 主内容一整行，
 * 恢复「支出/收入、金额、日期时间、日价、最近使用、数字键盘、保存」全自然可见；
 * 新增模式不显示删除按钮，Edit/Create 主体布局高度一致。
 *
 * 2.9.7 变更：根节点移除 @mousedown.prevent（避免阻止内部原生 input 聚焦/输入）；
 * 文本输入显式 user-select: text；不再维护 QuickEntry 自研分类管理逻辑。
 */
import { computed, ref, watch, onMounted, onBeforeUnmount, nextTick } from 'vue';
import { Capacitor } from '@capacitor/core';
import {
  DVSheet,
  DVButton,
  DVDateTimeWheelPicker,
  DVConfirmDialog,
  toast,
} from '@/components/design';
import type { DateTimeValue } from '@/components/design/DVDateTimeWheelPicker.vue';
import { unregisterOverlayForBack } from '@/components/design/back-handler';
import { useCategoryStore } from '@/core/store/category';
import { useBillStore } from '@/core/store/bill';
import { localDateKey, msUntilNextLocalMidnight } from '@/core/models/daily-value';
import DVCategoryIcon from '@/components/category/DVCategoryIcon.vue';
import DVCategoryManager from '@/components/category/DVCategoryManager.vue';
import type { BillType, Category, Bill } from '@/core/models/types';

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
const billType = ref<BillType>('expense');
const amount = ref('');
const categoryId = ref<string | null>(null);
const note = ref('');
/** 键盘模式：number 自定义数字键盘 / text 系统文字键盘（备注输入）。
 *  数字键盘始终可见；text 模式仅切换备注为可编辑 input，点任意数字键立即切回金额。 */
const keyboardMode = ref<'number' | 'text'>('number');
/** 当前焦点输入区：amount 金额（默认）/ note 备注。备注失焦时切回金额并收起系统 IME。 */
const activeInput = ref<'amount' | 'note'>('amount');
const showAllCategories = ref(false);
/** 分类管理统一入口（DVCategoryManager）：头部「管理」/ 网格末尾「添加分类」/ 长按分类 */
const categoryManagerOpen = ref(false);
const categoryManagerCreateOnOpen = ref(false);
const noteInputRef = ref<HTMLInputElement | null>(null);
/** 顶部信息区（可滚动）与固定底部输入区的引用，用于展开分类后自动滚动到键盘上方 */
const infoRef = ref<HTMLElement | null>(null);
const padRef = ref<HTMLElement | null>(null);
/** 保存中标记：防止快速双击生成两笔账（QUICK-02） */
const saving = ref(false);
/* ---- 编辑模式删除账单（2.9.9 主账单删除闭环） ---- */
/** 删除执行中：防止快速连续点击确认重复 remove（BILL-DEL-10） */
const deleting = ref(false);
/** 删除确认 Dialog 是否打开（仅 isEdit 显示删除入口） */
const deleteConfirmOpen = ref(false);
/** 删除确认文案：周期生成账单附注「只删除本次账单，不影响后续周期记账」 */
const deleteHintText = computed(() =>
  props.editingBill?.source === 'recurring'
    ? '删除后无法恢复。只删除本次账单，不影响后续周期记账。'
    : '删除后无法恢复。',
);
/** 「计算日价」轻量开关（默认关闭；开启后该笔账仍为 normal Bill，仅附带 dailyValue 扩展） */
const enableDailyValue = ref(false);

/* ---- 日期 / 时间（默认今天 / 当前时间，点击入口打开滚轮选择器） ---- */
/** 跨日感知的“今天”：每次调用实时取，避免组件长期挂载仍停留在创建当天的旧日期 */
function freshToday(): string {
  return localDateKey();
}
const billDate = ref(freshToday());
function pad2(n: number): string {
  return String(n).padStart(2, '0');
}
function currentTime(): string {
  const now = new Date();
  return `${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
}
const billTime = ref(currentTime());
/**
 * 是否仍在使用“默认日期时间”（新增模式打开、尚未手动确认日期时间）。
 * 为 true 时，跨午夜 / App resume 会把 billDate 与 billTime 一起同步为当前本地值；
 * 用户手动确认过日期时间或进入编辑模式后为 false，跨午夜不再覆盖用户选择。
 */
const usingDefaultDateTime = ref(false);
const showDateTime = ref(false);
const dateTimeText = computed(() => {
  const [, m, d] = billDate.value.split('-').map(Number);
  return `${m}月${d}日 ${billTime.value}`;
});
/** 日期时间滚轮当前值（与 DVDateTimeWheelPicker 双向绑定） */
const wheelValue = ref({ year: 0, month: 1, day: 1, hour: 0, minute: 0 });
function syncWheelFromForm() {
  const [y, mo, d] = billDate.value.split('-').map(Number);
  const [hh, mm] = billTime.value.split(':').map(Number);
  wheelValue.value = { year: y, month: mo, day: d, hour: hh, minute: mm };
}
/**
 * Picker「确定」后接收 emit 出来的新值并写回表单。
 * 注意：这里不是 v-model，Picker 只在用户点“确定”时 emit update:modelValue 新值，
 * 因此必须显式接收该新值（v），不能回读旧的 wheelValue（否则用户选择不生效）。
 * 点“取消”（close）不 emit update:modelValue，故 billDate/billTime 保持不变。
 */
function onWheelChange(v: DateTimeValue) {
  usingDefaultDateTime.value = false; // 用户手动确认日期时间后，跨午夜不再自动刷新
  wheelValue.value = { ...v };
  billDate.value = `${v.year}-${pad2(v.month)}-${pad2(v.day)}`;
  billTime.value = `${pad2(v.hour)}:${pad2(v.minute)}`;
}
/** 打开日期时间滚轮选择器：同步当前表单值后显示（独立 Picker，层级在 Sheet 之上） */
function openDateTimePicker() {
  syncWheelFromForm();
  showDateTime.value = true;
}
/** 关闭滚轮选择器（用户确认时已在 update:modelValue 写回） */
function closeDateTimePicker() {
  showDateTime.value = false;
}
/** 组合出账单时间戳（本地业务时间，避免 UTC 跨天偏差） */
function combineTimestamp(date: string, time: string): number {
  const [y, mo, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  return new Date(y, mo - 1, d, hh, mm, 0).getTime();
}

/* ---- 分类数据 ---- */
const allCategories = computed<Category[]>(() => categoryStore.categories);

/**
 * 最近使用分类：按最近一次使用时间排序（date+timestamp），去重取前 5。
 * 从未使用过的分类不参与排序；历史不足 5 个时用默认（builtin）分类补足。
 */
const recentCategories = computed<Category[]>(() => {
  const lastUsed = new Map<string, string>();
  for (const b of billStore.bills) {
    if (b.ledgerImpact === 'daily-value-only') continue;
    const key = `${b.date}T${String(b.timestamp).padStart(13, '0')}`;
    const prev = lastUsed.get(b.categoryId);
    if (prev === undefined || key > prev) lastUsed.set(b.categoryId, key);
  }
  const used = allCategories.value
    .filter((c) => lastUsed.has(c.id))
    .sort((a, b) => (lastUsed.get(b.id) ?? '').localeCompare(lastUsed.get(a.id) ?? ''))
    .slice(0, 5);
  // 历史不足 5 个：用默认分类补足
  for (const c of allCategories.value) {
    if (used.length >= 5) break;
    if (c.builtin && !used.some((u) => u.id === c.id)) used.push(c);
  }
  // 始终把当前选中分类置顶展示：新分类/不常用分类刚选中或刚创建时也能立即看到选中态
  const selected = allCategories.value.find((c) => c.id === categoryId.value);
  if (selected && !used.some((u) => u.id === selected.id)) {
    used.unshift(selected);
  }
  return used.slice(0, 5);
});

/** 是否存在未展示的分类（决定是否显示展开按钮） */
const canExpand = computed(() => allCategories.value.length > recentCategories.value.length);

const selectedCategory = computed<Category | undefined>(() =>
  allCategories.value.find((c) => c.id === categoryId.value),
);

/** 金额有效性：> 0 且 <= 0 时 Save 保持 disabled */
const amountValid = computed(() => Number(amount.value) > 0);

/**
 * 长金额动态字号（避免被截断）：
 * 1~6 位 → 34px；7~9 位 → 30px；更长 → 26px。
 */
const amountSizeClass = computed(() => {
  const len = amount.value.length;
  if (len >= 10) return 'is-xxl';
  if (len >= 7) return 'is-lg';
  return 'is-md';
});

/* ---- 金额输入（数字键盘） ---- */
const KEYS: string[] = ['7', '8', '9', '4', '5', '6', '1', '2', '3', '0', '.', 'back'];

function inputKey(key: string) {
  // 备注输入中点击数字键盘任意键：立即切回金额（blur 备注、收起系统文字键盘），再输入金额
  if (activeInput.value === 'note') {
    void switchToAmount();
  }
  if (key === 'back') {
    amount.value = amount.value.slice(0, -1);
    return;
  }
  if (key === '.') {
    if (!amount.value.includes('.')) amount.value = amount.value ? amount.value + '.' : '0.';
    return;
  }
  // 数字：
  // - 空金额或前导 0 状态：输入 0 保持 "0"；输入其他数字替换为当前位（避免 "05"/"000000"）
  // - 允许 "0.5" 这类小数
  if (amount.value === '' || amount.value === '0') {
    amount.value = key === '0' ? '0' : key;
    return;
  }
  const [intPart = '', decPart] = amount.value.split('.');
  if (decPart !== undefined && decPart.length >= 2) return; // 最多两位小数
  if (decPart === undefined && intPart.length >= 7) return; // 整数最多 7 位
  amount.value = amount.value + key;
}

/* ---- 备注 / 数字键盘切换（真实焦点管理） ----
 * activeInput 追踪当前焦点区：amount 金额（默认） / note 备注。
 * 数字键盘始终可见；text 模式仅把右侧备注切成可编辑 input。
 * 从 note 切回 amount 时强制 note blur，收起系统文字键盘，恢复数字键盘交互。 */
async function switchToAmount() {
  // 在模式切换前捕获仍挂载的备注 input，保证此刻就能调用真实 blur 收起系统文字键盘
  const el = noteInputRef.value;
  const wasNote = activeInput.value === 'note';
  activeInput.value = 'amount';
  keyboardMode.value = 'number';
  if (wasNote && el && document.activeElement === el) {
    el.blur(); // 强制备注失焦，触发系统文字键盘收起
  }
  await nextTick();
}
async function focusNote() {
  activeInput.value = 'note';
  keyboardMode.value = 'text';
  await nextTick();
  noteInputRef.value?.focus();
}
/** 点击左侧金额区：备注正输入时立即切回金额（收起系统键盘），无需先点空白处 */
function onAmountAreaTap() {
  if (activeInput.value === 'note') void switchToAmount();
}
/** 备注失焦：回到金额输入态，自定义数字键盘恢复可交互 */
function onNoteBlur() {
  activeInput.value = 'amount';
  keyboardMode.value = 'number';
}

/* ---- 分类管理统一入口（DVCategoryManager）---- */

/** 展开全部分类。qe__info 可滚动 + qe__input 固定底部：自动滚动 info，
 *  保证第二排分类与末尾 [＋ 添加] 完整出现在数字键盘上方、立即可点，
 *  不要求用户手动上滚。 */
async function expandCategories() {
  showAllCategories.value = true;
  await nextTick();
  const info = infoRef.value;
  const pad = padRef.value;
  if (!info || !pad) return;
  // 目标：末尾 [＋ 添加分类]
  const target = info.querySelector('.qe__cat--add') as HTMLElement | null;
  if (!target) return;
  const padTop = pad.getBoundingClientRect().top;
  // 循环滚动（最多数轮）直到目标底边已完整位于键盘顶边之上（留 8px 边距）
  for (let i = 0; i < 8; i++) {
    const bottom = target.getBoundingClientRect().bottom;
    if (bottom <= padTop - 8) break;
    const before = info.scrollTop;
    info.scrollTop += bottom - padTop + 8;
    if (info.scrollTop === before) break; // 已到顶部无法再滚
  }
}

function onCategoryTap(cat: Category) {
  categoryId.value = cat.id;
  // 展开态选中即收起，回到默认六列（最近使用 + 展开按钮）
  showAllCategories.value = false;
}

/** 打开分类管理（默认列表态） */
function openCategoryManager() {
  categoryManagerCreateOnOpen.value = false;
  categoryManagerOpen.value = true;
}
/** 打开分类管理并直达新增（create mode）：网格末尾 [＋ 添加分类] */
function openCreateCategory() {
  categoryManagerCreateOnOpen.value = true;
  categoryManagerOpen.value = true;
}
/** 长按分类快捷进入管理（显式「管理」按钮始终存在，长按仅加速） */
let pressTimer: ReturnType<typeof setTimeout> | null = null;
function startPress() {
  if (pressTimer) clearTimeout(pressTimer);
  pressTimer = setTimeout(() => {
    pressTimer = null;
    openCategoryManager();
  }, 500);
}
function cancelPress() {
  if (pressTimer) {
    clearTimeout(pressTimer);
    pressTimer = null;
  }
}

/**
 * Manager 新增成功 / 新增时命中重名（duplicate）都回调这里：
 * 直接选中该分类并收起网格，保持「快捷选择 + 杜绝重复分类」的体验。
 */
function onManagerCreated(cat: Category) {
  categoryManagerOpen.value = false;
  categoryId.value = cat.id;
  showAllCategories.value = false;
}

/**
 * Manager 删除成功回调：若删除的正是当前选中分类，立即清空 categoryId 并提示，
 * 杜绝保存时带上一个已不存在的悬空分类 id（CAT-DEL-04）。
 */
function onCategoryDeleted(deletedId: string) {
  if (categoryId.value === deletedId) {
    categoryId.value = null;
    toast.info('当前选中分类已删除，请重新选择分类');
  }
}

/* ---- 保存（saving 防重复提交；编辑模式 = update 保持原 id，新增 = add） ---- */
/** 当前是否为编辑模式 */
const isEdit = computed(() => Boolean(props.editingBill));
/** 标题 / 保存按钮文案随模式切换 */
const sheetTitle = computed(() => (isEdit.value ? '编辑账单' : '快速记账'));
const saveText = computed(() => (isEdit.value ? '保存修改' : '记一笔'));

/**
 * 删除账单（2.9.9）：仅编辑模式有入口。
 * 只调用 billStore.remove（不 remove 后再 add/update）；Pinia 变更自动刷新
 * Accounting timeline / 月汇总 / Statistics / DailyValue；Widget 经 $subscribe 自动更新快照。
 * 删除的若是带 dailyValue 的 normal Bill，该物品随 Bill 一起从日价消失（日价是 Bill 扩展）。
 */
async function confirmDeleteBill() {
  if (deleting.value) return;
  if (!props.editingBill) return;
  deleting.value = true;
  try {
    await billStore.remove(props.editingBill.id);
    toast.success('账单已删除');
    emit('saved');
    emit('update:modelValue', false);
    resetForm();
  } finally {
    deleting.value = false;
  }
}

async function save() {
  if (saving.value) return;
  if (!amountValid.value) {
    toast.info('请输入金额');
    return;
  }
  if (!categoryId.value) {
    toast.info('请选择分类');
    return;
  }
  saving.value = true;
  try {
    const cat = selectedCategory.value;
    // EDGE-02（2.9.9）：编辑模式 + 原分类已被删除 + 用户未主动重选分类 →
    // 保留该 Bill 原有的 categoryId / categoryName / categoryEmoji（图标）快照，
    // 绝不偷偷覆盖成「未分类 / 📦」。只有用户主动选择新分类（cat 存在）才更新。
    const preserveOriginalCategory = isEdit.value && props.editingBill && !cat;
    const timestamp = combineTimestamp(billDate.value, billTime.value);
    // 用户可编辑字段（新增 / 编辑共用）
    const editable = {
      type: billType.value,
      amount: Math.round(Number(amount.value) * 100) / 100,
      categoryId: preserveOriginalCategory
        ? props.editingBill!.categoryId
        : (categoryId.value as string),
      categoryEmoji: preserveOriginalCategory
        ? props.editingBill!.categoryEmoji
        : (cat?.emoji ?? '📦'),
      categoryName: preserveOriginalCategory
        ? props.editingBill!.categoryName
        : (cat?.name ?? '未分类'),
      note: note.value.trim(),
      date: billDate.value,
      timestamp,
    };
    // 「计算日价」开关
    const dailyValuePatch = enableDailyValue.value
      ? { dailyValue: { enabled: true, mode: 'elapsed' as const, startDate: billDate.value } }
      : { dailyValue: undefined };
    if (isEdit.value && props.editingBill) {
      // 编辑：只 patch 用户真正修改的字段，保持原 id，
      // 不覆盖 source/ledgerImpact/transferDirection/recurringRuleId 等非当前 UI 编辑字段。
      await billStore.update(props.editingBill.id, {
        ...editable,
        ...dailyValuePatch,
      });
      toast.success('已保存修改');
    } else {
      await billStore.add({
        ...editable,
        source: 'manual',
        ledgerImpact: 'normal',
        // 「计算日价」开启：仍为 normal Bill（进账单/统计），仅附带 dailyValue 扩展，进入日价模块
        ...(enableDailyValue.value
          ? { dailyValue: { enabled: true, mode: 'elapsed' as const, startDate: billDate.value } }
          : {}),
      });
      toast.success('已记账');
    }
    resetForm();
    emit('saved');
    emit('update:modelValue', false);
  } finally {
    saving.value = false;
  }
}

function resetForm() {
  billType.value = 'expense';
  amount.value = '';
  categoryId.value = null;
  note.value = '';
  keyboardMode.value = 'number';
  activeInput.value = 'amount';
  showAllCategories.value = false;
  categoryManagerOpen.value = false;
  showDateTime.value = false;
  enableDailyValue.value = false;
  deleteConfirmOpen.value = false;
  usingDefaultDateTime.value = true; // 恢复默认日期时间语义（下次新增打开沿用“今天”/当前时间）
  billDate.value = freshToday();
  billTime.value = currentTime();
}

/** 编辑模式预填：把待编辑 bill 的各字段填入表单 */
function fillFromBill(bill: Bill) {
  usingDefaultDateTime.value = false; // 编辑已有账单：跨午夜不得把编辑中的账单变成另一天
  billType.value = bill.type;
  amount.value = String(bill.amount);
  categoryId.value = bill.categoryId;
  note.value = bill.note || '';
  // 日期时间：拆分为 date + time
  billDate.value = bill.date;
  const t = new Date(bill.timestamp);
  billTime.value = `${pad2(t.getHours())}:${pad2(t.getMinutes())}`;
  enableDailyValue.value = Boolean(bill.dailyValue?.enabled);
  syncWheelFromForm();
}

/* ---- 打开时加载分类；编辑模式预填；关闭时重置 ---- */
watch(
  () => props.modelValue,
  async (open) => {
    if (open) {
      await categoryStore.load();
      await billStore.load();
      if (props.editingBill) {
        // 编辑模式：预填整张表单（不默认覆盖所选分类）；fillFromBill 已把 usingDefaultDateTime 置 false
        fillFromBill(props.editingBill);
        return;
      }
      // 新增模式：重新取“今天”/当前时间作为默认，并标记“仍用默认日期时间”
      usingDefaultDateTime.value = true;
      billDate.value = freshToday();
      billTime.value = currentTime();
      // 默认最近使用的第一个分类
      if (!categoryId.value && recentCategories.value.length > 0) {
        categoryId.value = recentCategories.value[0].id;
      }
      syncWheelFromForm();
    } else {
      resetForm();
    }
  },
  { immediate: true },
);

/* ---- 跨午夜 / App resume：日期时间默认值保持与“今天”同步 ---- */
let crossDayTimer: ReturnType<typeof setTimeout> | null = null;
let resumeSub: { remove: () => void } | null = null;
let onResumeRef: (() => void) | null = null;
function refreshTodayIfDefault() {
  // 仅当「新增模式 + Sheet 仍打开 + 仍用默认日期时间」时，把日期与时间一起同步为当前本地值；
  // 编辑模式 / 已手动确认日期时间 / Sheet 未打开，一律不覆盖。
  if (!props.modelValue || props.editingBill || !usingDefaultDateTime.value) return;
  billDate.value = freshToday();
  billTime.value = currentTime();
  syncWheelFromForm();
}
function scheduleNextMidnight() {
  crossDayTimer = setTimeout(() => {
    refreshTodayIfDefault();
    scheduleNextMidnight();
  }, msUntilNextLocalMidnight());
}
function startCrossDayWatcher() {
  scheduleNextMidnight();
  void registerResumeRefresh();
  onResumeRef = () => refreshTodayIfDefault();
  window.addEventListener('focus', onResumeRef);
}
async function registerResumeRefresh() {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const { App } = await import('@capacitor/app');
    resumeSub = await App.addListener('resume', refreshTodayIfDefault);
  } catch {
    // 无 @capacitor/app：降级为 window focus + 跨午夜定时器
  }
}
onMounted(() => {
  startCrossDayWatcher();
});

/* ---- 卸载清理：合并去重 reset、返回键注销与跨午夜/resume 定时器（P2-2 单一切口） ---- */
onBeforeUnmount(() => {
  unregisterOverlayForBack(resetForm);
  if (crossDayTimer) clearTimeout(crossDayTimer);
  if (onResumeRef) window.removeEventListener('focus', onResumeRef);
  void resumeSub?.remove?.();
});
</script>

<template>
  <DVSheet
    :model-value="modelValue"
    :title="sheetTitle"
    max-height="min(86dvh, 760px)"
    :scrollable="false"
    @update:model-value="(v: boolean) => emit('update:modelValue', v)"
  >
    <!-- 2.10.0（P0）：删除入口移到 Sheet Header（约 40×40 danger icon button），
         不再额外占用 QuickEntry 主内容一整行，Edit/Create 主体布局高度一致。
         新增模式不显示删除按钮（isEdit 才渲染）。 -->
    <template #actions>
      <button
        v-if="isEdit"
        class="qe__del-icon"
        type="button"
        aria-label="删除账单"
        @click="deleteConfirmOpen = true"
      >
        <span class="qe__del-icon-glyph" aria-hidden="true">🗑</span>
      </button>
    </template>
    <template #default>
      <div class="qe">
        <!-- 顶部信息区（内容较多时内部轻量滚动，不滚动数字键盘） -->
        <div class="qe__info" ref="infoRef">
        <!-- 支出 / 收入 切换 -->
        <div class="qe__type">
          <button
            class="qe__type-btn"
            :class="{ 'is-active': billType === 'expense' }"
            type="button"
            data-type="expense"
            @click="billType = 'expense'"
          >
            支出
          </button>
          <button
            class="qe__type-btn"
            :class="{ 'is-active': billType === 'income' }"
            type="button"
            data-type="income"
            @click="billType = 'income'"
          >
            收入
          </button>
        </div>

        <!-- 金额 + 备注 -->
        <div class="qe__amount-row">
          <div class="qe__amount" @click="onAmountAreaTap">
            <span class="qe__amount-currency">¥</span>
            <span class="qe__amount-value" :class="amountSizeClass">{{ amount || '0' }}</span>
          </div>
          <button
            v-if="keyboardMode === 'number'"
            class="qe__note-trigger"
            type="button"
            @click="focusNote"
          >
            <span>{{ note || '备注' }}</span>
          </button>
          <input
            v-else
            ref="noteInputRef"
            v-model="note"
            class="qe__note-input"
            type="text"
            inputmode="text"
            placeholder="备注（点数字键或金额区收起键盘）"
            @blur="onNoteBlur"
          />
        </div>

        <!-- 日期 / 时间入口（默认今天 / 当前时间，点击打开独立滚轮选择器） -->
        <div class="qe__dt">
          <button class="qe__dt-trigger" type="button" @click="openDateTimePicker">
            <span class="qe__dt-text">{{ dateTimeText }}</span>
            <span class="qe__dt-arrow">▾</span>
          </button>
        </div>

        <!-- 「计算日价」开关（默认关闭；开启后仍为 normal Bill，仅附带 dailyValue 进入日价模块） -->
        <div class="qe__dv">
          <span class="qe__dv-label">计算日价</span>
          <span class="qe__dv-sub">这笔消费每天值多少钱</span>
          <button
            class="qe__dv-switch"
            :class="{ 'is-on': enableDailyValue }"
            type="button"
            role="switch"
            :aria-checked="enableDailyValue"
            aria-label="计算日价开关"
            @click="enableDailyValue = !enableDailyValue"
          >
            <span class="qe__dv-knob" />
          </button>
        </div>

        <!-- 分类区：默认六列（5 最近 + 1 展开/收起）⇒ 展开后互斥切换到全部分类网格 -->
        <div class="qe__cats">
          <div class="qe__cats-head">
            <span class="qe__cats-title">
              {{ showAllCategories ? '全部分类' : '最近使用' }}
            </span>
            <div class="qe__cats-actions">
              <button
                class="qe__cats-link"
                type="button"
                aria-label="管理分类"
                @click="openCategoryManager"
              >
                管理
              </button>
              <button
                v-if="showAllCategories && canExpand"
                class="qe__cats-link"
                type="button"
                aria-label="收起全部分类"
                @click="showAllCategories = false"
              >
                收起 ↑
              </button>
            </div>
          </div>

          <!-- 默认态：最近使用分类（≤5）+ 第 6 位展开按钮，六列一屏完整显示，无横向滚动 -->
          <div v-if="!showAllCategories" class="qe__cats-grid qe__cats-grid--row">
            <div v-for="cat in recentCategories" :key="cat.id" class="qe__cat-cell">
              <button
                class="qe__cat"
                :class="{ 'is-active': categoryId === cat.id }"
                type="button"
                @click="onCategoryTap(cat)"
                @touchstart="startPress"
                @touchmove="cancelPress"
                @touchend="cancelPress"
                @touchcancel="cancelPress"
              >
                <DVCategoryIcon :category="cat" :size="26" framed class="qe__cat-icon" />
                <span class="qe__cat-name">{{ cat.name }}</span>
              </button>
            </div>
            <button
              v-if="canExpand"
              class="qe__cat qe__cat--expand"
              type="button"
              aria-label="展开全部分类"
              @click="expandCategories"
            >
              <span class="qe__cat-glyph">∨</span>
              <span class="qe__cat-name">全部</span>
            </button>
          </div>

          <!-- 展开态：直接切换成全部分类网格（不再重复渲染“最近使用五个”），尾格 [＋] 添加 -->
          <div v-else class="qe__cats-grid qe__cats-grid--full">
            <div v-for="cat in allCategories" :key="cat.id" class="qe__cat-cell">
              <button
                class="qe__cat"
                :class="{ 'is-active': categoryId === cat.id }"
                type="button"
                @click="onCategoryTap(cat)"
                @touchstart="startPress"
                @touchmove="cancelPress"
                @touchend="cancelPress"
                @touchcancel="cancelPress"
              >
                <DVCategoryIcon :category="cat" :size="26" framed class="qe__cat-icon" />
                <span class="qe__cat-name">{{ cat.name }}</span>
              </button>
            </div>
            <button
              class="qe__cat qe__cat--add"
              type="button"
              aria-label="添加分类"
              @click="openCreateCategory"
            >
              <span class="qe__cat-glyph">＋</span>
              <span class="qe__cat-name">添加</span>
            </button>
          </div>
        </div>
        </div>
        <!-- /.qe__info（顶部信息区可滚动） -->

        <!-- 输入区：数字键盘 + 记一笔（固定底部，始终可操作） -->
        <div class="qe__input">
        <!-- 数字键盘：始终可见。备注输入（text 模式）下点任意数字键立即切回金额 -->
        <div class="qe__pad" ref="padRef">
          <button
            v-for="key in KEYS"
            :key="key"
            class="qe__pad-key"
            :class="{ 'qe__pad-key--back': key === 'back' }"
            type="button"
            @click="inputKey(key)"
          >
            {{ key === 'back' ? '⌫' : key }}
          </button>
        </div>

        <DVButton
          class="qe__save"
          block
          size="lg"
          :disabled="saving || !amountValid || !categoryId"
          @click="save"
        >
          {{ saving ? '保存中…' : saveText }}
        </DVButton>
        </div>
        <!-- /.qe__input（输入区固定底部） -->
      </div>
    </template>
  </DVSheet>

  <!-- 分类管理（Teleport 到 body，独立于自定义数字键盘；Back LIFO：Manager → Sheet） -->
  <DVCategoryManager
    :visible="categoryManagerOpen"
    :create-on-open="categoryManagerCreateOnOpen"
    @close="categoryManagerOpen = false"
    @created="onManagerCreated"
    @duplicate="onManagerCreated"
    @deleted="onCategoryDeleted"
  />

  <!-- 日期时间滚轮选择器（独立 Picker，层级在 QuickEntry Sheet 之上，Back 先关它再关 Sheet） -->
  <DVDateTimeWheelPicker
    :model-value="wheelValue"
    :visible="showDateTime"
    @update:model-value="onWheelChange"
    @close="closeDateTimePicker"
  />

  <!-- 删除账单确认（2.9.9）：Teleport 到 body（Dialog 280 > Sheet 200）；Back 先关 Dialog 再关 Sheet -->
  <DVConfirmDialog
    :model-value="deleteConfirmOpen"
    title="删除这笔账单？"
    confirm-label="删除"
    @update:model-value="(v: boolean) => { deleteConfirmOpen = v }"
    @confirm="confirmDeleteBill"
  >
    <p class="qe__confirm-text">{{ deleteHintText }}</p>
  </DVConfirmDialog>
</template>

<style scoped>
.qe {
  display: flex;
  flex-direction: column;
  /* flex 填满非 scrollable 的 body（不用 height:100%，避免在 max-height 面板下失效） */
  flex: 1 1 auto;
  min-height: 0;
  -webkit-user-select: none;
  user-select: none;
}
/* 文本输入显式允许选中/输入（2.9.7：避免 user-select:none 干扰真实 IME 编辑） */
.qe input[type='text'],
.qe__note-input {
  -webkit-user-select: text;
  user-select: text;
}
/* 顶部信息区：可滚动（内容多时内部滚动，不滚动数字键盘） */
.qe__info {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
  display: flex;
  flex-direction: column;
  gap: var(--dv-space-md);
  /* 子项不参与压缩：内容超高时由本容器的 overflow 滚动，而不是把分类/区块压扁裁切 */
}
/* 顶部信息区的子区块（类型/金额/日期/日价/分类等）一律不压缩，超高时整体溢出滚动 */
.qe__info > * {
  flex-shrink: 0;
}
/* 输入区：数字键盘 + 记一笔，固定底部稳定可见 */
.qe__input {
  flex-shrink: 0;
  margin-top: var(--dv-space-sm);
}
/* 支出/收入 */
.qe__type {
  display: flex;
  gap: var(--dv-space-xs);
}
.qe__type-btn {
  flex: 1;
  height: 38px;
  border-radius: var(--dv-radius-pill);
  font-size: 15px;
  font-weight: 600;
  color: var(--dv-on-surface-variant);
  background: var(--dv-surface-alt);
  transition: all var(--dv-motion-fast) var(--dv-ease-standard);
}
/* 产品固定规则：支出=绿色，收入=红色 */
.qe__type-btn[data-type='expense'].is-active {
  background: var(--dv-expense);
  color: var(--dv-month-card-text);
}
.qe__type-btn[data-type='income'].is-active {
  background: var(--dv-income);
  color: #fff;
}
/* 删除账单（2.10.0：编辑模式专属，位于 Sheet Header actions 区）：
   约 40×40 danger icon button，点击先打开 DVConfirmDialog，不直接删。
   不再占用 QuickEntry 主内容高度，Edit/Create 主体布局高度一致。 */
.qe__del-icon {
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--dv-radius-pill);
  background: var(--dv-surface-alt);
  color: var(--dv-danger);
  transition:
    background-color var(--dv-motion-fast) var(--dv-ease-standard),
    transform var(--dv-motion-fast) var(--dv-ease-standard);
}
.qe__del-icon:active {
  background: color-mix(in srgb, var(--dv-danger) 16%, var(--dv-surface-alt));
  transform: scale(0.92);
}
.qe__del-icon-glyph {
  font-size: 18px;
  line-height: 1;
}
.qe__confirm-text {
  font-size: 13px;
  color: var(--dv-on-surface-variant);
  line-height: 1.6;
}
/* 金额 + 备注 */
.qe__amount-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--dv-space-sm);
}
.qe__amount {
  display: flex;
  align-items: baseline;
  gap: var(--dv-space-xs);
  min-width: 0;
}
.qe__amount-currency {
  font-size: 18px;
  font-weight: 600;
  color: var(--dv-on-surface-variant);
}
/* 长金额动态字号：1~6 位 34px / 7~9 位 30px / 更长 26px */
.qe__amount-value {
  font-size: 34px;
  font-weight: 700;
  letter-spacing: 1px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
.qe__amount-value.is-md {
  font-size: 34px;
}
.qe__amount-value.is-lg {
  font-size: 30px;
}
.qe__amount-value.is-xxl {
  font-size: 26px;
}
.qe__note-trigger {
  flex-shrink: 0;
  max-width: 40%;
  padding: var(--dv-space-xs) var(--dv-space-sm);
  border-radius: var(--dv-radius-pill);
  background: var(--dv-surface-alt);
  color: var(--dv-on-surface-variant);
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.qe__note-input {
  flex-shrink: 0;
  width: 46%;
  height: 36px;
  padding: 0 var(--dv-space-sm);
  border: 1px solid var(--dv-primary);
  border-radius: var(--dv-radius-pill);
  background: var(--dv-surface-alt);
  color: var(--dv-on-surface);
  font-size: 13px;
}
/* 日期 / 时间入口 */
.qe__dt {
  display: flex;
  flex-direction: column;
  gap: var(--dv-space-xs);
}
.qe__dt-trigger {
  display: flex;
  align-items: center;
  gap: var(--dv-space-xs);
  align-self: flex-start;
  padding: var(--dv-space-xs) var(--dv-space-sm);
  border-radius: var(--dv-radius-pill);
  background: var(--dv-surface-alt);
  color: var(--dv-on-surface-variant);
  font-size: 13px;
}
.qe__dt-arrow {
  color: var(--dv-primary);
  font-size: 11px;
}
/* 「计算日价」开关 */
.qe__dv {
  display: flex;
  align-items: center;
  gap: var(--dv-space-xs);
  padding: var(--dv-space-xs) var(--dv-space-sm);
  border-radius: var(--dv-radius-md);
  background: var(--dv-surface-alt);
}
.qe__dv-label {
  font-size: 14px;
  font-weight: 600;
  color: var(--dv-on-surface);
}
.qe__dv-sub {
  flex: 1;
  font-size: 12px;
  color: var(--dv-on-surface-variant);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.qe__dv-switch {
  flex-shrink: 0;
  position: relative;
  width: 44px;
  height: 26px;
  border-radius: var(--dv-radius-pill);
  background: var(--dv-outline);
  transition: background-color var(--dv-motion-fast) var(--dv-ease-standard);
}
.qe__dv-switch.is-on {
  background: var(--dv-primary);
}
.qe__dv-knob {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 20px;
  height: 20px;
  border-radius: var(--dv-radius-pill);
  background: #fff;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25);
  transition: transform var(--dv-motion-fast) var(--dv-ease-standard);
}
.qe__dv-switch.is-on .qe__dv-knob {
  transform: translateX(18px);
}
/* 分类 */
.qe__cats {
  display: flex;
  flex-direction: column;
  gap: var(--dv-space-xs);
}
.qe__cats-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.qe__cats-title {
  font-size: 13px;
  color: var(--dv-on-surface-variant);
}
.qe__cats-actions {
  display: flex;
  align-items: center;
  gap: var(--dv-space-sm);
}
.qe__cats-link {
  font-size: 13px;
  color: var(--dv-primary);
  font-weight: 600;
}
/* 分类网格容器 */
.qe__cats-grid {
  display: grid;
  gap: var(--dv-space-xxs) var(--dv-space-xs);
}
/* 默认一行：最近使用（≤5）+ 展开按钮 → 六列一屏完整显示，绝不横向滚动 */
.qe__cats-grid--row {
  grid-template-columns: repeat(6, minmax(0, 1fr));
}
/* 展开后：全部分类网格（含末尾 [＋]） */
.qe__cats-grid--full {
  grid-template-columns: repeat(4, minmax(0, 1fr));
  padding-top: var(--dv-space-xs);
  border-top: 1px solid var(--dv-outline);
}
.qe__cat-cell {
  position: relative;
  min-width: 0;
}
/* 分类按钮本身：填满格子，可缩，图标/名称居中，保持足够触摸面积 */
.qe__cat {
  width: 100%;
  min-width: 0;
  height: 60px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--dv-space-xxs);
  padding: var(--dv-space-xxs) 0;
  border-radius: var(--dv-radius-md);
  transition: background-color var(--dv-motion-fast) var(--dv-ease-standard);
}
.qe__cat.is-active {
  background: var(--dv-primary-soft);
}
/* 分类图标：统一经 DVCategoryIcon（本地 SVG builtin / emoji 兜底） */
.qe__cat-icon {
  font-size: 22px;
}
.qe__cat-glyph {
  font-size: 22px;
  line-height: 1;
}
.qe__cat-name {
  font-size: 12px;
  color: var(--dv-on-surface-variant);
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.qe__cat.is-active .qe__cat-name {
  color: var(--dv-primary);
  font-weight: 600;
}
/* 展开 / 添加格：虚线框 */
.qe__cat--expand,
.qe__cat--add {
  border: 1px dashed var(--dv-outline);
  color: var(--dv-primary);
}
/* 数字键盘 */
.qe__pad {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--dv-space-xs);
}
.qe__pad-key {
  height: 52px;
  border-radius: var(--dv-radius-md);
  background: var(--dv-surface-alt);
  color: var(--dv-on-surface);
  font-size: 22px;
  font-weight: 600;
  transition: background-color var(--dv-motion-fast) var(--dv-ease-standard);
}
.qe__pad-key:active {
  background: var(--dv-outline);
}
.qe__pad-key--back {
  font-size: 20px;
  color: var(--dv-on-surface-variant);
}
.qe__save {
  margin-top: var(--dv-space-xs);
}
</style>
