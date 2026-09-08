/**
 * Daily Value v2 - Theme Tokens
 * 统一 Design System 的设计变量来源（单一事实来源）。
 * 页面禁止硬编码颜色/间距/圆角，一律引用本 token。
 */

export const colors = {
  // 语义色（light）
  light: {
    background: '#f6f7fb', // 页面背景
    surface: '#ffffff', // 卡片 / 面板
    surfaceAlt: '#eef1f6', // 次级面板（凹陷区）
    primary: '#5b67f0', // 品牌主色
    onPrimary: '#ffffff',
    primarySoft: '#e8eaff', // 主色浅底（选中态）
    onSurface: '#1c2030', // 主文本
    onSurfaceVariant: '#5c6478', // 次级文本
    outline: '#dfe3ec', // 描边 / 分隔线
    success: '#1fae6a',
    warning: '#f0a32f',
    danger: '#e04b4b',
    info: '#3b82f6',
    // 记账/统计语义色（产品固定规则：支出=绿色，收入=红色）
    expense: '#1fae6a',
    income: '#e04b4b',
    // 记账页绿色月份汇总卡
    monthCardBg: 'linear-gradient(135deg, #23b26e 0%, #17a05d 55%, #129157 100%)',
    monthCardShadow: '0 6px 18px rgba(31, 174, 106, 0.35)',
    textOnColor: '#ffffff',
  },
  // 语义色（dark）
  dark: {
    background: '#0f172a',
    surface: '#1a2236',
    surfaceAlt: '#111a2c',
    primary: '#7c86ff',
    onPrimary: '#ffffff',
    primarySoft: '#283061',
    onSurface: '#eef1f8',
    onSurfaceVariant: '#9aa4bd',
    outline: '#2b3550',
    success: '#3ddc8f',
    warning: '#f5b84e',
    danger: '#ff6b6b',
    info: '#60a5fa',
    // 记账/统计语义色（产品固定规则：支出=绿色，收入=红色）
    expense: '#3ddc8f',
    income: '#ff6b6b',
    textOnColor: '#ffffff',
  },
};

/** 强调色主题标识（默认 violet 品牌紫，与 CSS 中 [data-theme-color] 对应） */
export type ThemeAccentId = 'violet' | 'blue' | 'emerald' | 'orange' | 'rose';

export interface ThemeAccentDef {
  label: string;
  /** 色板取样色（Settings UI 圆形按钮显示用） */
  chip: string;
  light: { primary: string; primarySoft: string };
  dark: { primary: string; primarySoft: string };
}

/** 强调色主题 palette（明暗自适应由 base.css 落地，此处为 UI/逻辑单一来源） */
export const themeAccents: Record<ThemeAccentId, ThemeAccentDef> = {
  violet: { label: '品牌紫', chip: '#5b67f0', light: { primary: '#5b67f0', primarySoft: '#e8eaff' }, dark: { primary: '#7c86ff', primarySoft: '#283061' } },
  blue: { label: '海蓝', chip: '#2563eb', light: { primary: '#2563eb', primarySoft: '#dbeafe' }, dark: { primary: '#60a5fa', primarySoft: '#1e3a66' } },
  emerald: { label: '翡翠', chip: '#059669', light: { primary: '#059669', primarySoft: '#d1fae5' }, dark: { primary: '#34d399', primarySoft: '#0b3a2d' } },
  orange: { label: '暖橙', chip: '#ea580c', light: { primary: '#ea580c', primarySoft: '#ffedd5' }, dark: { primary: '#fb923c', primarySoft: '#552505' } },
  rose: { label: '玫红', chip: '#e11d48', light: { primary: '#e11d48', primarySoft: '#ffe4e6' }, dark: { primary: '#fb7185', primarySoft: '#4a1f30' } },
};

export const themeAccentList = Object.keys(themeAccents) as ThemeAccentId[];

export const ACCENT_DEFAULT: ThemeAccentId = 'violet';

/* ---- 玻璃强调色（2.10.4 Visual Polish，独立于 theme/themeColor 的正交维度） ----
   仅深色主题下生效（base.css 以 [data-theme='dark'] 门禁）；默认 off = 完全保持现状。
   参考 React 优化版 Crimson Frosted Glass：accent 主轴色 / glow 背景光晕 / tint 卡内强调。 */
export type GlassStyleId = 'off' | 'none' | 'crimson' | 'amber' | 'ice';

export interface GlassStyleDef {
  label: string;
  /** Settings 色板取样色 */
  chip: string;
  /** --dv-accent 主轴色（无强调时透明） */
  accent: string;
  /** 背景光晕径向色 */
  glow: string;
  /** 玻璃卡/月卡/FAB 的强调色 tint */
  tint: string;
}

export const glassStyles: Record<GlassStyleId, GlassStyleDef> = {
  off: { label: '关闭', chip: '#94a3b8', accent: 'transparent', glow: 'transparent', tint: 'transparent' },
  none: { label: '无强调', chip: '#e9edf1', accent: 'transparent', glow: 'rgba(255,255,255,0.06)', tint: 'transparent' },
  crimson: { label: '绯红', chip: '#ff4d4d', accent: '#ff4d4d', glow: 'rgba(255,77,77,0.32)', tint: 'rgba(255,77,77,0.16)' },
  amber: { label: '琥珀', chip: '#ffa366', accent: '#ffa366', glow: 'rgba(255,163,102,0.30)', tint: 'rgba(255,163,102,0.16)' },
  ice: { label: '冰蓝', chip: '#66d9ff', accent: '#66d9ff', glow: 'rgba(102,217,255,0.30)', tint: 'rgba(102,217,255,0.16)' },
};

export const glassStyleList = Object.keys(glassStyles) as GlassStyleId[];

export const GLASS_ACCENT_DEFAULT: GlassStyleId = 'off';

/** 深色玻璃的图表霓虹（产品规则保持 支出=绿 / 收入=红）与四色分类 palette（页面禁止硬编码） */
export const GLASS_CHART = { expense: '#4DFF88', income: '#FF4D4D' } as const;
export const GLASS_CATEGORY_PALETTE = ['#FF4D4D', '#FFFFFF', '#FFA366', '#4DFF88'];

export const spacing = {
  xxs: 4,
  xs: 8,
  sm: 12,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
};

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  pill: 999,
};

export const typography = {
  // 字号（px）
  caption: 12,
  body: 14,
  bodyLg: 16,
  title: 20,
  headline: 28,
  // 行高倍率
  lineHeight: 1.5,
  // 字重
  weights: {
    regular: 400,
    medium: 500,
    semibold: 600,
    bold: 700,
  },
};

export const motion = {
  // 动画时长（ms）—— 见 Trae_Development_Rules
  fast: 120,
  normal: 250,
  slow: 350,
  // 一级页面切换专用（2.9.4 Polish；介于 fast 与 normal 之间，140~180ms）
  page: 160,
  // 缓动
  easing: {
    standard: 'cubic-bezier(0.2, 0, 0, 1)',
    emphasize: 'cubic-bezier(0.2, 0, 0, 1.2)',
  },
};

export const zIndex = {
  base: 0,
  sticky: 10,
  overlay: 100,
  sheet: 200,
  toast: 300,
};

export const themeTokens = { colors, spacing, radius, typography, motion, zIndex };

export type ThemeTokens = typeof themeTokens;
export default themeTokens;
