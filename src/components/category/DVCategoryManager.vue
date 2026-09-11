<script setup lang="ts">
/**
 * DVCategoryManager — 分类管理统一入口（2.9.8 Category Stability Fix）
 *
 * 全项目「新增 / 编辑 / 修改图标 / 删除」只有这一套实现（QuickEntrySheet / DVCategoryPicker /
 * Recurring / DailyValue 全部经它管理，不再各自维护第二套逻辑）。
 *
 * 2.9.8 交互稳定性修正：
 * - 统一 Overlay 显式层级 Token：Manager=--dv-z-manager(260)，Dialog=--dv-z-dialog(280)
 *   （修复 P0：此前 calc(var(--dv-z-picker)+1)≈251 把 DVConfirmDialog(250) 压在全屏层下面，
 *   删除确认框真实渲染了但用户看不到，导致「点了没反应」）
 * - 删除流程：askDelete 前先 countRecurringUsage —— 被周期规则引用时弹「信息 Dialog（仅知道了）」，
 *   不显示危险删除按钮；未被引用才打开正常删除确认 DVConfirmDialog
 * - 删除成功 emit('deleted', id)：QuickEntry / DVCategoryPicker 等调用方清空已失效的 categoryId，
 *   杜绝保存悬空分类引用
 * - 列表 / 编辑双视图（不再在列表底部浮表单）：
 *   LIST：系统分类 + 自定义分类 + 添加分类；EDITOR：大图标(更换) + 名称 + 保存。
 *   编辑模式不自动聚焦（不弹 IME，只有点名称框才开系统键盘）；系统分类名称只读，永远不会弹键盘
 * - 真实处理 Android VisualViewport：监听 visualViewport resize/scroll，
 *   Manager 根层限制到 offsetTop + height（键盘开/关实时同步，卸载移除监听），
 *   保证 editorPanel.bottom <= visualViewport.offsetTop + visualViewport.height - 8px
 * - 删除按钮 40×40 命中区（内层视觉红圆 32px），@click.stop 不误触编辑、不穿透列表
 * - Android Back 严格 LIFO：IconPicker → Category Editor → Manager → 调用方
 * - 分类修改经 categoryStore.updateCategoryMetadata 全局生效（历史 Bill / 周期规则快照同步）
 */
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { useCategoryStore } from '@/core/store/category';
import { toast } from '@/components/design';
import { DVConfirmDialog } from '@/components/design';
import { registerOverlayForBack, unregisterOverlayForBack } from '@/components/design/back-handler';
import DVCategoryIcon from '@/components/category/DVCategoryIcon.vue';
import DVCategoryIconPicker, { type CategoryIconValue } from '@/components/category/DVCategoryIconPicker.vue';
import { categoryGlyph } from '@/core/models/icons';
import type { Category } from '@/core/models/types';

const props = withDefaults(
  defineProps<{
    visible: boolean;
    /** true：打开即进入新增分类编辑态（「＋添加分类」直达 create mode） */
    createOnOpen?: boolean;
  }>(),
  { createOnOpen: false },
);
const emit = defineEmits<{
  close: [];
  /** 新增分类成功（调用方可选中并关闭，保持快捷选择体验） */
  created: [category: Category];
  /** 新增时重名：命中已有分类（调用方可直接选中该已有分类并关闭，杜绝重复分类） */
  duplicate: [category: Category];
  /** 删除成功：调用方立即纠正可能悬空引用的 categoryId（QuickEntry / Picker / Recurring / DailyValue） */
  deleted: [categoryId: string];
}>();

const categoryStore = useCategoryStore();
const loading = ref(false);
/** 保存中标记（EDGE-01）：防止极快双击「保存」并发重名检查产生两个同名分类 */
const saving = ref(false);

/* ---- 编辑 / 新增（Editor 视图，独立于列表） ---- */
type FormMode = null | 'create' | 'edit';
const formMode = ref<FormMode>(null);
/** 编辑中的分类（edit 模式；系统分类编辑时名称只读） */
const editingCat = ref<Category | null>(null);
const formName = ref('');
const formIcon = ref<CategoryIconValue>({ iconType: 'builtin', iconValue: 'other' });
const nameInputRef = ref<HTMLInputElement | null>(null);
const iconPickerVisible = ref(false);

/** 系统核心分类：编辑时仅允许改图标，名称只读 */
const isCoreEditing = computed(
  () => formMode.value === 'edit' && Boolean(editingCat.value?.builtin),
);

function openCreate() {
  formMode.value = 'create';
  editingCat.value = null;
  formName.value = '';
  formIcon.value = { iconType: 'builtin', iconValue: 'other' };
  // Create 模式：等 Editor 视图进入安全布局后再聚焦名称（此时 visualViewport 已同步）
  void focusNameIfCreate();
}
function openEdit(cat: Category) {
  // 2.9.8：编辑 → 进入 Editor，绝不自动聚焦 / 不弹 IME。
  // 用户只是想换图标时键盘不应突然弹出；只有真正点「分类名称」输入框才打开系统键盘。
  formMode.value = 'edit';
  editingCat.value = cat;
  formName.value = cat.name;
  formIcon.value = {
    iconType: cat.iconType ?? 'emoji',
    iconValue: cat.iconValue ?? cat.emoji,
  };
}
function cancelForm() {
  formMode.value = null;
  editingCat.value = null;
  formName.value = '';
  formIcon.value = { iconType: 'builtin', iconValue: 'other' };
}
async function focusNameIfCreate() {
  await nextTick();
  if (formMode.value !== 'create') return;
  const el = nameInputRef.value;
  if (!el) return;
  el.focus({ preventScroll: true });
}

async function saveForm() {
  // EDGE-01：保存期间禁用（saving guard）——双击第二次直接 return，
  // 避免并发重名检查（每个依赖 categoryStore.add）在毫秒级交错下创建两个同名分类
  if (formMode.value === null || saving.value) return;
  saving.value = true;
  try {
    await doSaveForm();
  } finally {
    saving.value = false;
  }
}

async function doSaveForm() {
  const name = formName.value.trim();
  if (!name) {
    toast.info('请输入分类名称');
    return;
  }
  // 重名检查（编辑时排除自身；系统分类名称锁定不参与检查）
  const dup = isCoreEditing.value
    ? undefined
    : categoryStore.findDuplicateName(name, editingCat.value?.id);
  if (dup) {
    toast.info(`已有「${dup.name}」分类`);
    // 「并可以直接选中已有分类」：create 场景由调用方选中已有分类并关闭
    if (formMode.value === 'create') {
      cancelForm();
      emit('duplicate', dup);
    }
    return;
  }

  // emoji 始终存「展示字形快照」（既有渲染路径兼容）；iconValue 存图标 id / 手输 emoji
  const glyph = categoryGlyph({
    iconType: formIcon.value.iconType,
    iconValue: formIcon.value.iconValue,
    emoji: '📦',
  });
  const patch = {
    name,
    emoji: glyph,
    iconType: formIcon.value.iconType,
    iconValue: formIcon.value.iconValue,
  };

  if (formMode.value === 'edit' && editingCat.value) {
    // 系统分类：仅改图标（名称锁定，不覆盖）
    const metaPatch = isCoreEditing.value
      ? { emoji: patch.emoji, iconType: patch.iconType, iconValue: patch.iconValue }
      : patch;
    await categoryStore.updateCategoryMetadata(editingCat.value.id, metaPatch);
    toast.success(`已保存「${name}」`);
    cancelForm();
    return;
  }

  // create：新增自定义分类
  const created = await categoryStore.add({
    name,
    emoji: patch.emoji,
    iconType: patch.iconType,
    iconValue: patch.iconValue,
    builtin: false,
    sort: 100 + categoryStore.categories.length,
  });
  toast.success(`已添加「${created.name}」`);
  cancelForm();
  emit('created', created);
}

/* ---- 删除（前置周期引用检查 + DVConfirmDialog 危险确认 / 信息 Dialog） ---- */
const confirmVisible = ref(false);
const deleteTarget = ref<Category | null>(null);
/** 周期规则引用阻止删除时的信息块（非 null 显示「仅知道了」信息 Dialog） */
const recurringBlock = ref<{ name: string; count: number } | null>(null);
/** 防止 countRecurringUsage 异步期间连点 */
const deleteBusy = ref(false);

async function askDelete(cat: Category) {
  if (cat.builtin) return; // 系统核心分类不可删
  if (deleteBusy.value || confirmVisible.value || recurringBlock.value) return;
  deleteBusy.value = true;
  try {
    // 先查周期规则引用：>0 直接弹信息 Dialog（不显示危险删除按钮），=0 才打开正常删除确认
    const count = await categoryStore.countRecurringUsage(cat.id);
    if (count > 0) {
      recurringBlock.value = { name: cat.name, count };
      return;
    }
    deleteTarget.value = cat;
    confirmVisible.value = true;
  } finally {
    deleteBusy.value = false;
  }
}
async function confirmDelete() {
  const cat = deleteTarget.value;
  if (!cat) return;
  const res = await categoryStore.removeCategory(cat.id);
  confirmVisible.value = false;
  deleteTarget.value = null;
  if (!res.ok) {
    // 兜底：确认后被规则引用（极竞态），此时已无危险按钮可点，正常提示即可
    toast.info(`此分类正在被 ${res.recurringCount ?? 1} 条周期规则使用，请先修改周期规则分类`);
    return;
  }
  toast.success(`已删除「${cat.name}」`);
  // 若正编辑的正是被删分类，退出编辑态
  if (editingCat.value?.id === cat.id) cancelForm();
  // 通知调用方：该 categoryId 已失效，不得再保存悬空引用
  emit('deleted', cat.id);
}

/* ---- 打开 / 关闭 + Back LIFO：Editor → Manager ---- */
function close() {
  emit('close');
}

/* ---- Android VisualViewport：键盘开/关时把 Manager 根层收敛到可见区域 ---- */
const vvTop = ref<number | null>(null);
const vvHeight = ref<number | null>(null);
function syncVisualViewport() {
  const vv = window.visualViewport;
  if (!vv) return;
  vvTop.value = vv.offsetTop;
  vvHeight.value = vv.height;
}
const viewportStyle = computed<Record<string, string>>(() => {
  const style: Record<string, string> = {};
  if (vvTop.value !== null) style.top = `${vvTop.value}px`;
  if (vvHeight.value !== null) style.height = `${vvHeight.value}px`;
  return style;
});
function attachViewportSync() {
  const vv = window.visualViewport;
  if (!vv) return;
  vv.addEventListener('resize', syncVisualViewport);
  vv.addEventListener('scroll', syncVisualViewport);
  syncVisualViewport();
}
function detachViewportSync() {
  const vv = window.visualViewport;
  if (!vv) return;
  vv.removeEventListener('resize', syncVisualViewport);
  vv.removeEventListener('scroll', syncVisualViewport);
}

watch(
  () => props.visible,
  async (on) => {
    if (on) {
      registerOverlayForBack(close);
      attachViewportSync();
      loading.value = true;
      try {
        await categoryStore.load();
      } finally {
        loading.value = false;
      }
      if (props.createOnOpen) openCreate();
    } else {
      detachViewportSync();
      unregisterOverlayForBack(close);
      cancelForm();
    }
  },
  { immediate: true },
);
watch(formMode, (mode) => {
  if (mode) {
    registerOverlayForBack(cancelForm);
  } else {
    unregisterOverlayForBack(cancelForm);
    // 退出 Editor：同步一次视口（若键盘仍在，根层保持收敛）
    void nextTick(syncVisualViewport);
  }
});

onBeforeUnmount(() => {
  detachViewportSync();
  void unregisterOverlayForBack(close);
  void unregisterOverlayForBack(cancelForm);
});
</script>

<template>
  <Teleport to="body">
    <Transition name="dv-picker">
      <div
        v-if="visible"
        class="dvm"
        role="dialog"
        aria-modal="true"
        :aria-label="formMode ? '编辑分类' : '分类管理'"
        :style="viewportStyle"
      >
        <div class="dvm__mask" @click="formMode ? cancelForm() : close()" />
        <div class="dvm__panel">
          <!-- ============ LIST MODE ============ -->
          <template v-if="!formMode">
            <header class="dvm__head">
              <span class="dvm__title">分类管理</span>
              <button class="dvm__done" type="button" @click="close">完成</button>
            </header>

            <div class="dvm__body">
              <div v-if="loading" class="dvm__empty">加载中…</div>

              <!-- 系统核心分类：🔒 不可删除，可改图标 -->
              <template v-if="categoryStore.coreCategories.length">
                <div class="dvm__section">
                  <div class="dvm__section-title">系统分类</div>
                  <div class="dvm__row" v-for="cat in categoryStore.coreCategories" :key="cat.id">
                    <DVCategoryIcon :category="cat" :size="22" framed class="dvm__row-icon" />
                    <span class="dvm__row-name">{{ cat.name }}</span>
                    <span class="dvm__lock" title="系统分类，不可删除">🔒</span>
                    <button class="dvm__row-edit" type="button" aria-label="编辑分类" @click="openEdit(cat)">
                      编辑
                    </button>
                  </div>
                </div>
              </template>

              <!-- 自定义分类：每个都有一致的管理入口（编辑 + 删除） -->
              <template v-if="categoryStore.customCategories.length">
                <div class="dvm__section">
                  <div class="dvm__section-title">自定义分类</div>
                  <div class="dvm__row" v-for="cat in categoryStore.customCategories" :key="cat.id">
                    <DVCategoryIcon :category="cat" :size="22" framed class="dvm__row-icon" />
                    <span class="dvm__row-name">{{ cat.name }}</span>
                    <button class="dvm__row-edit" type="button" aria-label="编辑分类" @click="openEdit(cat)">
                      编辑
                    </button>
                    <button
                      class="dvm__row-del"
                      type="button"
                      aria-label="删除分类"
                      @click.stop="askDelete(cat)"
                    >
                      <span class="dvm__row-del-circle">✕</span>
                    </button>
                  </div>
                </div>
              </template>

              <div v-if="!categoryStore.categories.length" class="dvm__empty">暂无分类</div>

              <!-- [＋ 添加分类]：进入 create mode（Editor 视图） -->
              <button
                class="dvm__add"
                type="button"
                aria-label="添加分类"
                @click="openCreate"
              >
                <span class="dvm__add-glyph">＋</span>
                <span class="dvm__add-label">添加分类</span>
              </button>
            </div>
            <!-- /.dvm__body -->
          </template>

          <!-- ============ EDITOR MODE（新增 / 编辑共用；不自动弹键盘） ============ -->
          <template v-else>
            <header class="dvm__head dvm__head--editor">
              <button class="dvm__back" type="button" aria-label="返回分类列表" @click="cancelForm">
                ‹
              </button>
              <span class="dvm__title">{{ formMode === 'create' ? '新增分类' : '编辑分类' }}</span>
              <span class="dvm__head-spacer" aria-hidden="true" />
            </header>

            <div class="dvm__editor">
              <button
                class="dvm__editor-icon"
                type="button"
                :aria-label="`选择图标（当前 ${formIcon.iconValue}）`"
                @click="iconPickerVisible = true"
              >
                <DVCategoryIcon
                  :category="{ iconType: formIcon.iconType, iconValue: formIcon.iconValue, emoji: '📦' }"
                  :size="30"
                  framed
                />
              </button>
              <span class="dvm__editor-icon-hint">更换图标</span>

              <label class="dvm__editor-label" for="dvm-name">分类名称</label>
              <input
                id="dvm-name"
                ref="nameInputRef"
                v-model="formName"
                class="dvm__editor-name"
                :placeholder="formMode === 'edit' ? '分类名称' : '分类名称（如：咖啡）'"
                maxlength="8"
                :readonly="isCoreEditing"
                aria-label="分类名称"
                @keydown.enter="saveForm"
              />
              <p v-if="isCoreEditing" class="dvm__editor-hint">系统分类名称不可修改，可更换图标</p>

              <button
                class="dvm__editor-save"
                type="button"
                :disabled="saving"
                @click="saveForm"
              >
                {{ saving ? '保存中…' : '保存' }}
              </button>
            </div>
            <!-- /.dvm__editor -->
          </template>
        </div>
        <!-- /.dvm__panel -->

        <DVCategoryIconPicker v-model="formIcon" :visible="iconPickerVisible" @close="iconPickerVisible = false" />

        <DVConfirmDialog
          :model-value="confirmVisible"
          title="删除分类"
          confirm-label="删除"
          @update:model-value="(v: boolean) => { confirmVisible = v; if (!v) deleteTarget = null; }"
          @confirm="confirmDelete"
        >
          <p class="dvm__confirm-text">
            删除「{{ deleteTarget?.name ?? '' }}」？已有历史账单不会被删除。
          </p>
        </DVConfirmDialog>

        <!-- 被周期规则引用：信息 Dialog（仅「知道了」，无危险删除按钮） -->
        <DVConfirmDialog
          :model-value="Boolean(recurringBlock)"
          title="无法删除分类"
          confirm-label="知道了"
          :danger="false"
          hide-cancel
          @update:model-value="(v: boolean) => { if (!v) recurringBlock = null; }"
          @confirm="recurringBlock = null"
        >
          <p v-if="recurringBlock" class="dvm__confirm-text">
            「{{ recurringBlock.name }}」正在被 {{ recurringBlock.count }} 条周期规则使用。<br />
            请先修改对应周期规则的分类。
          </p>
        </DVConfirmDialog>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.dvm {
  position: fixed;
  inset: 0;
  z-index: var(--dv-z-manager);
  display: flex;
  align-items: center;
  justify-content: center;
}
.dvm__mask {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
}
/* 面板：max-height 收敛到可见视口（visualViewport 同步后根层高度即可见区域），
   系统键盘弹起时编辑区（名称框 + 保存）完整可见，不越界不藏到键盘后面 */
.dvm__panel {
  position: relative;
  display: flex;
  flex-direction: column;
  width: min(88vw, 440px);
  max-height: calc(100% - 16px);
  min-height: 0;
  background: var(--dv-overlay-panel-bg);
  backdrop-filter: var(--dv-overlay-panel-blur);
  -webkit-backdrop-filter: var(--dv-overlay-panel-blur);
  border: var(--dv-overlay-panel-border);
  border-radius: var(--dv-radius-lg);
  padding: var(--dv-space-md);
  padding-bottom: calc(var(--dv-space-md) + var(--dv-safe-bottom));
}
.dvm__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--dv-space-sm);
  flex-shrink: 0;
}
.dvm__head--editor {
  justify-content: flex-start;
  gap: var(--dv-space-xxs);
}
.dvm__head--editor .dvm__title {
  flex: 1;
  text-align: center;
}
.dvm__head-spacer {
  width: 32px;
  flex-shrink: 0;
}
.dvm__title {
  font-size: 16px;
  font-weight: 600;
}
.dvm__done {
  color: var(--dv-primary);
  font-size: 14px;
  font-weight: 600;
}
.dvm__back {
  width: 32px;
  height: 32px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--dv-radius-sm);
  font-size: 22px;
  line-height: 1;
  color: var(--dv-on-surface-variant);
}
.dvm__body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
  display: flex;
  flex-direction: column;
  gap: var(--dv-space-sm);
}
.dvm__section-title {
  font-size: 12px;
  color: var(--dv-on-surface-variant);
  padding: var(--dv-space-xs) var(--dv-space-xxs) var(--dv-space-xxs);
}
.dvm__row {
  display: flex;
  align-items: center;
  gap: var(--dv-space-sm);
  padding: var(--dv-space-xs) var(--dv-space-xxs);
  border-radius: var(--dv-radius-md);
  min-height: 48px;
}
.dvm__row:nth-child(odd) {
  background: var(--dv-surface-alt);
}
.dvm__row-icon {
  flex-shrink: 0;
}
.dvm__row-name {
  flex: 1;
  min-width: 0;
  font-size: 14px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dvm__lock {
  font-size: 13px;
  flex-shrink: 0;
}
.dvm__row-edit {
  flex-shrink: 0;
  height: 36px;
  padding: 0 var(--dv-space-sm);
  border-radius: var(--dv-radius-pill);
  font-size: 12px;
  background: var(--dv-surface-strong);
  color: var(--dv-primary);
}
/* 删除按钮：整体 40×40 命中区（触屏最小建议），内层视觉红圆 32px */
.dvm__row-del {
  flex-shrink: 0;
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.dvm__row-del-circle {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--dv-danger);
  color: #fff;
  font-size: 13px;
}
.dvm__add {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--dv-space-xxs);
  height: 44px;
  border: 1px dashed var(--dv-outline);
  border-radius: var(--dv-radius-md);
  color: var(--dv-primary);
  font-size: 14px;
  font-weight: 600;
  flex-shrink: 0;
}
.dvm__empty {
  padding: var(--dv-space-lg) var(--dv-space-md);
  text-align: center;
  color: var(--dv-on-surface-variant);
  font-size: 14px;
}
/* ---- Editor 视图：手机风格页式编辑，图标 / 名称 / 保存纵向排布 ---- */
.dvm__editor {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: var(--dv-space-xs);
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
}
.dvm__editor-icon {
  align-self: center;
  width: 64px;
  height: 64px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--dv-outline);
  border-radius: var(--dv-radius-md);
  background: var(--dv-surface-alt);
}
.dvm__editor-icon-hint {
  align-self: center;
  font-size: 12px;
  color: var(--dv-on-surface-variant);
}
.dvm__editor-label {
  font-size: 12px;
  color: var(--dv-on-surface-variant);
  margin-top: var(--dv-space-xs);
}
.dvm__editor-name {
  width: 100%;
  height: 46px;
  padding: 0 var(--dv-space-sm);
  border: 1px solid var(--dv-surface-border);
  border-radius: var(--dv-radius-md);
  background: var(--dv-surface-strong);
  color: var(--dv-on-surface);
  font-size: 15px;
  -webkit-user-select: text;
  user-select: text;
}
.dvm__editor-name:focus {
  border-color: var(--dv-primary);
  outline: none;
}
.dvm__editor-hint {
  font-size: 12px;
  color: var(--dv-on-surface-variant);
}
.dvm__editor-save {
  width: 100%;
  height: 48px;
  margin-top: var(--dv-space-xs);
  border: none;
  border-radius: var(--dv-radius-pill);
  background: var(--dv-primary);
  color: var(--dv-on-primary);
  font-size: 16px;
  font-weight: 600;
}
.dvm__confirm-text {
  font-size: 14px;
  color: var(--dv-on-surface-variant);
  line-height: 1.6;
}
</style>