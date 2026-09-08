/**
 * Daily Value v2 - 路由定义
 * 一级业务页面：统计 / 记账 / 日价；记账为 App 默认首页（根路由 → /accounting）。
 * /settings 独立页（右上角菜单进入）；/design 为开发验收工具页（非业务页面）。
 */
import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';

export const routes: RouteRecordRaw[] = [
  {
    path: '/',
    redirect: '/accounting',
  },
  {
    path: '/accounting',
    name: 'accounting',
    component: () => import('@/pages/accounting/AccountingPage.vue'),
    meta: { title: '记账' },
  },
  {
    path: '/statistics',
    name: 'statistics',
    component: () => import('@/pages/statistics/StatisticsPage.vue'),
    meta: { title: '统计' },
  },
  {
    path: '/daily-value',
    name: 'daily-value',
    component: () => import('@/pages/daily-value/DailyValuePage.vue'),
    meta: { title: '日价' },
  },
  {
    path: '/settings',
    name: 'settings',
    component: () => import('@/pages/settings/SettingsPage.vue'),
    meta: { title: '设置' },
  },
  {
    // 独立壁纸设置页（设置主页「壁纸设置」入口进入；Back 返回设置）
    path: '/settings/wallpaper',
    name: 'wallpaper-settings',
    component: () => import('@/pages/settings/WallpaperSettingsPage.vue'),
    meta: { title: '壁纸设置' },
  },
  {
    // 周期记账页（设置主页「周期记账」入口进入；Back 返回设置）
    path: '/settings/recurring',
    name: 'recurring',
    component: () => import('@/pages/settings/RecurringPage.vue'),
    meta: { title: '周期记账' },
  },
  {
    // Design System 演示页（Phase 1 验收用，非业务页面）
    path: '/design',
    name: 'design-demo',
    component: () => import('@/pages/design/DesignDemoPage.vue'),
    meta: { title: 'Design Demo' },
  },
  {
    // Wallpaper Cropper 技术验证 Demo（非业务页面；验收后接入正式 Settings）
    path: '/design/wallpaper-cropper',
    name: 'wallpaper-cropper-demo',
    component: () => import('@/pages/design/WallpaperCropperDemo.vue'),
    meta: { title: 'Wallpaper Cropper Demo' },
  },
];

export const router = createRouter({
  history: createWebHistory(),
  routes,
});
