<script setup lang="ts">
/**
 * ReleaseNotesDialog — 版本更新日志弹窗（2.10.8）
 * - 复用既有 DVSheet 体系（非新建 Modal 框架）；内容过多时内部滚动。
 * - 自动弹窗模式：用户点「知道了」或主动关闭 → emit confirmed（调用方写入 lastSeen）。
 * - 手动查看模式（设置 → 更新日志）：仅浏览历史，不要求调用方写 lastSeen（由调用方决定）。
 */
import { computed } from 'vue';
import { DVSheet, DVButton } from '@/components/design';
import { CURRENT_VERSION, releaseNoteForVersion } from '@/core/release-notes';

const props = withDefaults(
  defineProps<{
    modelValue: boolean;
    /** 指定展示的版本（默认当前版本）；手动查看历史版本时传入 */
    version?: string;
  }>(),
  { modelValue: false, version: CURRENT_VERSION },
);
const emit = defineEmits<{ 'update:modelValue': [value: boolean]; confirmed: [] }>();

const note = computed(() => releaseNoteForVersion(props.version));

function close() {
  emit('update:modelValue', false);
}

function confirm() {
  emit('confirmed');
  close();
}
</script>

<template>
  <DVSheet
    :model-value="modelValue"
    :title="`每日的价值 ${version}`"
    max-height="min(70dvh, 560px)"
    @update:model-value="(v: boolean) => emit('update:modelValue', v)"
  >
    <div class="rn">
      <p v-if="note" class="rn__subtitle">{{ note.title }}</p>
      <ul v-if="note" class="rn__list">
        <li v-for="(item, i) in note.items" :key="i" class="rn__item">• {{ item }}</li>
      </ul>
      <p v-else class="rn__empty">暂无更新内容</p>

      <div class="rn__footer">
        <DVButton block size="lg" @click="confirm">知道了</DVButton>
      </div>
    </div>
  </DVSheet>
</template>

<style scoped>
.rn {
  display: flex;
  flex-direction: column;
  gap: var(--dv-space-md);
}
.rn__subtitle {
  font-size: 15px;
  font-weight: 600;
  color: var(--dv-on-surface);
}
.rn__list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: var(--dv-space-sm);
}
.rn__item {
  font-size: 14px;
  line-height: 1.6;
  color: var(--dv-on-surface-variant);
}
.rn__empty {
  font-size: 14px;
  color: var(--dv-on-surface-variant);
}
.rn__footer {
  margin-top: var(--dv-space-xs);
}
</style>