<script setup lang="ts">
/**
 * Design System 演示页（Phase 1 验收用：所有 DV 组件独立运行 Demo）
 * 非业务页面；用于验证组件库与 Theme 切换结构。
 */
import { ref } from 'vue';
import {
  DVButton,
  DVCard,
  DVSheet,
  DVInput,
  DVPicker,
  toast,
} from '@/components/design';
import { useTheme } from '@/theme/useTheme';
import { useRouter } from 'vue-router';

const router = useRouter();
const { theme, resolvedTheme, switchTheme } = useTheme();

const sheetOpen = ref(false);
const textVal = ref('');
const amountVal = ref('');
const catVal = ref('c-food');
const dateVal = ref('');

const cats = [
  { label: '🍚 餐饮', value: 'c-food' },
  { label: '🚗 交通', value: 'c-transport' },
  { label: '🛍️ 购物', value: 'c-shopping' },
  { label: '🎮 娱乐', value: 'c-fun' },
  { label: '🏠 生活', value: 'c-life' },
];
</script>

<template>
  <div class="demo">
    <header class="demo__header">
      <h1>Design System Demo</h1>
      <p class="demo__sub">当前主题：{{ theme }}（生效：{{ resolvedTheme }}）</p>
      <div class="demo__row">
        <DVButton size="sm" variant="ghost" @click="switchTheme('auto')">auto</DVButton>
        <DVButton size="sm" variant="ghost" @click="switchTheme('light')">light</DVButton>
        <DVButton size="sm" variant="ghost" @click="switchTheme('dark')">dark</DVButton>
      </div>
      <div class="demo__row">
        <DVButton size="sm" variant="secondary" @click="router.push('/design/wallpaper-cropper')"
          >Wallpaper Cropper Demo →</DVButton
        >
      </div>
    </header>

    <!-- DVButton -->
    <DVCard outlined>
      <h2>DVButton</h2>
      <div class="demo__row">
        <DVButton>primary</DVButton>
        <DVButton variant="secondary">secondary</DVButton>
        <DVButton variant="danger">danger</DVButton>
        <DVButton variant="ghost">ghost</DVButton>
      </div>
      <div class="demo__row">
        <DVButton size="sm">sm</DVButton>
        <DVButton size="md">md</DVButton>
        <DVButton size="lg">lg</DVButton>
        <DVButton disabled>disabled</DVButton>
      </div>
      <DVButton block @click="toast.info('点击反馈正常')">block + toast</DVButton>
    </DVCard>

    <!-- DVCard -->
    <DVCard outlined elevation="md">
      <h2>DVCard（阴影 md）</h2>
      <p>统一背景 / 圆角 / 阴影。</p>
    </DVCard>
    <DVCard outlined frosted>
      <h2>DVCard（毛玻璃 frosted）</h2>
      <p>backdrop-filter 毛玻璃接口。</p>
    </DVCard>

    <!-- DVInput -->
    <DVCard outlined>
      <h2>DVInput</h2>
      <DVInput v-model="textVal" label="文字输入" placeholder="输入备注" />
      <div class="demo__gap" />
      <DVInput v-model="amountVal" mode="amount" label="金额输入（CNY）" placeholder="0.00" />
      <p class="demo__sub">金额={{ amountVal || '—' }} · 文字={{ textVal || '—' }}</p>
    </DVCard>

    <!-- DVPicker -->
    <DVCard outlined>
      <h2>DVPicker</h2>
      <DVPicker v-model="catVal" :options="cats" placeholder="选择分类" />
      <div class="demo__gap" />
      <DVPicker v-model="dateVal" type="date" placeholder="选择日期" />
      <p class="demo__sub">分类={{ catVal }} · 日期={{ dateVal || '—' }}</p>
    </DVCard>

    <!-- DVSheet -->
    <DVCard outlined>
      <h2>DVSheet</h2>
      <DVButton variant="secondary" @click="sheetOpen = true">打开 Sheet（可下拉关闭）</DVButton>
    </DVCard>

    <!-- DVToast -->
    <DVCard outlined>
      <h2>DVToast</h2>
      <div class="demo__row">
        <DVButton size="sm" variant="secondary" @click="toast.success('保存成功')">success</DVButton>
        <DVButton size="sm" variant="danger" @click="toast.error('保存失败')">error</DVButton>
        <DVButton size="sm" variant="ghost" @click="toast.info('提示信息')">info</DVButton>
      </div>
    </DVCard>

    <DVSheet v-model="sheetOpen" title="Sheet 演示">
      <p>这是一个底部 Sheet。</p>
      <p>· 上拉动画打开</p>
      <p>· 拖动顶部把手可下拉关闭</p>
      <p>· Android 返回键可关闭</p>
      <div class="demo__gap" />
      <DVButton block @click="sheetOpen = false">关闭</DVButton>
    </DVSheet>
  </div>
</template>

<style scoped>
.demo {
  padding: var(--dv-space-md);
  display: flex;
  flex-direction: column;
  gap: var(--dv-space-md);
}
.demo__header h1 {
  font-size: 22px;
}
.demo__sub {
  font-size: 12px;
  color: var(--dv-on-surface-variant);
  margin-top: var(--dv-space-xxs);
}
.demo__row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--dv-space-xs);
  margin-top: var(--dv-space-xs);
}
.demo__gap {
  height: var(--dv-space-sm);
}
h2 {
  font-size: 16px;
  margin-bottom: var(--dv-space-xs);
}
p {
  color: var(--dv-on-surface);
}
</style>
