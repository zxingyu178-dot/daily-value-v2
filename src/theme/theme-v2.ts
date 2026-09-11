/**
 * Daily Value v2 - Theme V2（2.13.0）
 * - deriveCustomAccent：自定义主题主色 → primary / primarySoft / onPrimary / glow / tint 纯函数。
 *   自动保证基本可读性（深色主题适亮、onPrimary 按亮度取黑白、soft 按明暗混合）。
 * - migrateThemeGlass：旧 themeGlass（2.10.4 历史能力）→ Theme V2 字段映射纯函数。
 *   关键约束：themeStyle 缺失时视觉必须保持（glass 用户映射到相近 Theme V2，不可突然回默认）。
 */
import type { Settings } from '@/core/models/types';
import type { GlassStyleId, ThemeColorId, ThemeStyleId } from '@/theme/tokens';

/* ------------------------------------------------------------------ *
 * 自定义主题主色（只开放「主题主色」一个入口；
 *  背景/文字/Card/边框/支出/收入 等语义色一律禁止跟随自定义主色）
 * ------------------------------------------------------------------ */
export interface CustomAccentDerived {
  /** 主题主色（dark 下作适亮处理保证与背景可读） */
  primary: string;
  /** 主色浅底（选中态/开关背景） */
  primarySoft: string;
  /** primary 之上的文字色（按亮度自动黑白） */
  onPrimary: string;
  /** 玻璃强调 glow（径向光晕） */
  glow: string;
  /** 玻璃强调 tint（卡内强调） */
  tint: string;
}

interface Rgb {
  r: number;
  g: number;
  b: number;
}

function clamp(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}

/** 解析 #RRGGBB（大小写均可）；非法输入返回 null */
export function parseHexColor(input: string): Rgb | null {
  const m = /^#([0-9a-fA-F]{6})$/.exec(input.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff };
}

/**
 * 2.13.2：#RRGGBB → 色相（0~360，HSL）。自定义颜色 Sheet 打开时用保存的 HEX 恢复 Hue 滑块位置。
 * 非法 HEX / 灰阶（无彩度）返回 0。
 */
export function hexToHue(hex: string): number {
  const rgb = parseHexColor(hex);
  if (!rgb) return 0;
  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d === 0) return 0;
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  const deg = Math.round(h * 60);
  return ((deg % 360) + 360) % 360;
}

function toHex({ r, g, b }: Rgb): string {
  const h = (v: number) => clamp(v).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

/** 相对亮度（0~1，WCAG 近似） */
function luminance({ r, g, b }: Rgb): number {
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** 按 ratio 向 base 混合（ratio=0 → 原色；1 → base） */
function mix(color: Rgb, base: Rgb, ratio: number): Rgb {
  return {
    r: color.r + (base.r - color.r) * ratio,
    g: color.g + (base.g - color.g) * ratio,
    b: color.b + (base.b - color.b) * ratio,
  };
}

function rgba({ r, g, b }: Rgb, a: number): string {
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

/**
 * 由用户 HEX 派生主题主色全套语义 Token。
 * - primary：浅色直接用 HEX；深色向白色适亮 ~30%，保证与深底对比可读。
 * - primarySoft：light 向白 86% 混合（浅主色底）；dark 向深底 #0f172a 72% 混合。
 * - onPrimary：按 primary 亮度自动取黑/白。
 * - glow/tint：主色半透明（玻璃强调）。
 * 非法 HEX（非 #RRGGBB）返回 null，调用方拒绝应用。
 */
export function deriveCustomAccent(hex: string, resolvedTheme: 'light' | 'dark'): CustomAccentDerived | null {
  const rgb = parseHexColor(hex);
  if (!rgb) return null;
  const primaryRgb = resolvedTheme === 'dark' ? mix(rgb, { r: 255, g: 255, b: 255 }, 0.3) : rgb;
  const primary = toHex(primaryRgb);
  const onPrimary = luminance(primaryRgb) > 0.45 ? '#1c2030' : '#ffffff';
  const softBase = resolvedTheme === 'dark' ? { r: 15, g: 23, b: 42 } : { r: 255, g: 255, b: 255 };
  const soft = toHex(mix(primaryRgb, softBase, resolvedTheme === 'dark' ? 0.72 : 0.86));
  return { primary, primarySoft: soft, onPrimary, glow: rgba(primaryRgb, 0.3), tint: rgba(primaryRgb, 0.16) };
}

/* ------------------------------------------------------------------ *
 * 旧 themeGlass → Theme V2 迁移
 * ------------------------------------------------------------------ */

/** 旧玻璃强调色 → Theme V2（风格 + 颜色）映射（用户规格） */
const GLASS_TO_V2: Record<Exclude<GlassStyleId, 'off'>, { style: ThemeStyleId; color: ThemeColorId }> = {
  none: { style: 'glass', color: 'violet' },
  crimson: { style: 'glass', color: 'rose' },
  amber: { style: 'glass', color: 'orange' },
  ice: { style: 'glass', color: 'blue' },
};

/**
 * 一次性迁移：settings 已有 themeStyle → 已是 Theme V2，原样返回。
 * 否则按 themeGlass 映射（off/缺失 → classic，保持 2.12 视觉；非 off → 对应 glass 风格 + 近色）。
 * 幂等：迁移后 themeStyle 存在，再次调用不会再改。
 */
export function migrateThemeGlass(s: Settings): Settings {
  if (s.themeStyle) return s;
  const glass = s.themeGlass ?? 'off';
  const baseColor: ThemeColorId =
    s.themeColor && s.themeColor !== 'custom' ? s.themeColor : 'violet';
  if (glass === 'off') {
    return { ...s, themeStyle: 'classic', themeColor: baseColor };
  }
  const map = GLASS_TO_V2[glass as Exclude<GlassStyleId, 'off'>];
  if (!map) return { ...s, themeStyle: 'classic', themeColor: baseColor };
  return { ...s, themeStyle: map.style, themeColor: map.color };
}