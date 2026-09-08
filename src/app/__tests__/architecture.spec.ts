/**
 * 信息架构纠偏回归测试
 * ROUTE-*：路由结构；NAV-*：一级导航骨架；ARCH-*：旧首页归档。
 */
import { describe, it, expect } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia } from 'pinia';
import { createRouter, createMemoryHistory } from 'vue-router';

import App from '@/App.vue';
import { routes } from '@/app/router';
import { PRIMARY_NAV, PRIMARY_ROUTES } from '@/app/navigation';

function makeRouter() {
  return createRouter({ history: createMemoryHistory(), routes });
}

describe('架构纠偏：路由结构', () => {
  it('ROUTE-01 根路由 / 重定向到 /accounting', async () => {
    const router = makeRouter();
    // 配置检查：根路由配置 redirect 目标
    const root = router.getRoutes().find((r) => r.path === '/');
    expect(root?.redirect).toBe('/accounting');
    // 实际导航检查：访问 / 落到 /accounting
    await router.push('/');
    await router.isReady();
    expect(router.currentRoute.value.path).toBe('/accounting');
  });

  it('ROUTE-02 /home 路由不存在（无独立首页）', () => {
    const router = makeRouter();
    expect(router.getRoutes().some((r) => r.path === '/home')).toBe(false);
    expect(router.hasRoute('home')).toBe(false);
  });

  it('ROUTE-03 /statistics 存在', () => {
    const router = makeRouter();
    expect(router.hasRoute('statistics')).toBe(true);
    expect(router.getRoutes().some((r) => r.path === '/statistics')).toBe(true);
  });

  it('ROUTE-04 /accounting 存在', () => {
    const router = makeRouter();
    expect(router.hasRoute('accounting')).toBe(true);
    expect(router.getRoutes().some((r) => r.path === '/accounting')).toBe(true);
  });

  it('ROUTE-05 /daily-value 存在', () => {
    const router = makeRouter();
    expect(router.hasRoute('daily-value')).toBe(true);
    expect(router.getRoutes().some((r) => r.path === '/daily-value')).toBe(true);
  });
});

describe('架构纠偏：一级导航骨架', () => {
  it('NAV-01 正式一级导航只有 3 项', () => {
    expect(PRIMARY_NAV).toHaveLength(3);
    expect(PRIMARY_ROUTES).toHaveLength(3);
  });

  it('NAV-02 顺序为 统计 / 记账 / 日价', () => {
    expect(PRIMARY_NAV.map((n) => n.label)).toEqual(['统计', '记账', '日价']);
    expect(PRIMARY_NAV.map((n) => n.path)).toEqual([
      '/statistics',
      '/accounting',
      '/daily-value',
    ]);
  });

  it('NAV-03 默认 active 为记账（/ → /accounting 居中选中）', async () => {
    const router = makeRouter();
    router.push('/');
    await router.isReady();

    const wrapper = mount(App, {
      global: { plugins: [createPinia(), router] },
    });
    await flushPromises();

    expect(router.currentRoute.value.path).toBe('/accounting');
    const items = wrapper.findAll('.app-shell__nav-item');
    expect(items).toHaveLength(3);
    expect(items.map((i) => i.text())).toEqual(['统计', '记账', '日价']);
    // 记账居中且默认选中
    expect(items[1].text()).toBe('记账');
    expect(items[1].classes()).toContain('is-active');
  });
});

describe('架构纠偏：旧首页归档', () => {
  it('ARCH-01 HomePage.vue 已删除；/design 不计入正式一级导航', () => {
    // 源码中不存在任何 pages/home 下的页面文件
    const homeFiles = import.meta.glob('../../pages/home/*.vue');
    expect(Object.keys(homeFiles)).toHaveLength(0);
    // /home 与 /design 均不属于一级业务导航
    expect(PRIMARY_ROUTES.includes('/home')).toBe(false);
    expect(PRIMARY_ROUTES.includes('/design')).toBe(false);
  });
});

describe('架构纠偏：Design Demo 工具页', () => {
  it('ARCH-02 /design 是开发验收工具页，不属于 PRIMARY_NAV / PRIMARY_ROUTES，不计入正式一级业务页面', () => {
    // PRIMARY_NAV 中不存在 /design
    const navPaths = PRIMARY_NAV.map((item) => item.path as string);
    expect(navPaths.includes('/design')).toBe(false);
    // PRIMARY_ROUTES 中不存在 /design
    expect(PRIMARY_ROUTES.includes('/design')).toBe(false);
    // Router 中仍允许 /design 正常存在（开发验收工具页）
    const router = makeRouter();
    expect(router.hasRoute('design-demo')).toBe(true);
    expect(router.getRoutes().some((r) => r.path === '/design')).toBe(true);
  });
});
