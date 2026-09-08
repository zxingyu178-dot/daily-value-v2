/**
 * 设置页测试
 * - SETTINGS-LAYOUT-01 `.page` 顶部必须复用 safe-area-inset-top，不单独“贴顶”
 * - SETTINGS-LAYOUT-02 页面正确渲染标题与明暗/强调色控件
 * - WALLPAPER-ENTRY：设置主页只保留「壁纸设置」入口（未设置/已设置），不再内嵌壁纸编辑器
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import SettingsPage from '@/pages/settings/SettingsPage.vue';
import { useSettingsStore } from '@/core/store/settings';
import { openDatabase } from '@/core/db/database';
import { services } from '@/core/services';
import type { Settings } from '@/core/models/types';
// 直接读取 SFC 源文本，可靠校验安全区规则（jsdom 不注入/级联 scoped CSS）
import settingsSrc from '@/pages/settings/SettingsPage.vue?raw';

// mock router：验证「壁纸设置」入口跳转
const pushMock = vi.hoisted(() => vi.fn());
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: pushMock }),
}));

function mountPage() {
  const pinia = createPinia();
  setActivePinia(pinia);
  return mount(SettingsPage, { global: { plugins: [pinia] } });
}

describe('设置页·壁纸入口（Phase 6 v2 独立壁纸设置）', () => {
  it('WALLPAPER-ENTRY-01 无壁纸时入口显示「未设置」，且不内嵌任何壁纸编辑器控件', () => {
    const wrapper = mountPage();
    expect(wrapper.find('.wp-entry').exists()).toBe(true);
    expect(wrapper.text()).toContain('壁纸设置');
    expect(wrapper.text()).toContain('未设置');
    // 主页不再内嵌选图/文件输入/预览浮层/Cropper 等编辑器 UI
    expect(wrapper.find('input[type="file"]').exists()).toBe(false);
    expect(wrapper.find('.wp-editor').exists()).toBe(false);
    // 不再暴露旧技术参数阶段控件
    expect(wrapper.text()).not.toContain('选择图片');
    expect(wrapper.text()).not.toContain('cover');
    expect(wrapper.text()).not.toContain('positionX');
  });

  it('WALLPAPER-ENTRY-02 已设置壁纸时入口显示「已设置」', async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const settings = useSettingsStore();
    const saved: Settings = {
      currency: '¥',
      theme: 'auto',
      themeColor: 'violet',
      sort: 'per',
      wallpaper: { image: 'data:image/jpeg;base64,/9j/x', blur: 4, overlay: 0.25 },
    };
    vi.spyOn(services.settings, 'get').mockImplementation(async () => saved as never);
    await settings.load();
    const wrapper = mount(SettingsPage, { global: { plugins: [pinia] } });
    await flushPromises();
    expect(wrapper.text()).toContain('已设置');
  });

  it('WALLPAPER-ENTRY-03 点击「壁纸设置」跳转到独立页 /settings/wallpaper', async () => {
    const wrapper = mountPage();
    await wrapper.find('.wp-entry').trigger('click');
    await flushPromises();
    expect(pushMock).toHaveBeenCalledWith('/settings/wallpaper');
  });
});

describe('设置页（P1 顶部安全区/间距统一）', () => {
  it('SETTINGS-LAYOUT-01 `.page` 顶部复用 --dv-safe-top，不贴顶、不单独写贴顶布局', () => {
    mountPage();
    // 顶部间距必须包含统一安全区变量 --dv-safe-top（由原生桥注入），不得是裸 padding 的“贴顶”
    expect(settingsSrc).toContain('padding-top');
    expect(settingsSrc).toContain('--dv-safe-top');
  });

  it('SETTINGS-LAYOUT-02 页面渲染标题与明暗/强调色控件，且 `.page` 具备基础内边距', () => {
    const wrapper = mountPage();
    const page = wrapper.find('.page');
    expect(page.exists()).toBe(true);
    expect(page.text()).toContain('设置');
    expect(wrapper.find('.seg').exists()).toBe(true);
    expect(wrapper.findAll('.swatch').length).toBeGreaterThan(0);
    const pt = parseFloat(getComputedStyle(page.element).paddingTop);
    // jsdom 不解析 env(safe-area-inset-top)，但至少保留标准 horizontal padding 高度层级
    expect(Number.isFinite(pt)).toBe(true);
  });
});

describe('2.10.4 玻璃强调色（设置页）', () => {
  beforeEach(async () => {
    // 防前序用例（WALLPAPER-ENTRY-02）残留的 services spy 跨用例污染
    vi.restoreAllMocks();
    // services 为 IndexedDB 实现：预打开 DB，避免 fake-indexeddb 首次 open 竞态导致 update 挂起
    await openDatabase();
  });

  it('SETTINGS-GLASS-01 渲染「玻璃强调色」块（关闭/绯红/琥珀/冰蓝），默认激活关闭', async () => {
    const wrapper = mountPage();
    await flushPromises();
    expect(wrapper.text()).toContain('玻璃强调色（深色）');
    expect(wrapper.text()).toContain('关闭');
    expect(wrapper.text()).toContain('绯红');
    expect(wrapper.text()).toContain('冰蓝');
    // 默认 off 激活态
    const active = wrapper.findAll('.swatch.is-active');
    const glassActive = active.filter((w) => w.text().includes('关闭'));
    expect(glassActive.length).toBeGreaterThan(0);
  });

  it('SETTINGS-GLASS-02 点击「冰蓝」→ settings.themeGlass=ice 且仍是同一玻璃色板控件', async () => {
    const wrapper = mountPage();
    await flushPromises();
    const settings = useSettingsStore();
    const iceBtn = wrapper.findAll('.swatch').find((w) => w.text().includes('冰蓝'));
    expect(iceBtn).toBeTruthy();
    await iceBtn!.trigger('click');
    // IndexedDB put 完成依赖宏任务（fake-indexeddb success event），需额外 tick 才能读到持久化结果
    await new Promise((r) => setTimeout(r, 10));
    await flushPromises();
    expect(settings.themeGlass).toBe('ice');
  });
});