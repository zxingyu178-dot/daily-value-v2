<script setup lang="ts">
/**
 * MigrationFailure - 数据升级未完成安全页（Phase 2）
 *
 * 触发条件：检测到 v1 数据存在，但 v1 → v2 迁移失败（数量校验/内容校验/步骤异常）。
 * 行为：
 * - 显示明确的"数据升级未完成"状态与错误原因
 * - 保留原始 v1 数据（localStorage 不删除）+ meta 中的 v1-backup 备份
 * - 提供"重新尝试迁移"按钮（再次执行迁移，成功后自动回到正常 App）
 * - 展示诊断信息（数量/内容校验汇总）
 * - 不进入正常账单页面，避免用户误以为数据丢失
 */
import { ref } from 'vue';
import { runMigrations } from '@/core/migration/manager';
import type { MigrationResult } from '@/core/migration/types';

const props = defineProps<{
  result: MigrationResult;
}>();

const retrying = ref(false);
const retryError = ref('');

async function retry() {
  retrying.value = true;
  retryError.value = '';
  try {
    const r = await runMigrations();
    if (r.ok) {
      // 迁移成功 → 刷新回到正常 App（main.ts 再次启动将挂载正常 App）
      window.location.reload();
      return;
    }
    retryError.value = r.message;
  } catch (err) {
    retryError.value = String(err);
  } finally {
    retrying.value = false;
  }
}

const failedCounts = (props.result.counts ?? []).filter((c) => !c.pass);
const failedContents = (props.result.contents ?? []).filter((c) => !c.pass);
</script>

<template>
  <div class="mf">
    <div class="mf__card">
      <div class="mf__icon">⚠️</div>
      <h1 class="mf__title">数据升级未完成</h1>
      <p class="mf__desc">
        检测到 v1 版本数据，但升级到 v2 的过程中出现异常。为保护您的数据，
        应用没有进入账单页面。您的原始数据不会被删除。
      </p>

      <div class="mf__section">
        <div class="mf__label">错误原因</div>
        <pre class="mf__reason">{{ result.message }}</pre>
      </div>

      <div v-if="result.backedUp" class="mf__section">
        <div class="mf__label">数据保护状态</div>
        <ul class="mf__list">
          <li>✓ 原始 v1 数据（localStorage）已保留</li>
          <li>✓ 迁移前备份（v1-backup）已写入，可回滚排查</li>
        </ul>
      </div>

      <div v-if="failedCounts.length > 0 || failedContents.length > 0" class="mf__section">
        <div class="mf__label">校验诊断</div>
        <ul class="mf__list">
          <li v-for="c in failedCounts" :key="'c' + c.label">
            ✗ 数量校验「{{ c.label }}」：v1={{ c.source }} → v2={{ c.migrated }} {{ c.note ?? '' }}
          </li>
          <li v-for="c in failedContents" :key="'t' + c.label">
            ✗ 内容校验「{{ c.label }}」：{{ c.source }} → {{ c.migrated }}
          </li>
        </ul>
      </div>

      <button class="mf__btn" :disabled="retrying" @click="retry">
        {{ retrying ? '正在重新迁移…' : '重新尝试迁移' }}
      </button>
      <p v-if="retryError" class="mf__err">{{ retryError }}</p>
      <p class="mf__hint">
        若反复失败，请保留此页并记录错误原因，等待技术支持处理。
      </p>
    </div>
  </div>
</template>

<style scoped>
.mf {
  min-height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--dv-space-lg);
  background: var(--dv-bg);
  color: var(--dv-on-surface);
  font-size: 14px;
  line-height: 1.6;
}
.mf__card {
  width: 100%;
  max-width: 420px;
  background: var(--dv-surface);
  border: 1px solid var(--dv-outline);
  border-radius: var(--dv-radius-lg);
  padding: var(--dv-space-lg);
}
.mf__icon {
  font-size: 40px;
  text-align: center;
}
.mf__title {
  font-size: 20px;
  font-weight: 700;
  text-align: center;
  margin: var(--dv-space-sm) 0;
}
.mf__desc {
  color: var(--dv-on-surface-variant);
  text-align: center;
}
.mf__section {
  margin-top: var(--dv-space-md);
}
.mf__label {
  font-size: 12px;
  color: var(--dv-on-surface-variant);
  font-weight: 600;
  margin-bottom: var(--dv-space-xs);
}
.mf__reason {
  background: var(--dv-surface-alt);
  border-radius: var(--dv-radius-sm);
  padding: var(--dv-space-sm);
  font-size: 12px;
  white-space: pre-wrap;
  word-break: break-all;
  color: var(--dv-danger);
}
.mf__list {
  list-style: none;
  padding: 0;
  margin: 0;
  font-size: 13px;
}
.mf__btn {
  width: 100%;
  margin-top: var(--dv-space-lg);
  padding: 12px;
  border-radius: var(--dv-radius-md);
  background: var(--dv-primary);
  color: var(--dv-on-primary);
  font-size: 15px;
  font-weight: 600;
}
.mf__btn:disabled {
  opacity: 0.6;
}
.mf__err {
  margin-top: var(--dv-space-sm);
  color: var(--dv-danger);
  font-size: 12px;
  word-break: break-all;
}
.mf__hint {
  margin-top: var(--dv-space-sm);
  color: var(--dv-on-surface-variant);
  font-size: 12px;
  text-align: center;
}
</style>
