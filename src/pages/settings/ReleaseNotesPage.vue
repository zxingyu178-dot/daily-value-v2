<script setup lang="ts">
/**
 * ReleaseNotesPage — 设置内「更新日志」永久入口（2.10.8）
 * - 展示全部历史 Release Notes（自正式加入本模块的版本起）。
 * - 手动查看只是浏览历史：不改变自动弹窗的首次显示逻辑。
 */
import { DVCard } from '@/components/design';
import { RELEASE_NOTES } from '@/core/release-notes';
</script>

<template>
  <section class="page">
    <DVCard outlined>
      <h1 class="page__title">更新日志</h1>
      <p class="page__desc">了解每个版本带来的变化</p>

      <div v-for="note in RELEASE_NOTES" :key="note.version" class="rn-block">
        <h2 class="rn-block__version">V{{ note.version }}</h2>
        <ul class="rn-block__list">
          <li v-for="(item, i) in note.items" :key="i" class="rn-block__item">• {{ item }}</li>
        </ul>
      </div>
    </DVCard>
  </section>
</template>

<style scoped>
.page {
  padding: var(--dv-space-md);
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
.rn-block {
  margin-top: var(--dv-space-lg);
  padding-top: var(--dv-space-md);
  border-top: 1px solid var(--dv-surface-border);
}
.rn-block:first-of-type {
  border-top: none;
  margin-top: var(--dv-space-md);
}
.rn-block__version {
  font-size: 15px;
  font-weight: 600;
  color: var(--dv-on-surface);
}
.rn-block__list {
  margin: var(--dv-space-sm) 0 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: var(--dv-space-sm);
}
.rn-block__item {
  font-size: 14px;
  line-height: 1.6;
  color: var(--dv-on-surface-variant);
}
</style>