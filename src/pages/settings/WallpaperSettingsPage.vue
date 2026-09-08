<script setup lang="ts">
/**
 * WallpaperSettingsPage — 独立壁纸设置页（Phase 6 v2，/settings/wallpaper）
 *
 * 结构（保持简单）：
 * - 当前壁纸预览（仅展示当前正式壁纸，不做复杂拖动）
 * - 选择新壁纸 → 进入 WallpaperCropperEditor（本页不直接编辑）
 * - 模糊 / 明暗滑杆：直接修改当前壁纸参数（不必重新裁剪）
 * - 已有壁纸时：重新调整（本阶段等价重新选择图片）/ 移除壁纸
 *
 * 保存规则：
 * - 应用：构造 plain WallpaperConfig DTO → settingsStore → IDB → AppStore → Wallpaper Layer；
 *   保存成功才关闭 Editor；失败保持 Editor 打开 + toast。
 * - 取消：不改动当前壁纸。
 * - 移除：清除正式壁纸并持久化。
 *
 * Android Back 层级：Editor 打开时先关 Editor（仍停留本页）；否则返回 Settings。
 */
import { ref, computed, watch, onBeforeUnmount, type Ref } from 'vue';
import { useRouter } from 'vue-router';
import { DVButton, DVCard, toast } from '@/components/design';
import { useSettingsStore } from '@/core/store/settings';
import WallpaperCropperEditor from '@/components/wallpaper/WallpaperCropperEditor.vue';
import { registerOverlayForBack, unregisterOverlayForBack } from '@/components/design/back-handler';

const router = useRouter();
const settings = useSettingsStore();

/** 当前已应用壁纸（预览 / 滑杆 / 移除用） */
const currentWallpaper = computed(() => settings.wallpaper);

/** Editor 是否打开 */
const editorOpen = ref(false);
/** Editor 源图片（objectURL），Editor 关闭或本页卸载后 revoke */
const editorImage = ref<string | null>(null);
/** Editor 初始 blur/overlay（随当前壁纸） */
const editorBlur = ref(0);
const editorOverlay = ref(0);
/** Editor 持久化进行中（P1-3）：落入 IDB 完成前禁用 Apply，防重复提交 */
const editorSaving = ref(false);

const fileInput = ref<HTMLInputElement | null>(null);

// ---- 当前壁纸预览（仅展示，不拖动）----
// 预览实时跟随 blurVal/overlayVal（P1-2）：拖动滑杆立即看到效果，持久化在 @change 才落库
const previewStyle = computed(() => {
  const wp = currentWallpaper.value;
  if (!wp?.image) return {};
  return {
    backgroundImage: `url("${wp.image}")`,
    // 已保存最终构图图片，直接 cover 填满
    backgroundSize: 'cover',
    backgroundPosition: 'center',
    filter: `blur(${blurVal.value}px)`,
  };
});
const previewMaskStyle = computed(() => {
  return { background: `rgba(0,0,0,${overlayVal.value})` };
});

// ---- 当前壁纸预览框比例（P1-5）：按设备竖屏 viewport 比例（约 9:20），不再是横向卡片 ----
const deviceAspect = computed(() => {
  const w = window.innerWidth;
  const h = window.innerHeight;
  return h > 0 ? w / h : 0.45;
});
const previewFrameStyle = computed(() => ({ aspectRatio: deviceAspect.value.toFixed(4) }));

// ---- 模糊 / 明暗滑杆（直接改当前壁纸参数，不重新裁剪）----
/** 本地滑杆值：@input 实时驱动预览，@change 才持久化一次 */
const blurVal = ref(0);
const overlayVal = ref(0);
let saving = false;

// 当前壁纸变化（含切页/移除）后同步本地滑杆
watch(
  () => currentWallpaper.value,
  (wp) => {
    blurVal.value = wp?.blur ?? 0;
    overlayVal.value = wp?.overlay ?? 0;
  },
  { immediate: true },
);

/** @change：松手一次持久化（不用防抖；失败回滚到正式 Wallpaper 值 + toast） */
async function persistAdjust() {
  const wp = currentWallpaper.value;
  if (!wp?.image || saving) return;
  saving = true;
  const prevBlur = wp.blur;
  const prevOverlay = wp.overlay;
  try {
    // 构造 plain DTO，保留 image，仅更新 blur/overlay
    await settings.setWallpaper({
      image: wp.image,
      blur: blurVal.value,
      overlay: overlayVal.value,
    });
  } catch (e) {
    console.error('[wallpaper] 参数保存失败', e);
    // 回滚本地滑杆到正式 Wallpaper 值，避免预览与持久化不一致
    blurVal.value = prevBlur;
    overlayVal.value = prevOverlay;
    toast.error('壁纸参数保存失败');
  } finally {
    saving = false;
  }
}

onBeforeUnmount(() => {
  // P1-4：页面被路由卸载时，清除 Editor 源图片 objectURL，避免大图内存泄漏
  if (editorImage.value) {
    URL.revokeObjectURL(editorImage.value);
    editorImage.value = null;
  }
  // 卸载 Back 回调并恢复 body 滚动
  void unregisterOverlayForBack(cancelEditor);
  if (editorOpenUnmount.value) {
    editorOpenUnmount.value = false;
    document.body.style.overflow = '';
  }
});

// ---- 选择新壁纸 ----
function onPickFile(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) return;
  const url = URL.createObjectURL(file);
  editorImage.value = url;
  editorBlur.value = currentWallpaper.value?.blur ?? 4;
  editorOverlay.value = currentWallpaper.value?.overlay ?? 0.25;
  editorOpen.value = true;
  input.value = '';
}

/** 取消：关闭 Editor，不改动壁纸 */
function cancelEditor() {
  editorOpen.value = false;
  if (editorImage.value) {
    URL.revokeObjectURL(editorImage.value);
    editorImage.value = null;
  }
}

/** 应用：持久化成功才关闭；失败保持打开 + toast。editorSaving 防重复导出/保存（P1-3） */
async function onEditorApply(payload: { image: string; blur: number; overlay: number }) {
  if (editorSaving.value) return;
  editorSaving.value = true;
  try {
    const dto = {
      image: payload.image,
      blur: payload.blur,
      overlay: payload.overlay,
    };
    await settings.setWallpaper(dto);
    editorOpen.value = false;
    if (editorImage.value) {
      URL.revokeObjectURL(editorImage.value);
      editorImage.value = null;
    }
    toast.success('壁纸已应用');
  } catch (e) {
    console.error('[wallpaper] 壁纸保存失败', e);
    toast.error('壁纸保存失败');
    // Editor 保持打开，原壁纸不变
  } finally {
    editorSaving.value = false;
  }
}

/** 移除壁纸：清除正式壁纸并持久化 */
async function removeWallpaper() {
  try {
    await settings.setWallpaper(undefined);
    toast.success('壁纸已移除');
  } catch (e) {
    console.error('[wallpaper] 壁纸移除失败', e);
    toast.error('壁纸移除失败');
  }
}

/** 返回设置主页 */
function goBackToSettings() {
  if (router.options.history.state.back !== null) {
    // 解析为从 /settings 进入：能回退则回退
    if ((window.history?.length ?? 0) > 1) {
      router.back();
      return;
    }
  }
  router.push('/settings');
}

// ---- Editor 打开时 Android Back 先关 Editor，不离开本页 ----
const editorOpenUnmount = ref(false);
watch(editorOpen, (open) => {
  lockBodyScroll(open, editorOpenUnmount);
  if (open) void registerOverlayForBack(cancelEditor);
  else void unregisterOverlayForBack(cancelEditor);
});
function lockBodyScroll(lock: boolean, skip: Ref<boolean>) {
  if (lock) {
    if (skip.value) return;
    editorOpenUnmount.value = true;
    document.body.style.overflow = 'hidden';
  } else {
    if (!editorOpenUnmount.value) return;
    editorOpenUnmount.value = false;
    document.body.style.overflow = '';
  }
}
</script>

<template>
  <section class="page">
    <DVCard outlined>
      <header class="page__head">
        <button class="page__back" type="button" aria-label="返回设置" @click="goBackToSettings">
          ‹ 设置
        </button>
        <h1 class="page__title">壁纸设置</h1>
      </header>

      <!-- 当前壁纸预览（仅展示；比例 = 设备竖屏 viewport，约 9:20 手机壁纸预览窗） -->
      <div class="wp-preview" :class="{ 'is-empty': !currentWallpaper?.image }" :style="previewFrameStyle">
        <div v-if="currentWallpaper?.image" class="wp-preview__img" :style="previewStyle" aria-hidden="true"></div>
        <div v-if="currentWallpaper?.image" class="wp-preview__mask" :style="previewMaskStyle" aria-hidden="true"></div>
        <span v-else class="wp-preview__empty">未设置壁纸</span>
      </div>

      <!-- 选择新壁纸 -->
      <input ref="fileInput" class="wp-file" type="file" accept="image/*" @change="onPickFile" />
      <DVButton class="wp-primary-btn" @click="fileInput?.click()">选择新壁纸</DVButton>

      <!-- 模糊 / 明暗（已有壁纸可直接调，不必重新裁剪）；@input 实时预览，@change 持久化一次 -->
      <div v-if="currentWallpaper?.image" class="wp-controls">
        <label>
          <span class="wp-label">模糊 <b>{{ blurVal.toFixed(0) }}</b></span>
          <input v-model.number="blurVal" type="range" min="0" max="20" step="1" @change="persistAdjust" />
        </label>
        <label>
          <span class="wp-label">明暗遮罩 <b>{{ Math.round(overlayVal * 100) }}%</b></span>
          <input v-model.number="overlayVal" type="range" min="0" max="1" step="0.05" @change="persistAdjust" />
        </label>
      </div>

      <!-- 已有壁纸：重新调整 / 移除 -->
      <div v-if="currentWallpaper?.image" class="wp-actions">
        <DVButton variant="secondary" @click="fileInput?.click()">重新调整</DVButton>
        <DVButton variant="danger" @click="removeWallpaper">移除壁纸</DVButton>
      </div>
    </DVCard>

    <!-- WallpaperCropperEditor（选新壁纸后进入） -->
    <div v-if="editorOpen && editorImage" class="editor-layer" role="dialog" aria-modal="true" aria-label="调整壁纸">
      <div class="editor-layer__mask" @click="cancelEditor" />
      <div class="editor-layer__panel">
        <header class="editor-layer__head">
          <span>调整壁纸</span>
          <button class="editor-layer__close" type="button" aria-label="关闭" @click="cancelEditor">✕</button>
        </header>
        <WallpaperCropperEditor
          :image="editorImage"
          :blur="editorBlur"
          :overlay="editorOverlay"
          :saving="editorSaving"
          @apply="onEditorApply"
          @cancel="cancelEditor"
        />
      </div>
    </div>
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

/* 当前壁纸预览：手机竖屏比例（aspect-ratio = 设备 viewport），高度约 38dvh、居中、限最大宽 */
.wp-preview {
  position: relative;
  margin: 0 auto;
  width: auto;
  height: 38dvh;
  max-width: 100%;
  border-radius: var(--dv-radius-md);
  overflow: hidden;
  background: var(--dv-surface-alt);
  border: 1px solid var(--dv-outline);
}
.wp-preview.is-empty {
  display: flex;
  align-items: center;
  justify-content: center;
}
.wp-preview__img {
  position: absolute;
  inset: 0;
  background-repeat: no-repeat;
}
.wp-preview__mask {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
.wp-preview__empty {
  color: var(--dv-on-surface-variant);
  font-size: 13px;
}

.wp-file {
  display: none;
}
.wp-primary-btn {
  width: 100%;
  margin-top: var(--dv-space-md);
}

.wp-controls {
  display: flex;
  flex-direction: column;
  gap: var(--dv-space-sm);
  margin-top: var(--dv-space-md);
}
.wp-controls label {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.wp-label {
  font-size: 13px;
  color: var(--dv-on-surface-variant);
}
.wp-label b {
  color: var(--dv-on-surface);
}
.wp-controls input[type='range'] {
  width: 100%;
  accent-color: var(--dv-primary);
}

.wp-actions {
  display: flex;
  gap: var(--dv-space-sm);
  margin-top: var(--dv-space-md);
}

/* Editor 浮层 */
.editor-layer {
  position: fixed;
  inset: 0;
  z-index: var(--dv-z-picker);
  display: flex;
  align-items: center;
  justify-content: center;
}
.editor-layer__mask {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
}
.editor-layer__panel {
  position: relative;
  width: min(94vw, 460px);
  max-height: 90dvh;
  overflow-y: auto;
  background: var(--dv-surface);
  border-radius: var(--dv-radius-lg);
  padding: var(--dv-space-md) var(--dv-space-md) calc(var(--dv-space-md) + var(--dv-safe-bottom));
}
.editor-layer__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 16px;
  font-weight: 600;
  margin-bottom: var(--dv-space-sm);
}
.editor-layer__close {
  color: var(--dv-on-surface-variant);
  font-size: 16px;
}
</style>