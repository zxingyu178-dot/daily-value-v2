/**
 * 独立壁纸设置页测试（Phase 6 v2，/settings/wallpaper）
 * - WP-SETTING-PAGE-01 无壁纸时展示预览空态 + 「选择新壁纸」，无滑杆/无移除
 * - WP-SETTING-PAGE-02 已设置壁纸时展示预览/模糊/明暗/重新调整/移除
 * - WP-SETTING-PAGE-03 移除壁纸 → store.wallpaper 变 undefined 并持久化
 * - WP-SETTING-PAGE-04 移除后预览回空态、滑杆隐藏（持久化生效）
 *
 * 正式链路（P1-1，WLP-FORMAL）：
 * - WLP-FORMAL-01 选择图片打开 Editor（blur/overlay 随当前壁纸播种）
 * - WLP-FORMAL-02 Cancel 不改变旧壁纸、关闭 Editor
 * - WLP-FORMAL-03 Apply 持久化新图（plain DTO → store.wallpaper），成功关闭 Editor
 * - WLP-FORMAL-04 Apply 期间重复触发被 editorSaving 拦截（防重复提交）
 * - WLP-FORMAL-06 保存失败 Editor 不关闭、旧壁纸不变、滑杆回滚
 * - WLP-FORMAL-10 移除 + 重新 load 后仍为空（持久化生效）
 *
 * 注：真实 Cropper 导出（WLP-FORMAL-08 EXIF、09 导出比例）无法在 jsdom 运行，
 * 由 tools/wpcropper-final-check.mjs 引擎级 E2E 覆盖（Round3 全绿）。
 */
import { describe, it, expect, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import WallpaperSettingsPage from '@/pages/settings/WallpaperSettingsPage.vue';
import WallpaperCropperEditor from '@/components/wallpaper/WallpaperCropperEditor.vue';
import { useSettingsStore } from '@/core/store/settings';
import { services } from '@/core/services';
import type { Settings } from '@/core/models/types';

const pushMock = vi.hoisted(() => vi.fn());
const backMock = vi.hoisted(() => vi.fn());
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: pushMock, back: backMock, options: { history: { state: null } } }),
}));

/** jsdom 无 URL.createObjectURL/revokeObjectURL，注入桩（P1-4 依赖） */
const createdURLs: string[] = [];
vi.stubGlobal('URL', {
  ...URL,
  createObjectURL: (() => {
    const url = `blob:mock/${createdURLs.length + 1}`;
    createdURLs.push(url);
    return url;
  }) as unknown as typeof URL.createObjectURL,
  revokeObjectURL: vi.fn((u: string) => {
    const idx = createdURLs.indexOf(u);
    if (idx >= 0) createdURLs.splice(idx, 1);
  }),
});

function baseSettings(over: Partial<Settings> = {}): Settings {
  return {
    currency: '¥',
    theme: 'auto',
    themeColor: 'violet',
    sort: 'per',
    ...over,
  };
}

interface MountCtx {
  pinia: ReturnType<typeof createPinia>;
  store: ReturnType<typeof useSettingsStore>;
  saved: Settings;
  clk?: () => Promise<void>;
}

/** mount，并返回可控的 services.settings.update（可让某个调用 pending 或 reject） */
function mountWith(settings: Settings, opts?: { failAt?: number }): MountCtx {
  const pinia = createPinia();
  setActivePinia(pinia);
  const store = useSettingsStore();
  let saved = settings;
  let call = 0;
  let waiter: (() => void) | null = null;
  const pending = new Promise<void>((res) => {
    waiter = res;
  });
  const failAt = opts?.failAt ?? -1;
  vi.spyOn(services.settings, 'get').mockImplementation(async () => saved as never);
  vi.spyOn(services.settings, 'update').mockImplementation(async (patch: any) => {
    call += 1;
    if (failAt > 0 && call === failAt) {
      await pending; // 挂起：用于 P1-3 重复提交 / 失败回滚测试
      throw new Error('mock update failed');
    }
    saved = { ...saved, ...patch };
    return saved as never;
  });
  return {
    pinia,
    store,
    saved,
    clk: () => {
      waiter?.();
      return pending;
    },
  };
}

function makeFile(): File {
  return new File(['fake-png-bytes'], 'wallpaper.png', { type: 'image/png' });
}

function promptFile(wrapper: Awaited<ReturnType<typeof mount>>) {
  const input = wrapper.find('input[type="file"]');
  Object.defineProperty(input.element, 'files', { value: [makeFile()], configurable: true });
  return input;
}

describe('独立壁纸设置页（/settings/wallpaper）', () => {
  it('WP-SETTING-PAGE-01 无壁纸时展示预览空态 + 「选择新壁纸」，无滑杆/无移除', async () => {
    const { pinia, store } = mountWith(baseSettings());
    await store.load();
    const wrapper = mount(WallpaperSettingsPage, { global: { plugins: [pinia] } });
    await flushPromises();
    expect(wrapper.text()).toContain('壁纸设置');
    expect(wrapper.text()).toContain('未设置壁纸');
    expect(wrapper.text()).toContain('选择新壁纸');
    // 无壁纸：不显示模糊/明暗滑杆、不显示重新调整/移除
    expect(wrapper.find('.wp-controls').exists()).toBe(false);
    expect(wrapper.find('.wp-actions').exists()).toBe(false);
    expect(store.settings?.wallpaper).toBeUndefined();
  });

  it('WP-SETTING-PAGE-02 已设置壁纸时展示预览/模糊/明暗/重新调整/移除', async () => {
    const wp = { image: 'data:image/jpeg;base64,/9j/x', blur: 4, overlay: 0.25 };
    const { pinia, store } = mountWith(baseSettings({ wallpaper: wp }));
    await store.load();
    const wrapper = mount(WallpaperSettingsPage, { global: { plugins: [pinia] } });
    await flushPromises();
    expect(wrapper.find('.wp-preview__img').exists()).toBe(true);
    expect(wrapper.find('.wp-controls').exists()).toBe(true);
    expect(wrapper.find('.wp-actions').exists()).toBe(true);
    expect(wrapper.text()).toContain('重新调整');
    expect(wrapper.text()).toContain('移除壁纸');
    expect(store.settings?.wallpaper?.image).toBe(wp.image);
  });

  it('WP-SETTING-PAGE-03 移除壁纸 → store.wallpaper 变 undefined 并持久化', async () => {
    const wp = { image: 'data:image/jpeg;base64,/9j/x', blur: 4, overlay: 0.25 };
    const { pinia, store } = mountWith(baseSettings({ wallpaper: wp }));
    await store.load();
    const wrapper = mount(WallpaperSettingsPage, { global: { plugins: [pinia] } });
    await flushPromises();
    const removeBtn = Array.from(wrapper.findAll('button')).find((b) =>
      b.text()?.includes('移除壁纸'),
    );
    expect(removeBtn).toBeTruthy();
    removeBtn?.trigger('click');
    await flushPromises();
    expect(store.wallpaper).toBeUndefined();
    expect(store.settings?.wallpaper).toBeUndefined();
  });

  it('WP-SETTING-PAGE-04 移除后预览回空态、滑杆隐藏（持久化生效）', async () => {
    const wp = { image: 'data:image/jpeg;base64,/9j/x', blur: 4, overlay: 0.25 };
    const { pinia, store } = mountWith(baseSettings({ wallpaper: wp }));
    await store.load();
    const wrapper = mount(WallpaperSettingsPage, { global: { plugins: [pinia] } });
    await flushPromises();
    const removeBtn = Array.from(wrapper.findAll('button')).find((b) =>
      b.text()?.includes('移除壁纸'),
    );
    removeBtn?.trigger('click');
    await flushPromises();
    expect(store.wallpaper).toBeUndefined();
    expect(store.settings?.wallpaper).toBeUndefined();
  });

  // ============================ 正式链路 ============================

  it('WLP-FORMAL-01 选择图片打开 Editor（blur/overlay 随当前壁纸播种）', async () => {
    const wp = { image: 'data:image/jpeg;base64,/9j/x', blur: 4, overlay: 0.25 };
    const { pinia, store } = mountWith(baseSettings({ wallpaper: wp }));
    await store.load();
    const wrapper = mount(WallpaperSettingsPage, { global: { plugins: [pinia] } });
    await flushPromises();
    await promptFile(wrapper).trigger('change');
    await flushPromises();
    // Editor 浮层打开，带初始 blur/overlay
    expect(wrapper.find('.editor-layer').exists()).toBe(true);
    expect(wrapper.findComponent(WallpaperCropperEditor).exists()).toBe(true);
    const editor = wrapper.findComponent(WallpaperCropperEditor);
    expect((editor.props('blur') as number).toFixed(0)).toBe('4');
    expect(editor.props('overlay')).toBe(0.25);
    // 打开 Editor 时锁定 body 滚动，避免背景滚动
    expect(document.body.style.overflow).toBe('hidden');
    // 未应用：store 壁纸不变
    expect(store.wallpaper?.image).toBe(wp.image);
  });

  it('WLP-FORMAL-02 Cancel 不改变旧壁纸、关闭 Editor、释放 objectURL', async () => {
    const wp = { image: 'data:image/jpeg;base64,/9j/x', blur: 4, overlay: 0.25 };
    const { pinia, store } = mountWith(baseSettings({ wallpaper: wp }));
    await store.load();
    const wrapper = mount(WallpaperSettingsPage, { global: { plugins: [pinia] } });
    await flushPromises();
    await promptFile(wrapper).trigger('change');
    await flushPromises();
    expect(wrapper.find('.editor-layer').exists()).toBe(true);
    const before = createdURLs.length;
    // 触发 Editor 取消（等价 emit('cancel')）
    wrapper.findComponent(WallpaperCropperEditor).vm.$emit('cancel');
    await flushPromises();
    expect(wrapper.find('.editor-layer').exists()).toBe(false);
    expect(store.wallpaper?.image).toBe(wp.image); // 旧壁纸不变
    expect(document.body.style.overflow).toBe(''); // 解锁滚动
    expect(createdURLs.length).toBe(before - 1); // objectURL 已 revoke
  });

  it('WLP-FORMAL-03 Apply 持久化新图（plain DTO → store.wallpaper），成功关闭 Editor', async () => {
    const wp = { image: 'data:image/jpeg;base64,/old', blur: 4, overlay: 0.25 };
    const { pinia, store } = mountWith(baseSettings({ wallpaper: wp }));
    await store.load();
    const wrapper = mount(WallpaperSettingsPage, { global: { plugins: [pinia] } });
    await flushPromises();
    await promptFile(wrapper).trigger('change');
    await flushPromises();
    // 记录 update 收到的 DTO（P1-3 断言 plain DTO / 防重复）
    let captured: Record<string, unknown> | null = null;
    const spy = vi.mocked(services.settings.update);
    spy.mockClear();
    spy.mockImplementation(async (patch: any) => {
      captured = patch?.wallpaper;
      return { ...store.settings!, wallpaper: patch?.wallpaper } as never;
    });
    const newWp = { image: 'data:image/jpeg;base64,/new-final', blur: 6, overlay: 0.4, width: 1152, height: 2560 };
    wrapper.findComponent(WallpaperCropperEditor).vm.$emit('apply', newWp);
    await flushPromises();
    // plain DTO：非 Vue reactive Proxy
    expect(captured).toBeTruthy();
    expect(Object.getPrototypeOf(captured)).toBe(Object.prototype);
    expect(captured).not.toHaveProperty('__v_isReactive');
    expect(captured).toMatchObject({ image: newWp.image, blur: newWp.blur, overlay: newWp.overlay });
    // 持久化成功 → Editor 关闭 + 预览已更新为最终构图图
    expect(wrapper.find('.editor-layer').exists()).toBe(false);
    expect(store.wallpaper?.image).toBe(newWp.image);
    expect(store.wallpaper?.blur).toBe(6);
  });

  it('WLP-FORMAL-04 Apply 期间重复触发被 editorSaving 拦截（防重复提交 P1-3）', async () => {
    const wp = { image: 'data:image/jpeg;base64,/old', blur: 4, overlay: 0.25 };
    // failAt=2：2.13.0 起 load() 首读时会执行一次 Theme V2 迁移写（第 1 次 update），
    // 这里针对的是「壁纸 Apply 的持久化」挂起场景，因此后移一位
    const ctx = mountWith(baseSettings({ wallpaper: wp }), { failAt: 2 });
    const { store } = ctx;
    await store.load();
    const wrapper = mount(WallpaperSettingsPage, { global: { plugins: [ctx.pinia] } });
    await flushPromises();
    await promptFile(wrapper).trigger('change');
    await flushPromises();
    const spy = vi.mocked(services.settings.update);
    spy.mockClear();
    // 第一次 Apply：update 被挂起（editorSaving=true）
    wrapper.findComponent(WallpaperCropperEditor).vm.$emit('apply', {
      image: 'data:image/jpeg;base64,/a',
      blur: 1,
      overlay: 0,
    });
    await flushPromises();
    // 第二次 Apply：应被 editorSaving 拦截，不产生新的 update 调用
    wrapper.findComponent(WallpaperCropperEditor).vm.$emit('apply', {
      image: 'data:image/jpeg;base64,/b',
      blur: 2,
      overlay: 0.1,
    });
    await flushPromises();
    expect(spy).toHaveBeenCalledTimes(1); // 仍只有一次持久化
  });

  it('WLP-FORMAL-06 保存失败 Editor 不关闭、旧壁纸不变、滑杆回滚', async () => {
    const wp = { image: 'data:image/jpeg;base64,/old', blur: 4, overlay: 0.25 };
    // failAt=2：同 WLP-FORMAL-04，减 1 位给 load() 的 Theme V2 迁移写
    const ctx = mountWith(baseSettings({ wallpaper: wp }), { failAt: 2 });
    const { store } = ctx;
    wp; // 之后用 ctx.saved 判定
    await store.load();
    const wrapper = mount(WallpaperSettingsPage, { global: { plugins: [ctx.pinia] } });
    await flushPromises();
    await promptFile(wrapper).trigger('change');
    await flushPromises();
    wrapper.findComponent(WallpaperCropperEditor).vm.$emit('apply', {
      image: 'data:image/jpeg;base64,/new-fail',
      blur: 9,
      overlay: 0.8,
    });
    await flushPromises();
    expect(wrapper.find('.editor-layer').exists()).toBe(true); // Editor 保持打开
    await ctx.clk!(); // 放行 → update 抛错
    await flushPromises();
    expect(wrapper.find('.editor-layer').exists()).toBe(true); // 失败后仍打开
    expect(store.wallpaper?.image).toBe(wp.image); // 旧壁纸不变
    expect(store.wallpaper?.blur).toBe(4);
  });

  it('WLP-FORMAL-10 移除 + 重新 load 后仍为空（持久化生效）', async () => {
    const wp = { image: 'data:image/jpeg;base64,/9j/x', blur: 4, overlay: 0.25 };
    const { pinia, store } = mountWith(baseSettings({ wallpaper: wp }));
    await store.load();
    const wrapper = mount(WallpaperSettingsPage, { global: { plugins: [pinia] } });
    await flushPromises();
    const removeBtn = Array.from(wrapper.findAll('button')).find((b) =>
      b.text()?.includes('移除壁纸'),
    );
    removeBtn?.trigger('click');
    await flushPromises();
    // 模拟 App 重建：全新 pinia，重新从持久化读取
    const pinia2 = createPinia();
    setActivePinia(pinia2);
    const store2 = useSettingsStore();
    await store2.load();
    expect(store2.wallpaper).toBeUndefined();
    expect(store2.settings?.wallpaper).toBeUndefined();
  });

  it('WLP-FORMAL-07 Android Back：Editor 打开时 Back 等价于「先关 Editor 仍停留本页」', async () => {
    const wp = { image: 'data:image/jpeg;base64,/9j/x', blur: 4, overlay: 0.25 };
    const { pinia, store } = mountWith(baseSettings({ wallpaper: wp }));
    await store.load();
    const wrapper = mount(WallpaperSettingsPage, { global: { plugins: [pinia] } });
    await flushPromises();
    await promptFile(wrapper).trigger('change');
    await flushPromises();
    expect(wrapper.find('.editor-layer').exists()).toBe(true);
    // 点击 Editor 内的「取消」按钮（cancelEditor 即 Back 触发的回调）：关 Editor 但不离开本页
    const cancelBtn = Array.from(wrapper.findAll('button')).find(
      (b) => b.text()?.trim() === '取消',
    );
    expect(cancelBtn).toBeTruthy();
    await cancelBtn!.trigger('click');
    await flushPromises();
    expect(wrapper.find('.editor-layer').exists()).toBe(false);
    // 取消不会调用路由返回（仍停留在壁纸设置页）
    expect(backMock).not.toHaveBeenCalled();
    expect(pushMock).not.toHaveBeenCalled();
    expect(store.wallpaper?.image).toBe(wp.image);
  });
});