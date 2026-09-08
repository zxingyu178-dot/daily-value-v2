<script setup lang="ts">
/**
 * WallpaperCropperDemo — 技术验证页（开发工具页，非业务页面）
 *
 * 目标：用成熟 vue-advanced-cropper 替代自研 positionX/positionY/scale 壁纸编辑器。
 * - 选择一张真实照片
 * - Cropper 裁剪框按当前设备 WebView 屏幕比例生成（WYSIWYG ≈ 主页壁纸可见区域）
 * - 单指拖动 / 双指缩放（由组件处理，imageRestriction=stencil ⇒ 永远 cover，无空边）
 * - blur / overlay 实时预览（参数单独保存，不写入图片像素）
 * - 点击「应用」→ 从 Cropper 输出最终 canvas → JPEG 压缩 → 显示 Final Preview
 * - 全程用 URL.createObjectURL / createImageBitmap，不把整张原图 readAsDataURL
 *
 * 本页仅做技术验证；正式接入 Settings 在 Demo 验收通过后再进行。
 */
import { ref, computed, nextTick, onBeforeUnmount, onMounted } from 'vue';
import { Cropper, RectangleStencil, type CropperResult } from 'vue-advanced-cropper';
import 'vue-advanced-cropper/dist/style.css';
import { DVButton, toast } from '@/components/design';

const cropperRef = ref<InstanceType<typeof Cropper> | null>(null);

// 供自动化验收（CDP）读取的设备/导出指标（仅开发工具页使用）
onMounted(() => {
  (window as unknown as Record<string, unknown>).__wpdemo = {
    get state() {
      return {
        vw: vw.value,
        vh: vh.value,
        dpr: dpr.value,
        vv: { ...vv.value },
        aspect: stencilAspect.value,
        exportW: exportW.value,
        exportH: exportH.value,
        imgReady: imgReady.value,
        fileName: fileName.value,
        finalW: finalW.value,
        finalH: finalH.value,
        finalAspect: finalAspect.value,
        blur: blur.value,
        overlay: overlay.value,
      };
    },
    getResult: () => cropperRef.value?.getResult() ?? null,
  };
});

// ---- 设备可视区域（WebView CSS viewport） ----
const vw = ref(window.innerWidth);
const vh = ref(window.innerHeight);
const dpr = ref(window.devicePixelRatio || 1);
const vv = ref({ width: window.visualViewport?.width ?? 0, height: window.visualViewport?.height ?? 0 });

// 壁纸区域 = 全屏 App 背景 ⇒ 用整机（WebView 全屏）长宽比
// stencil 宽高比 = vw / vh（如 412/915 ≈ 0.450，与 1440/3200≈0.450 同档）
const stencilAspect = computed(() => (vh.value > 0 ? vw.value / vh.value : 0.45));

// ---- 编辑器状态 ----
const src = ref<string | null>(null);
const fileName = ref('');
const imgReady = ref(false);
const selecting = ref(false);

const blur = ref(0);
const overlay = ref(0);

// ---- 输出 / Final Preview ----
const finalUrl = ref<string | null>(null);
const finalW = ref(0);
const finalH = ref(0);
const finalAspect = ref(0);
const applying = ref(false);
let appliedBlur = 0;
let appliedOverlay = 0;

// 导出最长边目标（现代旗舰屏）
const TARGET_LONG_EDGE = 2560;

// 导出画布：按设备比例 + 目标长边（2560px）计算宽高，保证宽高比与 stencil/device 一致
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
// 交互阶段用低画布，保证拖动/pinch 流畅；应用时切换到 exportCanvas
const canvasConfig = ref<{ width?: number; height?: number; maxArea?: number }>({ maxArea: 600000 });

let pickObjectUrl: string | null = null;

async function onPickFile(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  selecting.value = true;
  imgReady.value = false;
  finalUrl.value = null;
  fileName.value = file.name;
  try {
    // 用 objectURL 喂给 Cropper（避免整张超大原图先转 base64）
    if (pickObjectUrl) URL.revokeObjectURL(pickObjectUrl);
    pickObjectUrl = URL.createObjectURL(file);
    await nextTickLoad();
    src.value = pickObjectUrl;
  } catch (err) {
    console.error('[wpdemo] 加载图片失败', err);
    toast.error('图片加载失败');
  } finally {
    selecting.value = false;
    input.value = '';
  }
}

function nextTickLoad() {
  return new Promise<void>((res) => setTimeout(res, 0));
}

function onCropperImage() {
  imgReady.value = true;
}

function onReady() {
  imgReady.value = true;
}

async function apply() {
  const cropper = cropperRef.value;
  if (!cropper) return;
  applying.value = true;
  try {
    // 应用阶段临时切换到高分辨率画布，交由组件自行处理 EXIF orientation 与坐标，导出后恢复交互画布
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
    const prevUrl = finalUrl.value;
    if (prevUrl) URL.revokeObjectURL(prevUrl);
    finalUrl.value = URL.createObjectURL(blob);
    finalW.value = outW;
    finalH.value = outH;
    finalAspect.value = outW / outH;
    appliedBlur = blur.value;
    appliedOverlay = overlay.value;
    toast.success(`已导出 ${outW}×${outH} JPEG`);
  } catch (err) {
    console.error('[wpdemo] 导出失败', err);
    toast.error('导出失败');
  } finally {
    applying.value = false;
  }
}

function containerStyle() {
  return {
    width: '100%',
    height: '100%',
    filter: `blur(${blur.value}px)`,
  };
}

onBeforeUnmount(() => {
  if (pickObjectUrl) URL.revokeObjectURL(pickObjectUrl);
  const f = finalUrl.value;
  if (f) URL.revokeObjectURL(f);
});
</script>

<template>
  <div class="wpdemo" :data-wpdemo-aspect="stencilAspect.toFixed(4)">
    <header class="wpdemo__header">
      <h1>Wallpaper Cropper Demo</h1>
      <p class="wpdemo__sub">
        设备 viewport：{{ vw }}×{{ vh }} · DPR {{ dpr }} · visualViewport
        {{ vv.width }}×{{ vv.height }} · 裁剪比例 {{ (stencilAspect * 100).toFixed(1) }}% ·
        导出 {{ exportW }}×{{ exportH }}
      </p>
      <div class="wpdemo__pick">
        <label class="wpdemo__filebtn" data-role="pick">
          选择图片<input type="file" accept="image/*" @change="onPickFile" />
        </label>
        <span v-if="fileName" class="wpdemo__fname">{{ fileName }}</span>
      </div>
    </header>

    <!-- 编辑器：裁剪框按设备屏幕比例 -->
    <section class="wpdemo__editor">
      <div v-if="!src" class="wpdemo__empty">
        <p>选择一张真实照片开始</p>
        <p class="wpdemo__sub">裁剪框宽高比 = 当前设备屏幕宽高比</p>
      </div>
      <div v-else class="wpdemo__canvas" style="--tap:none; touch-action: none">
        <div class="wpdemo__blurlayer" :style="containerStyle()">
          <Cropper
            ref="cropperRef"
            class="wpdemo__cropper"
            :src="src"
            :stencil-component="RectangleStencil"
            :stencil-props="{ aspectRatio: stencilAspect, movable: false, resizeable: false, handlers: {}, lines: {} }"
            :image-restriction="'stencil'"
            :resize-image="true"
            :min-width="100"
            :min-height="100"
            :canvas="canvasConfig"
            image-style="max-width: 100%"
            @image="onCropperImage"
            @ready="onReady"
          />
        </div>
        <div class="wpdemo__overlay" :style="{ opacity: overlay }" />
        <span class="wpdemo__badge">ratio {{ (stencilAspect * 100).toFixed(1) }}%</span>
      </div>
    </section>

    <!-- 调节：blur / overlay 实时预览（参数独立保存，不写进像素） -->
    <section v-if="imgReady" class="wpdemo__controls" data-role="controls">
      <label>
        <span class="wpdemo__label">模糊 <b data-field="blur">{{ blur.toFixed(0) }}</b></span>
        <input v-model.number="blur" type="range" min="0" max="16" step="1" data-role="blur" />
      </label>
      <label>
        <span class="wpdemo__label">明暗遮罩 <b data-field="overlay">{{ (overlay * 100).toFixed(0) }}%</b></span>
        <input v-model.number="overlay" type="range" min="0" max="1" step="0.05" data-role="overlay" />
      </label>
    </section>

    <!-- 操作 -->
    <section v-if="imgReady" class="wpdemo__actions" data-role="actions">
      <DVButton variant="ghost" @click="finalUrl = null">清除结果</DVButton>
      <DVButton :disabled="applying" data-role="apply" @click="apply">应用</DVButton>
    </section>

    <!-- Final Preview：导出结果 + blur/overlay，模拟主页壁纸构图 -->
    <section v-if="finalUrl" class="wpdemo__final" data-role="final">
      <h2>Final Preview（模拟主页壁纸构图）</h2>
      <p class="wpdemo__sub">
        导出 {{ finalW }}×{{ finalH }} · 比例 {{ (finalAspect * 100).toFixed(1) }}% · blur
        {{ appliedBlur.toFixed(0) }} · overlay {{ (appliedOverlay * 100).toFixed(0) }}%
      </p>
      <div
        class="wpdemo__finalpreview"
        :style="{ aspectRatio: `${finalW}/${finalH}`, filter: `blur(${appliedBlur}px)` }"
      >
        <img :src="finalUrl" alt="final" />
        <div class="wpdemo__overlay" :style="{ opacity: appliedOverlay }" />
      </div>
    </section>
  </div>
</template>

<style scoped>
.wpdemo {
  --dv-screen-aspect: v-bind('stencilAspect.toFixed(4)');
  max-width: 560px;
  margin: 0 auto;
  padding: var(--dv-space-md);
  display: flex;
  flex-direction: column;
  gap: var(--dv-space-md);
  color: var(--dv-on-surface);
}
.wpdemo__header h1 {
  font-size: 22px;
}
.wpdemo__sub {
  font-size: 12px;
  color: var(--dv-on-surface-variant);
  margin-top: var(--dv-space-xxs);
}
.wpdemo__pick {
  margin-top: var(--dv-space-xs);
  display: flex;
  align-items: center;
  gap: var(--dv-space-xs);
  flex-wrap: wrap;
}
.wpdemo__filebtn {
  display: inline-flex;
  align-items: center;
  padding: var(--dv-space-xs) var(--dv-space-sm);
  background: var(--dv-primary);
  color: var(--dv-on-primary, #fff);
  border-radius: var(--dv-radius-sm);
  font-size: 14px;
  cursor: pointer;
}
.wpdemo__filebtn input {
  display: none;
}
.wpdemo__fname {
  font-size: 12px;
  color: var(--dv-on-surface-variant);
}
.wpdemo__editor {
  position: relative;
  width: 100%;
  border-radius: var(--dv-radius-md);
  overflow: hidden;
  background: #14151a;
}
.wpdemo__empty {
  height: 46vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  background: #14151a;
  color: #cfd0d8;
  gap: var(--dv-space-xxs);
  touch-action: none;
}
.wpdemo__canvas {
  position: relative;
  width: 100%;
  height: 60vh;
  touch-action: none;
}
.wpdemo__blurlayer {
  position: absolute;
  inset: 0;
}
.wpdemo__cropper {
  height: 100%;
  --vc-something: none;
}
.wpdemo__overlay {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: #000;
  transition: opacity 60ms linear;
}
.wpdemo__badge {
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
.wpdemo__controls {
  display: flex;
  flex-direction: column;
  gap: var(--dv-space-sm);
}
.wpdemo__controls label {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.wpdemo__label {
  font-size: 13px;
  color: var(--dv-on-surface-variant);
}
.wpdemo__label b {
  color: var(--dv-on-surface);
}
.wpdemo__controls input[type='range'] {
  width: 100%;
  accent-color: var(--dv-primary);
}
.wpdemo__actions {
  display: flex;
  gap: var(--dv-space-sm);
  justify-content: flex-end;
}
.wpdemo__final h2 {
  font-size: 16px;
  margin-bottom: var(--dv-space-xxs);
}
.wpdemo__finalpreview {
  position: relative;
  width: 100%;
  max-width: 300px;
  margin-top: var(--dv-space-xs);
  border-radius: var(--dv-radius-md);
  overflow: hidden;
  background: #000;
  border: 1px solid var(--dv-outline);
}
.wpdemo__finalpreview img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
</style>