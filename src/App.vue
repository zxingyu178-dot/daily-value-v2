<script setup lang="ts">
/**
 * App 根组件：路由视图 + 一级 Primary Navigation 骨架（统计 / 记账 / 日价）
 *
 * 架构纠偏：正式产品信息架构只有三个一级业务页面（统计/记账/日价），
 * 记账为 App 默认首页（根路由 → /accounting，默认选中）。
 * 本骨架使用顶部简单三项导航，不做最终动画/手势；复杂视觉与横向滑动交互在 Phase 3「记账主界面」实现。
 *
 * 安全区：顶部导航使用统一变量 --dv-safe-top（原生桥注入，Phase 7A-Fix3），不硬编码状态栏高度。
 * DVToast：在根层全局挂载，业务页面调用 toast 服务即可全局显示。
 */
import { useRoute } from 'vue-router';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useAppStore } from '@/core/store/app';
import { initBackHandler, resetExitArmed } from '@/components/design/back-handler';
import { DVToast } from '@/components/design';
import { PRIMARY_NAV, PRIMARY_ROUTES } from '@/app/navigation';
import { usePrimaryPageSwipe } from '@/app/usePrimaryPageSwipe';

const route = useRoute();
const app = useAppStore();

// 2.10.0：一级主页面左右滑动切换（2.10.2 重构为 Primary Pager 状态机：
// 手势挂业务内容区 app-shell__content，跟手动画只操作永久存在的 primary-page-stage；
// 手势语义见 usePrimaryPageSwipe，Tab 切换走 router.replace 不破坏双 Back 退出）
const contentRef = ref<HTMLElement | null>(null);
const pageStageRef = ref<HTMLElement | null>(null);
usePrimaryPageSwipe({ contentRef, pageStageRef });

// 2.9.9 Back 语义：统计/记账/日价是平级 Tab（PRIMARY_ROUTES），
// 在这三个一级页面上按 Back 不 history.back()，走「双 Back 退出」（back-handler）。
// Design System 不硬编码业务路由，由 App 层传入一级页面谓词。
onMounted(() => {
  app.setTheme(app.theme);
  initBackHandler(() => PRIMARY_ROUTES.includes(route.path));
});

// 路由变化（含一级 Tab replace 切换 / 进入设置等）：立即清除退出 armed 状态，
// 避免「提示 → 切 Tab → 再 Back 直接退出」。
watch(
  () => route.path,
  () => resetExitArmed(),
);

onBeforeUnmount(() => {
  void resetExitArmed();
});

// 仅在一级业务页面显示导航（/settings、/design 不显示）
const showNav = computed(() => PRIMARY_NAV.some((item) => item.path === route.path));
</script>

<template>
  <div class="app-wrap">
    <!-- 全局壁纸层（z-index:0，位于所有内容之下；pointer-events:none 不拦截交互） -->
    <div class="wallpaper-layer" aria-hidden="true"></div>
  <div class="app-shell">
    <header v-if="showNav" class="app-shell__header">
      <span class="app-shell__brand">每日的价值</span>
      <router-link to="/settings" class="app-shell__settings" aria-label="设置">
        <span class="app-shell__settings-icon" aria-hidden="true">⚙</span>
      </router-link>
    </header>
    <nav v-if="showNav" class="app-shell__nav">
      <!-- 2.9.9 Back 语义 P0：三大一级页面是平级 Tab，Tab 切换用 replace（不进 History），
           否则 Android 右滑 Back 会退回上一个 Tab。设置/壁纸/周期等真实层级页面仍 push。 -->
      <router-link
        v-for="item in PRIMARY_NAV"
        :key="item.path"
        :to="item.path"
        replace
        class="app-shell__nav-item"
        :class="{ 'is-active': route.path === item.path }"
      >
        {{ item.label }}
      </router-link>
    </nav>
    <!-- 2.10.2：一级页面动画舞台。primary-page-stage 永久存在，路由只替换内部组件；
         跟手拖页/退场/入场动画只操作本元素（transform/opacity），
         不重新给 RouterView 套 Transition（避免 2.9.6 P0 整页空白回归），
         Header/Nav 固定不动（真正 Tab Pager 语义）。 -->
    <main ref="contentRef" class="app-shell__content dv-primary-scroll-surface">
      <div ref="pageStageRef" class="primary-page-stage">
        <router-view v-slot="{ Component }">
          <KeepAlive :include="['AccountingPage', 'StatisticsPage', 'DailyValuePage']">
            <component :is="Component" />
          </KeepAlive>
        </router-view>
      </div>
    </main>
    <DVToast />
  </div>
  </div>
</template>

<style scoped>
.app-wrap {
  position: relative;
  height: 100%;
}
.app-shell {
  display: flex;
  flex-direction: column;
  height: 100%;
  position: relative;
  z-index: 1;
}
.app-shell__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  /* 顶部安全区：Android 状态栏 / 刘海；统一由 --dv-safe-top 决定（不硬编码状态栏高度） */
  padding: calc(var(--dv-space-sm) + var(--dv-safe-top)) var(--dv-space-md) var(--dv-space-xs);
  background: var(--dv-header-bg);
  /* 轻量毛玻璃：仅 Header（单个元素，成本低）。无壁纸时 header-bg 为不透明 surface，无可见副作用。
     不在大量列表项/卡片上使用 backdrop-filter，避免 WebView 滚动漫帧。 */
  -webkit-backdrop-filter: blur(14px) saturate(130%);
  backdrop-filter: blur(14px) saturate(130%);
}
.app-shell__brand {
  font-size: 17px;
  font-weight: 600;
  color: var(--dv-on-surface);
}
.app-shell__settings {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: var(--dv-radius-pill);
  color: var(--dv-on-surface-variant);
  text-decoration: none;
  transition:
    background-color var(--dv-motion-fast) var(--dv-ease-standard),
    color var(--dv-motion-fast) var(--dv-ease-standard);
}
.app-shell__settings:active {
  background: var(--dv-surface-alt);
  color: var(--dv-on-surface);
}
.app-shell__settings-icon {
  font-size: 18px;
  line-height: 1;
}
.app-shell__nav {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: var(--dv-space-lg);
  /* 普通间距：顶部 Safe Area 已由 Header 消费一次，这里不再叠加 */
  padding: var(--dv-space-sm) 0;
  border-bottom: 1px solid var(--dv-surface-border);
  background: var(--dv-header-bg);
}
.app-shell__nav-item {
  position: relative;
  padding: var(--dv-space-xxs) var(--dv-space-sm);
  font-size: 15px;
  color: var(--dv-on-surface-variant);
  text-decoration: none;
  transition: color var(--dv-motion-fast) var(--dv-ease-standard);
}
/* 选中反馈（2.9.4 Polish）：在既有「文字变主色 + 加粗」基础上，仅加一条 2px 极短下划线。
   克制、不堆叠；宽度过渡走 fast token，不引入第二套时长。 */
.app-shell__nav-item::after {
  content: '';
  position: absolute;
  left: 50%;
  bottom: 0;
  width: 0;
  height: 2px;
  border-radius: 2px;
  background: var(--dv-primary);
  opacity: 0;
  transform: translateX(-50%);
  transition:
    width var(--dv-motion-fast) var(--dv-ease-standard),
    opacity var(--dv-motion-fast) var(--dv-ease-standard);
}
.app-shell__nav-item.is-active {
  color: var(--dv-primary);
  font-weight: 600;
}
.app-shell__nav-item.is-active::after {
  width: 16px;
  opacity: 1;
}
.app-shell__content {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  /* 2.10.1 Swipe Hotfix + 2.10.2 Primary Pager：
     touch-action/overscroll-behavior-x 统一收敛到全局类 .dv-primary-scroll-surface
     （见 src/theme/base.css）——touch-action 不继承，所有一级页面主内容滚动容器
     （.app-shell__content / .accounting__timeline）都必须带该类，才不会被 Android
     WebView 接管横向 pan 抛 pointercancel。 */
}
/* 2.10.2：一级页面动画舞台（永久存在，路由只替换内部组件）。
   跟手拖页 / 退场 / 入场动画只操作本元素；Height 100% 撑满内容区，
   will-change 提前告知合成器，避免拖动时整页布局抖动。 */
.primary-page-stage {
  height: 100%;
  min-height: 0;
  will-change: transform, opacity;
}
</style>
