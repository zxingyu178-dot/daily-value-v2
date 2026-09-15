<script setup lang="ts">
/**
 * 设置页（2.13.0 Theme V2）：
 * 「明暗主题」seg + 「界面风格」seg（classic/soft/minimal/glass）+ 「主题颜色」色板（含自定义 Sheet）+ 入口区。
 * Theme V2 去掉了旧「玻璃强调色（深色）」独立概念，收敛为 风格 + 颜色 两个维度。
 * 所有切换走 settingsStore.update → appStore（data-theme / data-theme-style / CSS 变量）→ 即时全局生效。
 */
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { DVCard, DVSheet } from '@/components/design';
import { useSettingsStore } from '@/core/store/settings';
import { useAppStore } from '@/core/store/app';
import {
  themeAccentList,
  themeAccents,
  themeStyleList,
  themeStyles,
  type ThemeAccentId,
  type ThemeStyleId,
} from '@/theme/tokens';
import { deriveCustomAccent, hexToHue, parseHexColor } from '@/theme/theme-v2';

const router = useRouter();
const settings = useSettingsStore();
const app = useAppStore();

const themeModes = [
  { value: 'auto', label: '跟随系统' },
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
] as const;

const styleList = computed(() => themeStyleList.map((id) => ({ id, ...themeStyles[id] })));

/** 主题色板选项（5 预设 + 自定义） */
interface AccentOption {
  id: ThemeAccentId | 'custom';
  label: string;
  chip: string;
}

/** 主题色板：5 预设 + 自定义（custom 唤起 Sheet） */
const accentList = computed<AccentOption[]>(() => [
  ...themeAccentList.map((id) => ({ id, ...themeAccents[id] })),
  { id: 'custom', label: '自定义', chip: app.customThemeColor ?? '#4f8df7' },
]);

async function selectMode(value: 'auto' | 'light' | 'dark') {
  await settings.update({ theme: value });
}

async function selectStyle(id: ThemeStyleId) {
  await settings.update({ themeStyle: id });
}

function selectAccent(id: ThemeAccentId | 'custom') {
  if (id === 'custom') {
    openCustomSheet();
    return;
  }
  void settings.update({ themeColor: id });
}

/* ---------- 自定义主题主色 Sheet（预览圆 + Hue 滑杆 + HEX 输入） ---------- */
const customSheetOpen = ref(false);
const customHex = ref('#4f8df7');
const customError = ref('');
/**
 * 2.13.2：Hue 滑杆位置绑定当前 HEX 派生色相（HEX → HSL → hue）。
 * 打开 Sheet 时从已保存 customThemeColor 恢复；拖 Hue / 输合法 HEX 实时同步；非法 HEX 保持原位置。
 * 不再写死 :value="0" 导致重开滑杆回起点。
 */
const customHue = ref(0);
function syncHueFromHex() {
  if (parseHexColor(customHex.value)) customHue.value = hexToHue(customHex.value);
}

/** HSL → #RRGGBB（Hue 滑杆用；S/L 固定保证预览的是一组和谐色） */
function hexFromHue(h: number): string {
  const s = 0.72;
  const l = 0.55;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;
  if (hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = l - c / 2;
  const to = (v: number) =>
    Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}

function openCustomSheet() {
  customHex.value =
    settings.customThemeColor && parseHexColor(settings.customThemeColor)
      ? settings.customThemeColor
      : '#4f8df7';
  syncHueFromHex(); // 恢复已保存色相位置
  customError.value = '';
  customSheetOpen.value = true;
}

function onHueChange(e: Event) {
  const h = Number((e.target as HTMLInputElement).value);
  customHue.value = h;
  customHex.value = hexFromHue(h);
  customError.value = '';
}

function onHexInput(e: Event) {
  customHex.value = (e.target as HTMLInputElement).value;
  // 合法 HEX：预览与 Hue 位置同步；非法 HEX：不改变正式颜色、滑块保持原位（错误由应用时提示）
  syncHueFromHex();
  customError.value = '';
}

function applyCustomColor() {
  if (!parseHexColor(customHex.value)) {
    customError.value = '仅支持合法的 #RRGGBB 色值';
    return; // 非法 HEX 拒绝应用
  }
  void settings.update({ themeColor: 'custom', customThemeColor: customHex.value.toUpperCase() });
  customSheetOpen.value = false;
}

/** Sheet 内即时预览：当前输入的主色（含深色适亮） */
const previewPrimary = computed(() => {
  if (!parseHexColor(customHex.value)) return customHex.value;
  return deriveCustomAccent(customHex.value, app.resolvedTheme)?.primary ?? customHex.value;
});
const previewOnPrimary = computed(() => {
  if (!parseHexColor(customHex.value)) return '#ffffff';
  return deriveCustomAccent(customHex.value, app.resolvedTheme)?.onPrimary ?? '#ffffff';
});

const hasWallpaper = computed(() => !!settings.wallpaper?.image);
function goWallpaperSettings() {
  router.push('/settings/wallpaper');
}
function goRecurring() {
  router.push('/settings/recurring');
}
function goReleaseNotes() {
  router.push('/settings/release-notes');
}
function goDataBackup() {
  router.push('/settings/data-backup');
}
function goAutoBill() {
  // 2.16.4：设置主页入口进入 AutoBill 并定位到 SettingsPanel（内部面板，非独立路由）
  router.push('/autobill?panel=settings');
}
</script>

<template>
  <section class="page">
    <DVCard outlined>
      <h1 class="page__title">设置</h1>
      <p class="page__desc">主题与外观 · 全局生效</p>

      <div class="block">
        <div class="block__label">明暗主题</div>
        <div class="seg" role="radiogroup" aria-label="明暗主题">
          <button
            v-for="mode in themeModes"
            :key="mode.value"
            type="button"
            class="seg__item"
            :class="{ 'is-active': settings.theme === mode.value }"
            :aria-checked="settings.theme === mode.value"
            role="radio"
            @click="selectMode(mode.value)"
          >
            {{ mode.label }}
          </button>
        </div>
      </div>

      <!-- 2.13.0 Theme V2：界面风格（Token 层生效，切换即时全局预览） -->
      <div class="block">
        <div class="block__label">界面风格</div>
        <div class="seg" role="radiogroup" aria-label="界面风格">
          <button
            v-for="s in styleList"
            :key="s.id"
            type="button"
            class="seg__item seg__item--style"
            :class="{ 'is-active': settings.themeStyle === s.id }"
            :aria-checked="settings.themeStyle === s.id"
            role="radio"
            @click="selectStyle(s.id)"
          >
            <span class="seg__dot" :style="{ background: s.chip }" aria-hidden="true" />
            <span>{{ s.label }}</span>
          </button>
        </div>
      </div>

      <!-- 2.13.0 Theme V2：主题颜色（5 预设 + 自定义；自定义走 Sheet） -->
      <div class="block">
        <div class="block__label">主题颜色</div>
        <div class="swatches" role="radiogroup" aria-label="主题颜色">
          <button
            v-for="accent in accentList"
            :key="accent.id"
            type="button"
            class="swatch"
            :class="{ 'is-active': settings.themeColor === accent.id }"
            :style="{ '--chip': accent.chip }"
            :aria-checked="settings.themeColor === accent.id"
            role="radio"
            :aria-label="accent.label"
            @click="selectAccent(accent.id)"
          >
            <span class="swatch__dot" aria-hidden="true"></span>
            <span class="swatch__name">{{ accent.label }}</span>
          </button>
        </div>
      </div>

      <div class="block">
        <div class="block__label">壁纸</div>
        <button class="wp-entry" type="button" @click="goWallpaperSettings">
          <span class="wp-entry__title">壁纸设置</span>
          <span class="wp-entry__status">{{ hasWallpaper ? '已设置' : '未设置' }}</span>
          <span class="wp-entry__chevron" aria-hidden="true">›</span>
        </button>
      </div>

      <div class="block">
        <div class="block__label">记账</div>
        <button class="wp-entry" type="button" @click="goRecurring">
          <span class="wp-entry__title">周期记账</span>
          <span class="wp-entry__status">自动生成定期账单</span>
          <span class="wp-entry__chevron" aria-hidden="true">›</span>
        </button>
      </div>

      <!-- 2.14.0：数据与备份独立页入口 -->
      <div class="block">
        <div class="block__label">数据</div>
        <button class="wp-entry" type="button" @click="goDataBackup">
          <span class="wp-entry__title">数据与备份</span>
          <span class="wp-entry__status">备份、恢复与 CSV 导出</span>
          <span class="wp-entry__chevron" aria-hidden="true">›</span>
        </button>
      </div>

      <!-- 2.15.0 Gate A：自动记账独立页入口 -->
      <div class="block">
        <div class="block__label">自动化</div>
        <button class="wp-entry" type="button" @click="goAutoBill">
          <span class="wp-entry__title">自动记账</span>
          <span class="wp-entry__status">支付通知 → 待确认账单</span>
          <span class="wp-entry__chevron" aria-hidden="true">›</span>
        </button>
      </div>

      <div class="block">
        <div class="block__label">关于</div>
        <button class="wp-entry" type="button" @click="goReleaseNotes">
          <span class="wp-entry__title">更新日志</span>
          <span class="wp-entry__status">查看版本变化</span>
          <span class="wp-entry__chevron" aria-hidden="true">›</span>
        </button>
      </div>
    </DVCard>

    <!-- 自定义主题主色 Sheet：迷你 Hero 预览 + 预览圆 + Hue 滑杆 + HEX 输入 + 应用 -->
    <DVSheet v-model="customSheetOpen" title="自定义主题颜色">
      <div class="custom">
        <!-- 2.13.2 迷你 Hero 预览：复用真实 Hero Token（--dv-hero-*），仅覆盖主题主色做即时预览 -->
        <div class="custom__hero-wrap">
          <div
            class="custom__hero-card"
            :style="{ '--dv-primary': previewPrimary, '--dv-on-primary': previewOnPrimary }"
            aria-hidden="true"
          >
            <span class="custom__hero-date">2026年9月</span>
            <span class="custom__hero-amount">¥ 604.61</span>
            <span class="custom__hero-sub">本月支出</span>
          </div>
          <span class="custom__hero-caption">记账主卡片预览（随当前界面风格）</span>
        </div>

        <div class="custom__preview">
          <span
            class="custom__preview-circle"
            :style="{ background: previewPrimary, color: previewOnPrimary }"
            aria-hidden="true"
          >A</span>
          <span class="custom__preview-label">当前主色 {{ previewPrimary }}</span>
        </div>

        <label class="custom__hue">
          <span class="custom__hue-label">色相</span>
          <input
            type="range"
            class="custom__hue-slider"
            min="0"
            max="360"
            step="1"
            :value="customHue"
            @input="onHueChange"
            aria-label="色相"
          />
        </label>

        <div class="custom__hex">
          <label class="custom__hex-label" for="custom-hex-input">HEX</label>
          <input
            id="custom-hex-input"
            class="custom__hex-input"
            type="text"
            :value="customHex"
            placeholder="#4F8DF7"
            inputmode="search"
            autocomplete="off"
            spellcheck="false"
            @input="onHexInput"
          />
        </div>

        <p v-if="customError" class="custom__error">{{ customError }}</p>

        <button type="button" class="custom__apply" @click="applyCustomColor">应用</button>
      </div>
    </DVSheet>
  </section>
</template>

<style scoped>
.page {
  padding: var(--dv-space-md);
  /* 设置页无 App 顶部导航（showNav=false），自身补足顶部安全区 */
  padding-top: calc(var(--dv-space-md) + var(--dv-safe-top));
}
.page__title {
  font-size: 20px;
  color: var(--dv-on-surface);
}
.page__desc {
  margin-top: var(--dv-space-xs);
  color: var(--dv-on-surface-variant);
}
.block {
  margin-top: var(--dv-space-lg);
}
.block__label {
  font-size: 13px;
  font-weight: 600;
  color: var(--dv-on-surface-variant);
  margin-bottom: var(--dv-space-sm);
}

/* 明暗 / 界面风格 分段选择 */
.seg {
  display: flex;
  gap: var(--dv-space-xs);
  padding: 3px;
  background: var(--dv-surface-alt);
  border-radius: var(--dv-radius-md);
}
.seg__item {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 8px 6px;
  border: none;
  border-radius: var(--dv-radius-sm);
  background: transparent;
  color: var(--dv-on-surface-variant);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
  transition:
    background-color var(--dv-motion-fast) var(--dv-ease-standard),
    color var(--dv-motion-fast) var(--dv-ease-standard);
}
.seg__item.is-active {
  background: var(--dv-primary);
  color: var(--dv-on-primary);
}
.seg__dot {
  flex-shrink: 0;
  width: 10px;
  height: 10px;
  border-radius: var(--dv-radius-pill);
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.08);
}

/* 主题颜色选择 */
.swatches {
  display: flex;
  flex-wrap: wrap;
  gap: var(--dv-space-sm);
}
.swatch {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 10px 12px;
  border: 1px solid var(--dv-outline);
  border-radius: var(--dv-radius-md);
  background: var(--dv-surface);
  cursor: pointer;
  transition:
    border-color var(--dv-motion-fast) var(--dv-ease-standard),
    box-shadow var(--dv-motion-fast) var(--dv-ease-standard);
}
.swatch.is-active {
  border-color: var(--dv-primary);
  box-shadow: 0 0 0 2px var(--dv-primary-soft);
}
.swatch__dot {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  background: var(--chip);
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.06);
}
.swatch__name {
  font-size: 12px;
  color: var(--dv-on-surface-variant);
}
.swatch.is-active .swatch__name {
  color: var(--dv-on-surface);
}

/* 壁纸/记账/关于 入口 */
.wp-entry {
  display: flex;
  align-items: center;
  gap: var(--dv-space-sm);
  width: 100%;
  min-height: 48px; /* 2.16.3：移动端入口统一 ≥44 */
  padding: var(--dv-space-sm) var(--dv-space-md);
  border: 1px solid var(--dv-outline);
  border-radius: var(--dv-radius-md);
  background: var(--dv-surface);
  cursor: pointer;
  transition:
    border-color var(--dv-motion-fast) var(--dv-ease-standard),
    background-color var(--dv-motion-fast) var(--dv-ease-standard);
}
.wp-entry:active {
  background: var(--dv-surface-alt);
}
.wp-entry__title {
  font-size: 14px;
  font-weight: 500;
  color: var(--dv-on-surface);
}
.wp-entry__status {
  margin-left: auto;
  font-size: 13px;
  color: var(--dv-on-surface-variant);
}
.wp-entry__chevron {
  color: var(--dv-on-surface-variant);
  font-size: 18px;
  line-height: 1;
}

/* 自定义颜色 Sheet */
.custom {
  display: flex;
  flex-direction: column;
  gap: var(--dv-space-md);
  padding: var(--dv-space-md) 0 calc(var(--dv-space-md) + var(--dv-safe-bottom));
}
/* 2.13.2 迷你 Hero 预览：真实 Hero Token（--dv-hero-*），仅以 inline 主色覆盖主题色 */
.custom__hero-wrap {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.custom__hero-card {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: var(--dv-space-md);
  border-radius: var(--dv-radius-lg);
  background: var(--dv-hero-bg);
  color: var(--dv-hero-text);
  border: var(--dv-hero-border);
  box-shadow: var(--dv-hero-shadow);
}
.custom__hero-date {
  font-size: 12px;
  color: var(--dv-hero-text-dim);
}
.custom__hero-amount {
  font-size: 22px;
  font-weight: 700;
  color: var(--dv-hero-text);
}
.custom__hero-sub {
  font-size: 12px;
  color: var(--dv-hero-text-dim);
}
.custom__hero-caption {
  font-size: 11px;
  color: var(--dv-on-surface-variant);
}
.custom__preview {
  display: flex;
  align-items: center;
  gap: var(--dv-space-sm);
}
.custom__preview-circle {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  font-size: 16px;
  font-weight: 700;
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.08);
}
.custom__preview-label {
  font-size: 13px;
  color: var(--dv-on-surface-variant);
}
.custom__hue {
  display: flex;
  flex-direction: column;
  gap: var(--dv-space-xs);
}
.custom__hue-label {
  font-size: 12px;
  color: var(--dv-on-surface-variant);
}
.custom__hue-slider {
  width: 100%;
  height: 10px;
  border-radius: var(--dv-radius-pill);
  appearance: none;
  -webkit-appearance: none;
  background: linear-gradient(
    to right,
    #ff0000,
    #ffff00,
    #00ff00,
    #00ffff,
    #0000ff,
    #ff00ff,
    #ff0000
  );
  outline: none;
}
.custom__hue-slider::-webkit-slider-thumb {
  appearance: none;
  -webkit-appearance: none;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: var(--dv-surface);
  border: 2px solid var(--dv-on-surface);
  cursor: pointer;
}
.custom__hex {
  display: flex;
  align-items: center;
  gap: var(--dv-space-sm);
}
.custom__hex-label {
  font-size: 12px;
  color: var(--dv-on-surface-variant);
}
.custom__hex-input {
  flex: 1;
  min-width: 0;
  padding: 8px 12px;
  border: 1px solid var(--dv-outline);
  border-radius: var(--dv-radius-md);
  background: var(--dv-surface-alt);
  color: var(--dv-on-surface);
  font-size: 14px;
  font-variant-numeric: tabular-nums;
  text-transform: uppercase;
}
.custom__error {
  font-size: 12px;
  color: var(--dv-danger);
}
.custom__apply {
  width: 100%;
  padding: var(--dv-space-sm);
  border-radius: var(--dv-radius-md);
  background: var(--dv-primary);
  color: var(--dv-on-primary);
  font-size: 15px;
  font-weight: 600;
}
</style>