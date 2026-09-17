package com.dailyvalue.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotEquals;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/**
 * Daily Value - Widget 主题解析测试（2.18.0，JVM）
 * - WIDGET-THEME-01：light（浅 Surface / 深主文字 / 固定绿红语义 / accent 跟随）
 * - WIDGET-THEME-02：dark（深 Surface / 浅主文字）
 * - 自定义 accent HEX 解析 / 非法回退品牌紫 / glass 半透明
 */
public class WidgetThemeResolverTest {

    @Test
    public void theme_light_surfaceAndText() {
        WidgetThemeResolver.Palette p = WidgetThemeResolver.derive("light", "classic", "#2563eb");
        // 浅 Surface（非纯白）
        assertEquals(0xFFF4F5F9, p.surface);
        // 深色主文字
        assertEquals(0xFF1C2030, p.title);
        assertTrue(p.textSecondary != 0xFF1C2030); // 次级弱化
        // 固定语义：支出绿 / 收入红
        assertEquals(0xFF4CAF50, p.expense);
        assertEquals(0xFFEF5350, p.income);
        // accent 跟随 #2563eb
        assertEquals(0xFF2563eb, p.accent);
        // 结余中性 = 主文字
        assertEquals(p.balance, p.title);
        // classic 无边（border 透明）
        assertEquals(0x00000000, p.border);
    }

    @Test
    public void theme_dark_surfaceAndText() {
        WidgetThemeResolver.Palette p = WidgetThemeResolver.derive("dark", "classic", "#7c86ff");
        // 深 Surface（深蓝灰）
        assertEquals(0xFF1B2030, p.surface);
        // 浅色主文字
        assertEquals(0xFFFFFFFF, p.title);
        // 固定语义不变
        assertEquals(0xFF4CAF50, p.expense);
        assertEquals(0xFFEF5350, p.income);
        // accent 跟随
        assertEquals(0xFF7c86ff, p.accent);
        assertEquals(0xFFFFFFFF, p.balance);
    }

    @Test
    public void theme_glass_semiTransparentSurface() {
        WidgetThemeResolver.Palette light = WidgetThemeResolver.derive("light", "glass", "#5b67f0");
        assertNotEquals(0xFF000000, light.border); // 玻璃有描边（非透明）
        assertTrue((light.surface >>> 24) < 0xFF); // 半透明（alpha < 255）

        WidgetThemeResolver.Palette dark = WidgetThemeResolver.derive("dark", "glass", "#5b67f0");
        assertTrue((dark.surface >>> 24) < 0xFF);
        assertNotEquals(0x00000000, dark.border);
    }

    @Test
    public void accent_invalidHex_fallsBackToBrand() {
        assertEquals(
                WidgetThemeResolver.accentColor(WidgetSnapshotData.DEFAULT_ACCENT_COLOR),
                WidgetThemeResolver.accentColor("not-a-color"));
        assertEquals(
                WidgetThemeResolver.accentColor(WidgetSnapshotData.DEFAULT_ACCENT_COLOR),
                WidgetThemeResolver.accentColor(null));
        assertEquals(
                WidgetThemeResolver.accentColor(WidgetSnapshotData.DEFAULT_ACCENT_COLOR),
                WidgetThemeResolver.accentColor("#12g456")); // 非法字符
    }

    @Test
    public void isDark_returnsExpected() {
        assertTrue(WidgetThemeResolver.isDark("dark"));
        assertFalse(WidgetThemeResolver.isDark("light"));
        assertFalse(WidgetThemeResolver.isDark("auto")); // 非 dark 一律按 light
    }
}