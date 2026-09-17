package com.dailyvalue.app;

import java.util.Locale;

/**
 * Daily Value - Widget 主题解析（2.18.0 Widget V2 Visual Refresh）
 *
 * 由 Web 计算好的 resolvedTheme / themeStyle / accentColor 派生实际配色（ARGB int）。
 * 只做「视觉对应」，不复制 Web CSS 全部复杂效果。
 *
 * 固定产品语义（不随主题主色变化）：
 * - 支出 = 绿色
 * - 收入 = 红色
 * - 结余 = 主文字 / 中性色
 *
 * Android RemoteViews 无法真正实现 Web 实时背景模糊：
 * glass 只实现「半透明 Glass-like Surface」（半透明背景 + 边缘轻描边 + Accent 很轻），
 * 禁止假装 blur。
 *
 * 纯 Java 实现（不依赖 android.graphics.*）：HEX 自解析，JVM 可测。
 */
public final class WidgetThemeResolver {

    /** 解析后的一组 Widget 配色（ARGB int） */
    public static final class Palette {
        public final int surface;
        public final int border;       // 仅 glass 有意义（透明）
        public final int title;        // 主文字（标题/金额）
        public final int textSecondary; // 次级文字（说明/月份）
        public final int accent;       // 主题色（月份/细装饰）
        public final int expense;      // 固定绿（支出）
        public final int income;       // 固定红（收入）
        public final int balance;      // 中性主文字（结余）

        Palette(int surface, int border, int title, int textSecondary,
                int accent, int expense, int income, int balance) {
            this.surface = surface;
            this.border = border;
            this.title = title;
            this.textSecondary = textSecondary;
            this.accent = accent;
            this.expense = expense;
            this.income = income;
            this.balance = balance;
        }
    }

    private static final int GREEN = 0xFF4CAF50;   // 支出固定语义
    private static final int RED = 0xFFEF5350;     // 收入固定语义
    private static final int WHITE = 0xFFFFFFFF;
    private static final int DARK_TEXT = 0xFF1C2030;

    /** 品牌紫底色（accent 无效时的兜底，与 Web 预设一致） */
    private static final String FALLBACK_ACCENT = "#5B67F0";

    private WidgetThemeResolver() {
    }

    /** 解析 #RRGGBB（大小写均可）→ ARGB int；非法返回品牌紫 */
    public static int accentColor(String hex) {
        if (hex != null && hex.matches("^#[0-9a-fA-F]{6}$")) {
            String h = hex.substring(1);
            int n = (int) Long.parseLong(h, 16);
            return 0xFF000000 | n;
        }
        return accentColor(FALLBACK_ACCENT);
    }

    /** 是否暗色主题（非 dark 一律按 light 处理） */
    public static boolean isDark(String resolvedTheme) {
        return "dark".equalsIgnoreCase(resolvedTheme);
    }

    /**
     * 由 resolvedTheme / themeStyle / accentColor 派生完整 Palette。
     * 纯逻辑：themeStyle 只做表面微调，不改变 light/dark 基本家族。
     */
    public static Palette derive(String resolvedTheme, String themeStyle, String accentHex) {
        boolean dark = isDark(resolvedTheme);
        String style = themeStyle == null ? "" : themeStyle.toLowerCase(Locale.ROOT);
        int accent = accentColor(accentHex);

        int surface;
        int border;
        int title;
        int textSecondary;

        if (dark) {
            // 深色家族：深蓝灰 Surface，浅色主文字，弱化次级
            surface = 0xFF1B2030;
            border = 0x00000000;
            title = WHITE;
            textSecondary = 0xFF9AA3B5;
        } else {
            // 浅色家族：浅灰 Surface（非纯白刺眼），深色主文字，浅灰次级
            surface = 0xFFF4F5F9;
            border = 0x00000000;
            title = DARK_TEXT;
            textSecondary = 0xFF7A8294;
        }

        switch (style) {
            case "soft":
                // 更柔和：Surface 稍软、对比度稍低、Accent 更轻
                surface = dark ? 0xFF242B3D : 0xFFEFF1F7;
                textSecondary = dark ? 0xFFA6AFC0 : 0xFF858DA0;
                break;
            case "minimal":
                // 更克制：扁平、减少装饰、强调排版（背景更近中性）
                surface = dark ? 0xFF161B27 : 0xFFF7F8FB;
                break;
            case "glass":
                // 半透明 Glass-like Surface + 边缘轻描边（不假装 blur）
                surface = dark ? 0xCC202838 : 0x802B2F3B;
                border = dark ? 0x2EFFFFFF : 0x1A000000;
                break;
            default:
                // classic：稳定 Surface、正常圆角、轻微层次
                break;
        }

        return new Palette(surface, border, title, textSecondary, accent, GREEN, RED,
                dark ? WHITE : DARK_TEXT);
    }
}