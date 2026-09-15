<script setup lang="ts">
/**
 * 数据与备份页（2.14.0）— /settings/data-backup
 * 极简三入口：
 * - 完整备份：导出 DailyValueBackupV1 JSON（SAF 系统保存界面，用户选择位置）
 * - 从备份恢复：SAF 选择 → 校验 → 恢复预览 → 确认 → 整库替换（快照兜底回滚）
 * - 导出账单 CSV：UTF-8 BOM，Excel 直接打开
 *
 * 失败提示只展示友好文案（无法读取 / 版本不支持 / 恢复失败原数据已保留），
 * 详细错误只写 console。
 */
defineOptions({ name: 'DataBackupPage' });
import { ref, computed, onBeforeUnmount } from 'vue';
import { DVCard, DVConfirmDialog, toast } from '@/components/design';
import { unregisterOverlayForBack } from '@/components/design/back-handler';
import {
  openTextFile,
  saveTextFile,
} from '@/core/backup/file-bridge';
import {
  backupErrorMessage,
  defaultBackupFileName,
  defaultCsvFileName,
  type BackupErrorKind,
} from '@/core/backup/backup';
import { buildRestorePreview, executeRestore, exportBillsCsv, exportFullBackup } from '@/core/backup/restore';
import type { RestorePreview } from '@/core/backup/restore';

/* ---------- 完整备份 ---------- */
const exporting = ref(false);
async function onExportBackup() {
  if (exporting.value) return;
  exporting.value = true;
  try {
    const backup = await exportFullBackup();
    await saveTextFile({
      fileName: defaultBackupFileName(),
      mimeType: 'application/json',
      text: JSON.stringify(backup, null, 2),
    });
    toast.success('备份已保存');
  } catch (e) {
    console.error('[backup] export failed:', e);
    toast.error('备份保存失败');
  } finally {
    exporting.value = false;
  }
}

/* ---------- 从备份恢复 ---------- */
const preview = ref<RestorePreview | null>(null);
const previewOpen = ref(false);
const restoreError = ref('');
const restoring = ref(false);
/** 已选文件的原始内容（确认恢复时使用） */
const pendingRaw = ref<unknown>(null);

async function onPickRestore() {
  try {
    const { text } = await openTextFile();
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      restoreError.value = backupErrorMessage('bad-json');
      return;
    }
    const result = buildRestorePreview(raw);
    if ('error' in result) {
      restoreError.value = backupErrorMessage(result.error);
      return;
    }
    pendingRaw.value = raw;
    preview.value = result.preview;
    previewOpen.value = true;
  } catch (e) {
    console.error('[backup] open file failed:', e);
    // 用户取消选择 / 读取失败都保留现状，不报错误打扰
  }
}

async function onConfirmRestore() {
  if (restoring.value || pendingRaw.value === null) return;
  restoring.value = true;
  try {
    await executeRestore(pendingRaw.value);
    previewOpen.value = false;
    toast.success('恢复完成');
  } catch (e) {
    const kind = (e as Error)?.message as BackupErrorKind;
    toast.error(kind ? backupErrorMessage(kind) : '恢复失败，原数据已保留');
  } finally {
    pendingRaw.value = null;
    restoring.value = false;
  }
}

function onCancelRestore() {
  previewOpen.value = false;
  pendingRaw.value = null;
  restoreError.value = '';
}

/** 预览行（备份时间 / 版本 / 账单 / 分类 / 周期规则） */
const previewRows = computed(() => {
  const p = preview.value;
  if (!p) return [];
  return [
    { label: '备份时间', value: formatExportedAt(p.exportedAt) },
    { label: '版本', value: p.appVersion ? `Daily Value ${p.appVersion}` : '—' },
    { label: '账单', value: `${p.billCount} 条` },
    { label: '分类', value: `${p.categoryCount} 个` },
    { label: '周期规则', value: `${p.ruleCount} 条` },
  ];
});

function formatExportedAt(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/* ---------- 导出账单 CSV ---------- */
const exportingCsv = ref(false);
async function onExportCsv() {
  if (exportingCsv.value) return;
  exportingCsv.value = true;
  try {
    const csv = await exportBillsCsv();
    await saveTextFile({ fileName: defaultCsvFileName(), mimeType: 'text/csv', text: csv });
    toast.success('CSV 已导出');
  } catch (e) {
    console.error('[backup] csv export failed:', e);
    toast.error('CSV 导出失败');
  } finally {
    exportingCsv.value = false;
  }
}

onBeforeUnmount(() => {
  void unregisterOverlayForBack(onCancelRestore);
});
</script>

<template>
  <section class="page">
    <DVCard outlined>
      <h1 class="page__title">数据与备份</h1>
      <p class="page__desc">完整备份 · 从备份恢复 · 导出账单 CSV</p>

      <div class="block">
        <p class="block__label">完整备份</p>
        <button class="entry" type="button" :disabled="exporting" @click="onExportBackup">
          <span class="entry__body">
            <span class="entry__title">导出备份文件</span>
            <span class="entry__status">导出所有账单、分类、周期规则和设置</span>
          </span>
          <span class="entry__chevron" aria-hidden="true">→</span>
        </button>
      </div>

      <div class="block">
        <p class="block__label">从备份恢复</p>
        <button class="entry" type="button" @click="onPickRestore">
          <span class="entry__body">
            <span class="entry__title">选择备份文件</span>
            <span class="entry__status">用于换设备或回退到某个时间点</span>
          </span>
          <span class="entry__chevron" aria-hidden="true">→</span>
        </button>
        <p v-if="restoreError" class="error">{{ restoreError }}</p>
      </div>

      <div class="block">
        <p class="block__label">导出账单 CSV</p>
        <button class="entry" type="button" :disabled="exportingCsv" @click="onExportCsv">
          <span class="entry__body">
            <span class="entry__title">导出为 CSV</span>
            <span class="entry__status">用 Excel 或其它表格软件查看和分析</span>
          </span>
          <span class="entry__chevron" aria-hidden="true">→</span>
        </button>
      </div>
    </DVCard>

    <!-- 恢复预览 + 二次确认（不用 window.confirm） -->
    <DVConfirmDialog
      v-model="previewOpen"
      title="确认恢复"
      confirm-label="继续恢复"
      cancel-label="取消"
      :danger="false"
      @confirm="onConfirmRestore"
      @cancel="onCancelRestore"
    >
      <div class="preview">
        <p class="preview__notice">恢复将替换当前账单、分类、周期规则及相关设置。当前数据会先建立安全快照。</p>
        <dl class="preview__list">
          <div v-for="row in previewRows" :key="row.label" class="preview__row">
            <dt>{{ row.label }}</dt>
            <dd>{{ row.value }}</dd>
          </div>
        </dl>
      </div>
    </DVConfirmDialog>
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
.block {
  margin-top: var(--dv-space-lg);
}
.block__label {
  font-size: 13px;
  font-weight: 600;
  color: var(--dv-on-surface-variant);
  margin-bottom: var(--dv-space-sm);
}
.entry {
  /* 2.15.1：Grid 两行布局（title/chevron + desc/chevron），说明不再压缩/右对齐换行 */
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: center;
  column-gap: var(--dv-space-sm);
  row-gap: 2px;
  width: 100%;
  padding: var(--dv-space-sm);
  border: 1px solid var(--dv-outline);
  border-radius: var(--dv-radius-md);
  background: var(--dv-surface);
  cursor: pointer;
  text-align: left;
  transition:
    border-color var(--dv-motion-fast) var(--dv-ease-standard),
    background-color var(--dv-motion-fast) var(--dv-ease-standard),
    opacity var(--dv-motion-fast) var(--dv-ease-standard);
}
.entry:disabled {
  opacity: 0.55;
  cursor: default;
}
.entry:not(:disabled):active {
  background: var(--dv-surface-alt);
}
.entry__body {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.entry__title {
  font-size: 14px;
  font-weight: 500;
  color: var(--dv-on-surface);
}
.entry__status {
  max-width: none;
  font-size: 12px;
  line-height: 1.4;
  color: var(--dv-on-surface-variant);
  text-align: left;
}
.entry__chevron {
  grid-column: 2;
  grid-row: 1 / 3;
  justify-self: center;
  color: var(--dv-on-surface-variant);
  font-size: 16px;
  line-height: 1;
}
.error {
  margin-top: var(--dv-space-xs);
  font-size: 12px;
  color: var(--dv-danger);
}
.preview__notice {
  font-size: 13px;
  color: var(--dv-on-surface-variant);
  margin-bottom: var(--dv-space-sm);
}
.preview__list {
  margin: 0;
}
.preview__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 0;
}
.preview__row + .preview__row {
  border-top: 1px solid var(--dv-surface-border);
}
.preview__row dt {
  font-size: 13px;
  color: var(--dv-on-surface-variant);
}
.preview__row dd {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--dv-on-surface);
}
</style>