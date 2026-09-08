/**
 * 2.9.7 分类图标系统回归测试（Category Final Refactor）
 * - CAT-ICON-01：本地 SVG 图标至少 40 个，id 唯一，且每个都有 lucide SVG 组件（非纯 emoji）
 * - FIX-03：categoryGlyph 正确渲染 builtin / emoji / 旧数据回退
 * - 向后兼容：无 iconType/iconValue 的旧分类照常显示 emoji
 */
import { describe, it, expect } from 'vitest';
import { BUILTIN_ICONS, builtinIconById, categoryGlyph, categoryIconComponent, isBuiltinIcon } from '@/core/models/icons';

describe('BUILTIN_ICONS（CAT-ICON-01：真正本地 SVG）', () => {
  it('至少提供 40 个内置图标（2.9.7 从 20+ 升级到 40~60）', () => {
    expect(BUILTIN_ICONS.length).toBeGreaterThanOrEqual(40);
  });

  it('每个图标都有本地 SVG 组件（lucide-vue-next，非纯 emoji）', () => {
    for (const icon of BUILTIN_ICONS) {
      expect(icon.component).toBeTruthy();
      // categoryIconComponent 按 id 能解析出 SVG 组件（统一线性/圆角风格）
      expect(categoryIconComponent({ iconType: 'builtin', iconValue: icon.id })).toBeTruthy();
    }
  });

  it('内置图标 id 唯一且均有 glyph/label', () => {
    const ids = new Set<string>();
    for (const icon of BUILTIN_ICONS) {
      expect(icon.id).toBeTruthy();
      expect(icon.glyph).toBeTruthy();
      expect(icon.label).toBeTruthy();
      expect(ids.has(icon.id)).toBe(false);
      ids.add(icon.id);
    }
  });

  it('覆盖用户要求的常用分类图标（餐饮/交通/购物/娱乐/…/其他）', () => {
    const labels = BUILTIN_ICONS.map((i) => i.label);
    for (const need of [
      '餐饮', '交通', '购物', '娱乐', '生活', '饮料', '话费', '工资',
      '手机', '数码', '学习', '医疗', '住房', '礼物', '旅行', '运动',
      '宠物', '社交', '零食', '其他',
    ]) {
      expect(labels).toContain(need);
    }
  });
});

describe('categoryGlyph（FIX-03 + 旧数据兼容）', () => {
  it('builtin 类型：返回内置图标 glyph', () => {
    expect(categoryGlyph({ iconType: 'builtin', iconValue: 'dining', emoji: '🍚' })).toBe('🍚');
    expect(categoryGlyph({ iconType: 'builtin', iconValue: 'salary', emoji: '💰' })).toBe('💰');
  });

  it('旧数据（无 iconType）：直接回退 emoji', () => {
    expect(categoryGlyph({ emoji: '🍕' })).toBe('🍕');
    expect(categoryGlyph({ emoji: '🍕', iconType: undefined, iconValue: undefined })).toBe('🍕');
  });

  it('emoji 类型：返回用户手输 emoji', () => {
    expect(categoryGlyph({ iconType: 'emoji', iconValue: '😺', emoji: '😺' })).toBe('😺');
  });

  it('builtin id 不存在时回退 emoji（不崩）', () => {
    expect(categoryGlyph({ iconType: 'builtin', iconValue: 'not-exist', emoji: '🫥' })).toBe('🫥');
  });
});

describe('builtinIconById / isBuiltinIcon', () => {
  it('builtinIconById 命中返回图标，未命中返回 undefined', () => {
    expect(builtinIconById('other')?.glyph).toBeTruthy();
    expect(builtinIconById('nope')).toBeUndefined();
  });

  it('isBuiltinIcon 仅 builtin 类型为 true', () => {
    expect(isBuiltinIcon({ iconType: 'builtin' })).toBe(true);
    expect(isBuiltinIcon({ iconType: 'emoji' })).toBe(false);
    expect(isBuiltinIcon({})).toBe(false);
  });
});
