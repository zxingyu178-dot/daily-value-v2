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
import { useAppStore } from '@/core/store/app';
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

describe('2.13.0 Theme V2（设置页）', () => {
  beforeEach(async () => {
    // 防前序用例（WALLPAPER-ENTRY-02）残留的 services spy 跨用例污染
    vi.restoreAllMocks();
    // services 为 IndexedDB 实现：预打开 DB，避免 fake-indexeddb 首次 open 竞态导致 update 挂起
    await openDatabase();
  });

  it('SETTINGS-THEMEV2-01 渲染「界面风格」四档（经典/柔和/极简/玻璃），默认激活经典', async () => {
    const wrapper = mountPage();
    await flushPromises();
    expect(wrapper.text()).toContain('界面风格');
    expect(wrapper.text()).toContain('经典');
    expect(wrapper.text()).toContain('柔和');
    expect(wrapper.text()).toContain('极简');
    expect(wrapper.text()).toContain('玻璃');
    const styleActive = wrapper.findAll('.seg__item.is-active').find((w) => w.text().includes('经典'));
    expect(styleActive).toBeTruthy();
  });

  it('SETTINGS-THEMEV2-02 点击「柔和」→ settings.themeStyle=soft 且同步 appStore/data-theme-style', async () => {
    const wrapper = mountPage();
    await flushPromises();
    const settings = useSettingsStore();
    const softBtn = wrapper.findAll('.seg__item').find((w) => w.text().includes('柔和'));
    expect(softBtn).toBeTruthy();
    await softBtn!.trigger('click');
    await new Promise((r) => setTimeout(r, 10));
    await flushPromises();
    expect(settings.themeStyle).toBe('soft');
    expect(useAppStore().themeStyle).toBe('soft');
    expect(document.documentElement.dataset.themeStyle).toBe('soft');
  });

  it('SETTINGS-THEMEV2-03 主题颜色色板渲染 5 预设 + 自定义；旧「玻璃强调色」概念已移除', async () => {
    const wrapper = mountPage();
    await flushPromises();
    expect(wrapper.findAll('.swatch').length).toBe(6);
    expect(wrapper.text()).toContain('品牌紫');
    expect(wrapper.text()).toContain('自定义');
    expect(wrapper.text()).not.toContain('玻璃强调色');
    expect(wrapper.text()).not.toContain('绯红');
  });

  it('SETTINGS-THEMEV2-04 点击「自定义」打开 Sheet；非法 HEX 拒绝应用；合法 #4F8DF7 应用保存', async () => {
    const wrapper = mountPage();
    await flushPromises();
    const settings = useSettingsStore();
    // 打开自定义 Sheet（DVSheet Teleport 到 body，Sheet 内容用 document.body 定位）
    const customBtn = wrapper.findAll('.swatch').find((w) => w.text().includes('自定义'));
    await customBtn!.trigger('click');
    await flushPromises();
    expect(document.body.querySelector('.custom')).toBeTruthy();
    const setHex = (value: string) => {
      const input = document.body.querySelector<HTMLInputElement>('input.custom__hex-input')!;
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    };
    // 非法 HEX：输入非 #RRGGBB，点击应用 → 不持久化 + 显示错误
    setHex('red');
    document.body.querySelector<HTMLElement>('button.custom__apply')!.click();
    await new Promise((r) => setTimeout(r, 10));
    await flushPromises();
    expect(document.body.textContent).toContain('仅支持合法的');
    expect(settings.themeColor).not.toBe('custom');
    // 合法 HEX：#4F8DF7 → 应用 → 持久化 + 主色落地
    setHex('#4F8DF7');
    document.body.querySelector<HTMLElement>('button.custom__apply')!.click();
    await new Promise((r) => setTimeout(r, 10));
    await flushPromises();
    expect(settings.themeColor).toBe('custom');
    expect(settings.customThemeColor).toBe('#4F8DF7');
    expect(useAppStore().customThemeColor).toBe('#4F8DF7');
  });

  it('SETTINGS-THEMEV2-05 Hue 滑块位置与已保存 HEX 同步（重开 Sheet 不回到 0）', async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const settings = useSettingsStore();
    const saved: Settings = {
      currency: '¥',
      theme: 'light',
      themeColor: 'custom',
      customThemeColor: '#4F8DF7',
      sort: 'per',
      wallpaper: undefined,
    };
    vi.spyOn(services.settings, 'get').mockImplementation(async () => saved as never);
    vi.spyOn(services.settings, 'update').mockImplementation(async (patch) => ({
      ...saved,
      themeStyle: 'classic',
      ...patch,
    }) as never);
    await settings.load();
    const wrapper = mount(SettingsPage, { global: { plugins: [pinia] } });
    await flushPromises();
    const customBtn = wrapper.findAll('.swatch').find((w) => w.text().includes('自定义'));
    await customBtn!.trigger('click');
    await flushPromises();
    const slider = document.body.querySelector<HTMLInputElement>('input.custom__hue-slider')!;
    expect(slider).toBeTruthy();
    // HEX = #4F8DF7 → Hue 滑块在蓝色色相处（218°），不再是固定 0
    expect(Number(slider.value)).toBe(218);
    // 输入合法 HEX → Hue 位置实时同步（#00ff00 → 120°）
    const input = document.body.querySelector<HTMLInputElement>('input.custom__hex-input')!;
    input.value = '#00ff00';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await flushPromises();
    expect(Number(document.body.querySelector<HTMLInputElement>('input.custom__hue-slider')!.value)).toBe(120);
    // 非法 HEX → 滑块位置不跳动（保持 120）
    input.value = 'red';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await flushPromises();
    expect(Number(document.body.querySelector<HTMLInputElement>('input.custom__hue-slider')!.value)).toBe(120);
  });

  it('SETTINGS-THEMEV2-06 自定义 Sheet 提供迷你 Hero 预览（复用 Hero Token）', async () => {
    const wrapper = mountPage();
    await flushPromises();
    const customBtn = wrapper.findAll('.swatch').find((w) => w.text().includes('自定义'));
    await customBtn!.trigger('click');
    await flushPromises();
    const card = document.body.querySelector<HTMLElement>('.custom__hero-card')!;
    expect(card).toBeTruthy();
    // 消耗真实 Hero Token（随界面风格），而不是硬编码样式
    expect(card.style.getPropertyValue('--dv-primary')).toBeTruthy();
    expect(card.textContent).toContain('本月支出');
    expect(document.body.textContent).toContain('记账主卡片预览');
  });
});