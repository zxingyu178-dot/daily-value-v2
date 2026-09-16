<script setup lang="ts">
/**
 * 2.17.0 AutoBill SettingsPanel（AutoBillPage 内嵌；来源 UI 由 Source Registry 生成）
 * - 通知使用权：整行可点进入系统「通知使用权」（已授权/未授权/等待系统连接 + 重新连接）
 * - 自动识别来源：分组渲染 —— 支付平台（支付宝/微信支付 开关，来源定义来自 Registry，
 *   未安装来源灰显「未安装」不报错）；银行卡（无真实支持时仅展示扩展说明，不显示假开关）
 * - 实时状态来自 AutoBillStore（Runtime 同步后自动刷新）
 */
import { computed, onMounted, ref } from 'vue';
import { DVCard, toast } from '@/components/design';
import { useSettingsStore } from '@/core/store/settings';
import { useAutoBillStore } from '@/core/store/autobill';
import {
  openNotificationAccessSettings,
  requestAutoBillRebind,
  syncEnabledPackagesToNative,
  queryInstalledSources,
  isNativeCapacityAvailable,
} from '@/feature/autobill/service/notification-bridge';
import {
  AUTOBILL_SOURCES,
  resolveEnabledSources,
  packagesForSourceIds,
  type AutoBillSourceDefinition,
} from '@/feature/autobill/source-registry';

defineOptions({ name: 'AutoBillSettingsPanel' });

const settingsStore = useSettingsStore();
const ab = useAutoBillStore();

const autoBillEnabled = computed(() => Boolean(settingsStore.settings?.autoBillEnabled));
/** 2.17.0：开启来源 id 集合（Registry 解析，兼容旧字段） */
const enabledIds = computed(() =>
  resolveEnabledSources(
    settingsStore.settings?.autoBillEnabledSources,
    settingsStore.settings?.autoBillAllowedApps,
  ),
);

/** 支付平台（钱包）与银行卡分组（Registry 自动生成，不再硬编码 ALL_APPS） */
const walletSources = computed(() => AUTOBILL_SOURCES.filter((s) => s.group === 'wallet'));
const bankSources = computed(() => AUTOBILL_SOURCES.filter((s) => s.group === 'bank'));
/** 银行卡分组中是否有真实支持项（无 → 只显示扩展说明，不显示假开关） */
const hasSupportedBank = computed(() => bankSources.value.some((s) => s.supported));

/** 安装状态（packageName → installed）；查询失败/未知 = 空对象（视为已安装，不误伤） */
const installedMap = ref<Record<string, boolean>>({});

function installedOf(def: AutoBillSourceDefinition): boolean {
  if (!def || def.packageNames.length === 0) return true; // 无包名（未确认）不判未安装
  return def.packageNames.every((p) => installedMap.value[p] !== false);
}

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
  // 2.17.0：查询支持来源安装状态（未安装灰显，不干扰开关）
  const pkgs = packagesForSourceIds(AUTOBILL_SOURCES.filter((s) => s.supported).map((s) => s.id));
  if (pkgs.length > 0) {
    installedMap.value = await queryInstalledSources(pkgs);
  }
}

async function toggleEnabled() {
  await settingsStore.update({ autoBillEnabled: !autoBillEnabled.value });
  await syncEnabledPackagesToNative();
  await ab.refreshStatus();
  if (autoBillEnabled.value && !isNativeCapacityAvailable()) {
    toast.info('当前设备不支持通知使用权');
  }
}

/** 2.17.0：切换来源（id 为键，来源定义来自 Registry；关闭后 Native 包同步移除） */
async function toggleSource(def: AutoBillSourceDefinition) {
  const cur = new Set(enabledIds.value);
  if (cur.has(def.id)) cur.delete(def.id);
  else cur.add(def.id);
  await settingsStore.update({ autoBillEnabledSources: [...cur] });
  await syncEnabledPackagesToNative();
  await settingsStore.load(true);
  void ab.refreshStatus();
}

/** 2.16.4 P3：整行可点进入系统「通知使用权」（返回 App 后由 Runtime/refreshStatus 自动刷新）。
 *  2.16.7：只调用 Native Plugin，绝不触发路由跳转；失败仅 toast 提示，页面保持不动。 */
async function goOpenAccess() {
  const ok = await openNotificationAccessSettings();
  if (!ok) toast.info('无法打开系统设置，请手动进入系统的「通知使用权」');
}

async function rebind() {
  const ok = await requestAutoBillRebind();
  toast.info(ok ? '已请求重新连接' : '重新连接失败');
  await ab.refreshStatus();
}

onMounted(() => {
  void refreshSettings();
});

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

    <!-- 2.17.0：自动识别来源 —— 由 Source Registry 分组渲染，不再硬编码 ALL_APPS -->
    <DVCard outlined class="block">
      <p class="block__label">自动识别来源</p>

      <p v-if="walletSources.length > 0" class="group-label">支付平台</p>
      <div v-for="def in walletSources" :key="def.id" class="block__row">
        <div>
          <p class="block__title" :class="{ 'is-dim': !installedOf(def) }">{{ def.label }}</p>
          <p v-if="!installedOf(def)" class="block__desc">未安装</p>
        </div>
        <button
          class="switch"
          type="button"
          :class="{ 'is-on': enabledIds.includes(def.id) }"
          :aria-pressed="enabledIds.includes(def.id)"
          :disabled="!installedOf(def)"
          :aria-label="`${def.label} ${enabledIds.includes(def.id) ? '开' : '关'}`"
          @click="toggleSource(def)"
        >
          <span class="switch__knob"></span>
        </button>
      </div>

      <!-- 银行卡：无真实支持 → 不展示假开关，只说明扩展中 -->
      <template v-if="bankSources.length > 0">
        <p class="group-label">银行卡</p>
        <template v-if="hasSupportedBank">
          <div v-for="def in bankSources" :key="def.id" class="block__row">
            <p class="block__title">{{ def.label }}</p>
            <button
              class="switch"
              type="button"
              :class="{ 'is-on': enabledIds.includes(def.id) }"
              :aria-pressed="enabledIds.includes(def.id)"
              :disabled="!installedOf(def)"
              @click="toggleSource(def)"
            >
              <span class="switch__knob"></span>
            </button>
          </div>
        </template>
        <p v-else class="block__desc">银行卡支持正在扩展</p>
      </template>
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
.group-label {
  margin: var(--dv-space-xs) 0 0;
  font-size: 12px;
  font-weight: 500;
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
.switch:disabled {
  opacity: 0.45;
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