<script setup lang="ts">
/**
 * 2.16.4 AutoBill SettingsPanel（AutoBillPage 内嵌，不再是独立路由）
 * - 通知使用权：整行可点进入系统「通知使用权」（已授权/未授权/等待系统连接 + 重新连接）
 * - 自动识别来源开关（同步原生白名单）
 * - 银行卡通知占位（框架预留）
 * - 实时状态来自 AutoBillStore（AutoBill Runtime 同步后自动刷新，无页面自带 listener）
 */
import { computed } from 'vue';
import { DVCard, toast } from '@/components/design';
import { useSettingsStore } from '@/core/store/settings';
import { useAutoBillStore } from '@/core/store/autobill';
import {
  openNotificationAccessSettings,
  requestAutoBillRebind,
  syncEnabledPackagesToNative,
  isNativeCapacityAvailable,
} from '@/feature/autobill/service/notification-bridge';

defineOptions({ name: 'AutoBillSettingsPanel' });

const settingsStore = useSettingsStore();
const ab = useAutoBillStore();

const ALL_APPS = ['支付宝', '微信支付'];

const autoBillEnabled = computed(() => Boolean(settingsStore.settings?.autoBillEnabled));
const allowedApps = computed(() => settingsStore.settings?.autoBillAllowedApps ?? ALL_APPS);

/** 通知使用权展示文案 */
const accessText = computed(() => {
  if (!autoBillEnabled.value) return '未开启（开启自动记账后生效）';
  if (!ab.accessStatus.granted) return '未授权';
  if (!ab.accessStatus.connected) return '已授权 · 等待系统连接';
  return '已授权 · 监听正常';
});

async function refreshSettings() {
  await settingsStore.load(true);
  await syncEnabledPackagesToNative();
  await ab.refreshStatus();
}

async function toggleEnabled() {
  await settingsStore.update({ autoBillEnabled: !autoBillEnabled.value });
  await syncEnabledPackagesToNative();
  await ab.refreshStatus();
  if (autoBillEnabled.value && !isNativeCapacityAvailable()) {
    toast.info('当前设备不支持通知使用权');
  }
}

async function toggleApp(app: string) {
  const cur = new Set(allowedApps.value);
  if (cur.has(app)) cur.delete(app);
  else cur.add(app);
  await settingsStore.update({ autoBillAllowedApps: [...cur] });
  await syncEnabledPackagesToNative();
  await settingsStore.load(true);
}

/** 2.16.4 P3：整行可点进入系统「通知使用权」（返回 App 后由 Runtime/refreshStatus 自动刷新） */
async function goOpenAccess() {
  const ok = await openNotificationAccessSettings();
  if (!ok) toast.info('无法打开系统设置，请在系统「通知使用权」中手动授权');
}

async function rebind() {
  const ok = await requestAutoBillRebind();
  toast.info(ok ? '已请求重新连接' : '重新连接失败');
  await ab.refreshStatus();
}

defineExpose({ refreshSettings });
</script>

<template>
  <div class="panel">
    <DVCard outlined class="block">
      <div class="block__row">
        <div>
          <p class="block__title">自动记账</p>
          <p class="block__desc">读取支付通知，生成待确认账单，你确认后记入账本</p>
        </div>
        <button
          class="switch"
          type="button"
          :class="{ 'is-on': autoBillEnabled }"
          :aria-pressed="autoBillEnabled"
          :aria-label="autoBillEnabled ? '关闭自动记账' : '开启自动记账'"
          @click="toggleEnabled"
        >
          <span class="switch__knob"></span>
        </button>
      </div>
    </DVCard>

    <!-- 2.16.4 P3：整行可点进入系统通知使用权 -->
    <DVCard outlined class="block">
      <p class="block__label">通知使用权</p>
      <button class="access-row" type="button" @click="goOpenAccess">
        <span class="block__title" :class="{ 'is-dim': !autoBillEnabled }">{{ accessText }}</span>
        <span class="access-row__chevron" aria-hidden="true">›</span>
      </button>
      <div class="block__row">
        <p class="block__desc">
          在系统「通知使用权」中授权「每日的价值」（不是「允许通知」）
        </p>
        <button v-if="autoBillEnabled && ab.accessStatus.granted && !ab.accessStatus.connected" class="mini" type="button" @click="rebind">
          重新连接
        </button>
      </div>
    </DVCard>

    <DVCard outlined class="block">
      <p class="block__label">自动识别来源</p>
      <div v-for="app in ALL_APPS" :key="app" class="block__row">
        <p class="block__title">{{ app }}</p>
        <button
          class="switch"
          type="button"
          :class="{ 'is-on': allowedApps.includes(app) }"
          :aria-pressed="allowedApps.includes(app)"
          :aria-label="`${app} ${allowedApps.includes(app) ? '开' : '关'}`"
          @click="toggleApp(app)"
        >
          <span class="switch__knob"></span>
        </button>
      </div>
    </DVCard>

    <DVCard outlined class="block">
      <p class="block__label">银行卡通知</p>
      <div class="block__row">
        <div>
          <p class="block__title">招商银行</p>
          <p class="block__desc">未启用 · 后续版本支持</p>
        </div>
        <button class="mini" type="button" disabled>未启用</button>
      </div>
    </DVCard>
  </div>
</template>

<style scoped>
.panel {
  display: flex;
  flex-direction: column;
  gap: var(--dv-space-sm);
}
.block {
  padding: var(--dv-space-md);
}
.block__label {
  margin: 0 0 var(--dv-space-xs);
  font-size: 12px;
  color: var(--dv-on-surface-dim, inherit);
}
.block__row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--dv-space-sm);
  padding: 4px 0;
  min-height: 44px; /* 2.16.3：移动端点击区域统一 ≥44 */
}
.block__title {
  margin: 0;
  font-size: 15px;
  font-weight: 500;
}
.block__title.is-dim {
  color: var(--dv-on-surface-dim, inherit);
}
.block__desc {
  margin: 2px 0 0;
  font-size: 12px;
  line-height: 1.4;
  color: var(--dv-on-surface-dim, inherit);
}
.access-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
  min-height: 44px;
  padding: 0 2px;
  background: none;
  border: none;
  color: var(--dv-on-surface);
  text-align: left;
}
.access-row__chevron {
  font-size: 18px;
  color: var(--dv-on-surface-dim, inherit);
}
.switch {
  position: relative;
  width: 44px;
  height: 26px;
  border-radius: 999px;
  border: none;
  background: var(--dv-outline, rgba(128, 128, 128, 0.35));
  transition: background 0.2s;
  flex: none;
}
.switch.is-on {
  background: var(--dv-primary);
}
.switch__knob {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: #fff;
  transition: left 0.2s;
}
.switch.is-on .switch__knob {
  left: 21px;
}
.mini {
  border: 1px solid var(--dv-outline, rgba(128, 128, 128, 0.3));
  border-radius: 999px;
  background: none;
  color: var(--dv-primary);
  font-size: 13px;
  padding: 8px 16px;
  min-height: 40px;
  flex: none;
}
</style>