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
import ReleaseNotesDialog from '@/components/release-notes/ReleaseNotesDialog.vue';
import { maybeAutoShowReleaseNotes, markReleaseNotesSeen } from '@/core/release-notes';
import { PRIMARY_NAV, PRIMARY_ROUTES } from '@/app/navigation';
import { usePrimaryPageSwipe } from '@/app/usePrimaryPageSwipe';
import { triggerPrimaryAction, type PrimaryAction } from '@/app/primary-action';
import { Search, Settings } from 'lucide-vue-next';

const route = useRoute();
const app = useAppStore();

// 2.15.1 Gate B 定死：AutoBill 永远不注册启动 Modal。
// 有待确认账单 → 只在记账页显示轻量入口；通知使用权只能由用户主动在
// 设置 → 自动记账 → 前往开启 进入。启动阶段唯一可能出现普通弹窗 = 更新日志。
// 2.16.2：AutoBill 实时同步由 main.ts 初始化的 AutoBill Runtime 负责（非本组件）。
const rnOpen = ref(false);

onMounted(() => {
  app.setTheme(app.theme);
  initBackHandler(() => PRIMARY_ROUTES.includes(route.path));
  window.setTimeout(() => {
    void maybeAutoShowReleaseNotes().then((show) => {
      if (show) rnOpen.value = true;
    });
  }, 1200);
});

/**
 * 2.14.0 技术债：Release Notes「已读」只写一次。
 * 同一次关闭（点「知道了」→ confirmed 与 update:modelValue(false) 可能同时触发）只落地一次，
 * 避免同一版本重复写 Settings/IDB。行为保持：升级首次显示、关闭后不再自动显示。
 */
let rnSeenHandled = false;
function closeReleaseNotes() {
  if (!rnSeenHandled) {
    rnSeenHandled = true;
    void markReleaseNotesSeen();
  }
  rnOpen.value = false;
}
watch(
  () => rnOpen.value,
  (open) => {
    if (open) rnSeenHandled = false; // 每次打开重置，仅在本次关闭时确保单写
  },
);

// 2.10.0：一级主页面左右滑动切换（2.10.2 重构为 Primary Pager 状态机：
// 手势挂业务内容区 app-shell__content，跟手动画只操作永久存在的 primary-page-stage；
// 手势语义见 usePrimaryPageSwipe，Tab 切换走 router.replace 不破坏双 Back 退出）
const contentRef = ref<HTMLElement | null>(null);
const pageStageRef = ref<HTMLElement | null>(null);
const { isAnimating } = usePrimaryPageSwipe({ contentRef, pageStageRef });

// 2.10.10 - Global Primary FAB：App 内全 DOM 只存在这一个「＋」。
// 状态完全由当前 route 决定（不再依赖 KeepAlive 生命周期 / ownsRoute）：
//   /accounting  → accounting-add（快速记账）
//   /daily-value → daily-value-add（添加日价物品）
//   其它路由     → 不显示
const primaryAction = computed<PrimaryAction | null>(() => {
  switch (route.path) {
    case '/accounting':
      return 'accounting-add';
    case '/daily-value':
      return 'daily-value-add';
    default:
      return null;
  }
});
const primaryFabLabel = computed(() =>
  primaryAction.value === 'daily-value-add' ? '添加日价物品' : '快速记账',
);
function onPrimaryFabClick() {
  // 2.14.0 技术债：pointerup 已触发后短窗抑制随后的 click（一次触摸只触发一次 action）
  if (Date.now() < suppressFabClickUntil) return;
  const action = primaryAction.value;
  if (!action) return;
  triggerPrimaryAction(action);
}
/**
 * pointerup 兜底（幂等，click 重复触发无副作用：sheetOpen=true 幂等）：
 * Chrome/WebView 对「快速 swipe 切页后 ~400-500ms 内的 click」会做 tap 仲裁并吞掉，
 * 而 pointer 事件即时派发不受影响。
 * 2.14.0：pointerup 作为触摸正式触发路径；其后短窗（400ms）抑制 click，避免一次点击双触发。
 * 键盘（Enter/Space）产生的 click 无 pointerup → 仍正常触发；测试工具合成 click 同理。
 * 注意：不在此处判断 isAnimating —— 动画中 pointer-events:none 已由 .is-locked 阻断。
 */
let suppressFabClickUntil = 0;
function onPrimaryFabPointerUp(e: PointerEvent) {
  if (e.button !== 0) return;
  // 2.14.0：pointerup 是本次触摸的正式触发路径，立即执行 action；
  // 之后设置 400ms 短窗只用于吞掉浏览器 tap 仲裁产生的重复 click。
  // （必须「先触发、后设窗」——否则抑制窗口会把 pointerup 自己的调用也吞掉）
  const action = primaryAction.value;
  if (action) triggerPrimaryAction(action);
  suppressFabClickUntil = Date.now() + 400;
}

// 2.9.9 Back 语义：统计/记账/日价是平级 Tab（PRIMARY_ROUTES），
// 在这三个一级页面上按 Back 不 history.back()，走「双 Back 退出」（back-handler）。
// Design System 不硬编码业务路由，由 App 层传入一级页面谓词。

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
      <!-- 2.21.1：全局搜索入口（三个一级页面都显示；二级页面隐藏）。
           是入口 Button 而非输入框：点击 → /bill-search 后在 BillSearchPage 输入。 -->
      <div class="app-shell__actions">
        <router-link to="/bill-search" class="app-shell__search-entry" aria-label="搜索账单">
          <Search :size="16" aria-hidden="true" />
          <span>搜索账单</span>
        </router-link>
        <router-link to="/settings" class="app-shell__settings" aria-label="设置">
          <Settings :size="18" aria-hidden="true" />
        </router-link>
      </div>
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
    <!-- 2.10.10 - 全局唯一 Primary FAB：
         位于 primary-page-stage / app-shell__content 之外（不随页面滑动/动画 transform 移动），
         Teleport 到 body 恒定相对视口固定；可见性与 action 完全由 route 决定。
         isAnimating（Swipe 切页动画中）时 pointer-events 关闭，动画结束立即恢复——
         不人为延迟 300/500ms，视觉切页完成后第一次点击立即生效。 -->
    <Teleport to="body">
      <button
        v-if="primaryAction"
        class="global-primary-fab"
        :class="{ 'is-locked': isAnimating }"
        type="button"
        :aria-label="primaryFabLabel"
        @pointerup="onPrimaryFabPointerUp"
        @click="onPrimaryFabClick"
      >
        ＋
      </button>
    </Teleport>
    <DVToast />
    <!-- 2.10.8：版本更新日志（自动弹窗/设置入口共用；点「知道了」或主动关闭都记录已读版本）。
     2.15.1：启动阶段唯一可能出现的普通弹窗（AutoBill 不注册启动 Modal）。 -->
    <ReleaseNotesDialog
      v-model="rnOpen"
      @confirmed="closeReleaseNotes"
      @update:model-value="(v: boolean) => { if (!v) closeReleaseNotes(); }"
    />
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
  white-space: nowrap;
  flex: none;
}
/* 2.21.1：Header 全局工具区（搜索入口 + 设置）；搜索栏保持轻透明 surface，
   不叠加 backdrop-filter（Header 已有 blur(14px)，再叠会显得更糊）。 */
.app-shell__actions {
  display: flex;
  align-items: center;
  gap: var(--dv-space-sm);
  flex: none;
}
.app-shell__search-entry {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 32px;
  width: clamp(92px, 28vw, 118px);
  padding: 0 12px;
  border-radius: var(--dv-radius-pill);
  background: var(--dv-surface-alt);
  color: var(--dv-on-surface-variant);
  font-size: 13px;
  white-space: nowrap;
  text-decoration: none;
  transition:
    background-color var(--dv-motion-fast) var(--dv-ease-standard),
    color var(--dv-motion-fast) var(--dv-ease-standard);
}
.app-shell__search-entry:active {
  background: var(--dv-surface-strong);
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
/* 2.10.10 - 全局唯一 Primary FAB（由 .accounting__fab / .dv__fab 两套收口为一份）。
   圆角方形（非纯圆/胶囊），Teleport 到 body 恒相对视口固定。 */
.global-primary-fab {
  position: fixed;
  right: var(--dv-space-lg);
  bottom: calc(var(--dv-space-lg) + var(--dv-safe-bottom));
  width: 56px;
  height: 56px;
  border: none;
  border-radius: var(--dv-radius-md);
  background: var(--dv-primary);
  color: var(--dv-on-primary);
  font-size: 30px;
  font-weight: 500;
  line-height: 1;
  box-shadow: 0 4px 12px color-mix(in srgb, var(--dv-primary) 32%, transparent);
  z-index: var(--dv-z-sticky);
  transition: transform var(--dv-motion-fast) var(--dv-ease-standard);
}
.global-primary-fab:active {
  transform: scale(0.92);
}
/* Swipe 切页动画中：停用点击，动画结束（isAnimating=false）立即恢复，不做人为延迟 */
.global-primary-fab.is-locked {
  pointer-events: none;
}
</style>
