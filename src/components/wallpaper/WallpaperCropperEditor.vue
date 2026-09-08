<script setup lang="ts">
/**
 * WallpaperCropperEditor — 正式壁纸裁剪组件（Phase 6 v2）
 *
 * 从已验证的 WallpaperCropperDemo（Round3 方案 A）抽取的正式组件：
 * - 由调用方（WallpaperSettingsPage）传入源图片与初始 blur/overlay
 * - 裁剪框按当前设备 WebView 屏幕比例生成（WYSIWYG ≈ 主页壁纸可见区域）
 * - 单指拖动 / 双指缩放（组件处理；imageRestriction=stencil ⇒ 永远 cover，无空边）
 * - blur / overlay 实时预览（参数独立保存，不写入图片像素）
 * - 点击「应用」→ 临时切换到高分辨率 canvas，直接使用 result.canvas（EXIF 交给组件）
 *   → JPEG 压缩 → 交还最终构图 DataURL 给调用方持久化
 * - 取消 → 不产生任何输出，调用方不改变当前壁纸
 *
 * EXIF orientation 与坐标完全交由 vue-advanced-cropper 处理；
 * 禁止恢复旧的自研「原图 coordinates → 手工 drawImage 裁剪」。
 */
import { ref, computed, nextTick, watch, onMounted, onBeforeUnmount } from 'vue';
import { Cropper, RectangleStencil, type CropperResult } from 'vue-advanced-cropper';
import 'vue-advanced-cropper/dist/style.css';
import { DVButton, toast } from '@/components/design';

const props = defineProps<{
  /** 源图片（objectURL 或 DataURL）；null 时不渲染编辑器 */
  image: string | null;
  /** 初始模糊 0-20 */
  blur?: number;
  /** 初始明暗遮罩 0-1 */
  overlay?: number;
  /** 父层正在持久化（Apply 已被父层接管异步落库），此时禁用 Apply 防重复提交 */
  saving?: boolean;
}>();

const emit = defineEmits<{
  /** 应用最终壁纸：交还最终构图 DataURL + blur/overlay（由调用方持久化） */
  (e: 'apply', payload: { image: string; blur: number; overlay: number; width: number; height: number }): void;
  /** 取消：不改动当前壁纸 */
  (e: 'cancel'): void;
}>();

const cropperRef = ref<InstanceType<typeof Cropper> | null>(null);

/** 导出最长边目标（现代旗舰屏） */
const TARGET_LONG_EDGE = 2560;

// ---- 设备 CSS viewport / visualViewport ----
const vw = ref(window.innerWidth);
const vh = ref(window.innerHeight);

// 壁纸区域 = 全屏 App 背景 ⇒ 用整机（WebView 全屏）长宽比
const stencilAspect = computed(() => (vh.value > 0 ? vw.value / vh.value : 0.45));

// ---- 固定裁剪框（P0-2）：测量实际裁剪容器，计算「当前容器内最大但保留边距」的手机比例框 ----
const canvasEl = ref<HTMLElement | null>(null);
const canvasW = ref(0);
const canvasH = ref(0);
const STENCIL_MARGIN = 14;

function measureCanvas() {
  if (!canvasEl.value) return;
  const r = canvasEl.value.getBoundingClientRect();
  canvasW.value = r.width;
  canvasH.value = r.height;
}

/** 固定 stencil 尺寸：优先用满容器高度，宽度按设备比例（竖屏 ⇒ 明显的壁纸预览窗）。 */
const stencilSize = computed<{ width: number; height: number } | undefined>(() => {
  const a = stencilAspect.value;
  const W = canvasW.value;
  const H = canvasH.value;
  if (W <= 0 || H <= 0) return undefined;
  const availW = Math.max(1, W - STENCIL_MARGIN * 2);
  const availH = Math.max(1, H - STENCIL_MARGIN * 2);
  let w: number;
  let h: number;
  if (a < 1) {
    h = availH;
    w = h * a;
    if (w > availW) {
      w = availW;
      h = w / a;
    }
  } else {
    w = availW;
    h = w / a;
    if (h > availH) {
      h = availH;
      w = h * a;
    }
  }
  return { width: Math.round(w), height: Math.round(h) };
});

// 目标导出画布：按设备比例 + 目标长边（2560px）计算宽高，与 stencil/device 宽高比一致
const exportW = computed(() => {
  const a = stencilAspect.value;
  return a >= 1 ? TARGET_LONG_EDGE : Math.max(1, Math.round(TARGET_LONG_EDGE * a));
});
const exportH = computed(() => {
  const a = stencilAspect.value;
  return a >= 1 ? Math.max(1, Math.round(TARGET_LONG_EDGE / a)) : TARGET_LONG_EDGE;
});
// 高分辨率画布（「应用」时临时启用）；maxArea 设得足够大，防止被默认 maxCanvasSize 缩小
const exportCanvas = computed<{ width: number; height: number; maxArea: number }>(() => ({
  width: exportW.value,
  height: exportH.value,
  maxArea: TARGET_LONG_EDGE * TARGET_LONG_EDGE,
}));
// 交互阶段用低画布，保证拖动/pinch 流畅；应用时临时切到 exportCanvas
const canvasConfig = ref<{ width?: number; height?: number; maxArea?: number }>({ maxArea: 600000 });

const blur = ref(props.blur ?? 0);
const overlay = ref(props.overlay ?? 0);
const applying = ref(false);

// 同步外部初始值（重新选择图片时重置）
watch(
  () => [props.image, props.blur, props.overlay] as const,
  ([, b, o]) => {
    blur.value = b ?? 0;
    overlay.value = o ?? 0;
  },
  { immediate: true },
);

/** 应用：临时切高分辨率 → 直接取 result.canvas（EXIF/坐标交给组件）→ JPEG 压缩 → 交还调用方 */
async function apply() {
  const cropper = cropperRef.value;
  if (!cropper) return;
  applying.value = true;
  try {
    canvasConfig.value = exportCanvas.value;
    await nextTick();
    let result: CropperResult | null = null;
    try {
      result = cropper.getResult();
    } finally {
      canvasConfig.value = { maxArea: 600000 };
    }
    if (!result || !result.canvas) {
      toast.error('尚未生成可导出的裁剪结果');
      return;
    }
    const outCanvas = result.canvas;
    const outW = outCanvas.width;
    const outH = outCanvas.height;
    const blob = await new Promise<Blob | null>((resolve) =>
      outCanvas.toBlob(resolve, 'image/jpeg', 0.88),
    );
    if (!blob) throw new Error('toBlob failed');
    // 仅对已压缩的小图做 base64，不整图转
    const dataUrl = await blobToDataUrl(blob);
    emit('apply', { image: dataUrl, blur: blur.value, overlay: overlay.value, width: outW, height: outH });
  } catch (err) {
    console.error('[wallpaper-editor] 导出失败', err);
    toast.error('壁纸保存失败');
  } finally {
    applying.value = false;
  }
}

function cancel() {
  emit('cancel');
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function containerStyle() {
  return {
    width: '100%',
    height: '100%',
    filter: `blur(${blur.value}px)`,
  };
}

onBeforeUnmount(() => {
  window.removeEventListener('resize', measureCanvas);
});
onMounted(() => {
  measureCanvas();
  window.addEventListener('resize', measureCanvas);
});
</script>

<template>
  <div class="wp-editor" :data-wp-editor-aspect="stencilAspect.toFixed(4)">
    <div v-if="!props.image" class="wp-editor__empty">
      <span>尚未选择图片</span>
    </div>
    <div
      v-else
      ref="canvasEl"
      class="wp-editor__canvas"
      style="--tap:none; touch-action: none"
      :data-wp-stencil-w="stencilSize?.width ?? -1"
      :data-wp-stencil-h="stencilSize?.height ?? -1"
    >
      <div class="wp-editor__blurlayer" :style="containerStyle()">
        <Cropper
          ref="cropperRef"
          class="wp-editor__cropper"
          :src="props.image ?? undefined"
          :stencil-component="RectangleStencil"
          :stencil-props="{
            aspectRatio: stencilAspect,
            movable: false,
            resizable: false,
            handlers: {},
            lines: {},
          }"
          :stencil-size="stencilSize"
          :image-restriction="'stencil'"
          :resize-image="{ touch: true, wheel: false, adjustStencil: false }"
          :move-image="{ touch: true, mouse: true }"
          :min-width="100"
          :min-height="100"
          :canvas="canvasConfig"
          image-style="max-width: 100%"
        />
      </div>
      <div class="wp-editor__overlay" :style="{ opacity: overlay }" />
      <span class="wp-editor__badge">比例 {{ (stencilAspect * 100).toFixed(1) }}%</span>
    </div>

    <!-- 调节：blur / overlay 实时预览（参数独立保存，不写进像素） -->
    <div class="wp-editor__controls">
      <label>
        <span class="wp-editor__label">模糊 <b data-field="blur">{{ blur.toFixed(0) }}</b></span>
        <input v-model.number="blur" type="range" min="0" max="20" step="1" data-role="blur" />
      </label>
      <label>
        <span class="wp-editor__label">明暗遮罩 <b data-field="overlay">{{ (overlay * 100).toFixed(0) }}%</b></span>
        <input v-model.number="overlay" type="range" min="0" max="1" step="0.05" data-role="overlay" />
      </label>
    </div>

    <!-- 操作 -->
    <div class="wp-editor__actions">
      <DVButton variant="ghost" @click="cancel">取消</DVButton>
      <DVButton :disabled="applying || props.saving" data-role="apply" @click="apply">应用</DVButton>
    </div>
  </div>
</template>

<style scoped>
.wp-editor {
  --dv-wp-aspect: v-bind('stencilAspect.toFixed(4)');
  display: flex;
  flex-direction: column;
  gap: var(--dv-space-md);
  color: var(--dv-on-surface);
}
.wp-editor__empty {
  height: 40vh;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--dv-radius-md);
  background: var(--dv-surface-alt);
  color: var(--dv-on-surface-variant);
  font-size: 14px;
}
.wp-editor__canvas {
  position: relative;
  width: 100%;
  height: 52vh;
  border-radius: var(--dv-radius-md);
  overflow: hidden;
  background: #14151a;
  touch-action: none;
}
.wp-editor__blurlayer {
  position: absolute;
  inset: 0;
}
.wp-editor__cropper {
  height: 100%;
}
.wp-editor__overlay {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: #000;
  transition: opacity 60ms linear;
}
.wp-editor__badge {
  position: absolute;
  left: var(--dv-space-xs);
  bottom: var(--dv-space-xs);
  padding: 2px 8px;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.45);
  color: #fff;
  font-size: 12px;
  z-index: 3;
}
.wp-editor__controls {
  display: flex;
  flex-direction: column;
  gap: var(--dv-space-sm);
}
.wp-editor__controls label {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.wp-editor__label {
  font-size: 13px;
  color: var(--dv-on-surface-variant);
}
.wp-editor__label b {
  color: var(--dv-on-surface);
}
.wp-editor__controls input[type='range'] {
  width: 100%;
  accent-color: var(--dv-primary);
}
.wp-editor__actions {
  display: flex;
  gap: var(--dv-space-sm);
  justify-content: flex-end;
}
</style>