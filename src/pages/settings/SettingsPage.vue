<script setup lang="ts">
/**
 * 设置页（Phase 6 v2）：保持简洁。
 * 只保留主题相关配置（明暗三态 + 强调色 + 玻璃强调色）+「壁纸设置」独立入口。
 *
 * 壁纸相关的选图/预览/拖动/滑杆/Cropper 已全部移出本页，
 * 收敛到独立页 /settings/wallpaper（WallpaperSettingsPage）。
 */
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import { DVCard } from '@/components/design';
import { useSettingsStore } from '@/core/store/settings';
import {
  themeAccentList,
  themeAccents,
  glassStyleList,
  glassStyles,
  type GlassStyleId,
} from '@/theme/tokens';

const router = useRouter();
const settings = useSettingsStore();

const themeModes = [
  { value: 'auto', label: '跟随系统' },
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
] as const;

const accentList = computed(() =>
  themeAccentList.map((id) => ({ id, ...themeAccents[id] })),
);

async function selectMode(value: 'auto' | 'light' | 'dark') {
  await settings.update({ theme: value });
}

async function selectAccent(id: (typeof themeAccentList)[number]) {
  await settings.update({ themeColor: id });
}

/* 2.10.4 玻璃强调色（深色毛玻璃，独立于强调色主题） */
const glassList = computed(() =>
  glassStyleList.map((id) => ({ id, ...glassStyles[id] })),
);
async function selectGlass(id: GlassStyleId) {
  await settings.update({ themeGlass: id });
}

/** 是否已设置壁纸（入口附带一行简短状态） */
const hasWallpaper = computed(() => !!settings.wallpaper?.image);

/** 进入独立壁纸设置页 */
function goWallpaperSettings() {
  router.push('/settings/wallpaper');
}

/** 进入周期记账页 */
function goRecurring() {
  router.push('/settings/recurring');
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

      <div class="block">
        <div class="block__label">强调色</div>
        <div class="swatches" role="radiogroup" aria-label="强调色">
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

      <!-- 2.10.4 玻璃强调色（深色毛玻璃；默认关闭 = 完全保持现状） -->
      <div class="block">
        <div class="block__label">玻璃强调色（深色）</div>
        <div class="swatches" role="radiogroup" aria-label="玻璃强调色">
          <button
            v-for="g in glassList"
            :key="g.id"
            type="button"
            class="swatch"
            :class="{ 'is-active': settings.themeGlass === g.id }"
            :style="{ '--chip': g.chip }"
            :aria-checked="settings.themeGlass === g.id"
            role="radio"
            :aria-label="g.label"
            @click="selectGlass(g.id)"
          >
            <span class="swatch__dot" aria-hidden="true"></span>
            <span class="swatch__name">{{ g.label }}</span>
          </button>
        </div>
        <p class="block__hint">毛玻璃质感需配合深色主题；默认「关闭」保持现有样式。</p>
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
    </DVCard>
  </section>
</template>

<style scoped>
.page {
  padding: var(--dv-space-md);
  /* 设置页无 App 顶部导航（showNav=false），自身补足顶部安全区，
     与首页/统计/日价的顶部边距规则保持一致；不单独写“贴顶”布局 */
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

/* 明暗三态分段选择 */
.seg {
  display: flex;
  gap: var(--dv-space-xs);
  padding: 3px;
  background: var(--dv-surface-alt);
  border-radius: var(--dv-radius-md);
}
.seg__item {
  flex: 1;
  padding: 8px 10px;
  border: none;
  border-radius: var(--dv-radius-sm);
  background: transparent;
  color: var(--dv-on-surface-variant);
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition:
    background-color var(--dv-motion-fast) var(--dv-ease-standard),
    color var(--dv-motion-fast) var(--dv-ease-standard);
}
.seg__item.is-active {
  background: var(--dv-primary);
  color: var(--dv-on-primary);
}

/* 强调色选择 */
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
/* 玻璃强调色说明（2.10.4） */
.block__hint {
  margin-top: var(--dv-space-xs);
  font-size: 12px;
  color: var(--dv-on-surface-variant);
}

/* 壁纸设置入口 */
.wp-entry {
  display: flex;
  align-items: center;
  gap: var(--dv-space-sm);
  width: 100%;
  padding: var(--dv-space-sm) var(--dv-space-sm);
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
</style>