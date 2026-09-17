package com.dailyvalue.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;

import org.junit.Test;

/**
 * Daily Value - Widget Snapshot 解析测试（2.18.0，JVM）
 * - WIDGET-PARSE-01：V2 Snapshot 正常解析（currency/theme/style/accent）
 * - WIDGET-PARSE-02：V1 Snapshot 正常 fallback（默认 dark/classic/品牌紫/¥）
 * - WIDGET-PARSE-03：损坏 JSON 不崩溃（返回 null）
 */
public class WidgetSnapshotParserTest {

    @Test
    public void parse_v2_snapshot_readsAllFields() {
        String json = "{\"version\":2,\"generatedAt\":1758000000000,\"monthKey\":\"2026-09\","
                + "\"monthExpense\":3268.5,\"monthIncome\":8600,\"monthBalance\":5331.5,"
                + "\"currency\":\"$\",\"resolvedTheme\":\"light\",\"themeStyle\":\"minimal\","
                + "\"accentColor\":\"#2563eb\"}";
        WidgetSnapshotData d = WidgetSnapshotParser.parse(json);
        assertNotNull(d);
        assertEquals(2, d.version);
        assertEquals("2026-09", d.monthKey);
        assertEquals(3268.5, d.monthExpense, 0.001);
        assertEquals(8600.0, d.monthIncome, 0.001);
        assertEquals(5331.5, d.monthBalance, 0.001);
        assertEquals("$", d.currency);
        assertEquals("light", d.resolvedTheme);
        assertEquals("minimal", d.themeStyle);
        assertEquals("#2563eb", d.accentColor);
    }

    @Test
    public void parse_v1_snapshot_fallsBackToDefaults() {
        // V1：只有 version=1 + 汇总字段（2.17.x 旧格式）
        String json = "{\"version\":1,\"generatedAt\":1757000000000,\"monthKey\":\"2026-08\","
                + "\"monthExpense\":100,\"monthIncome\":200}";
        WidgetSnapshotData d = WidgetSnapshotParser.parse(json);
        assertNotNull(d);
        assertEquals(1, d.version);
        assertEquals(100.0, d.monthExpense, 0.001);
        assertEquals(200.0, d.monthIncome, 0.001);
        // balance 缺失 → income - expense
        assertEquals(100.0, d.monthBalance, 0.001);
        // 兼容默认：dark / classic / 品牌紫 / ¥
        assertEquals(WidgetSnapshotData.DEFAULT_CURRENCY, d.currency);
        assertEquals(WidgetSnapshotData.DEFAULT_RESOLVED_THEME, d.resolvedTheme);
        assertEquals(WidgetSnapshotData.DEFAULT_THEME_STYLE, d.themeStyle);
        assertEquals(WidgetSnapshotData.DEFAULT_ACCENT_COLOR, d.accentColor);
    }

    @Test
    public void parse_v1_noVersionField_fallsBackToDefaults() {
        // version 缺失（更早格式）
        String json = "{\"monthKey\":\"2026-08\",\"monthExpense\":50,\"monthIncome\":60}";
        WidgetSnapshotData d = WidgetSnapshotParser.parse(json);
        assertNotNull(d);
        assertEquals(1, d.version); // optInt 默认 1
        assertEquals("¥", d.currency);
    }

    @Test
    public void parse_corruptJson_returnsNull() {
        assertNull(WidgetSnapshotParser.parse("not-json{{{"));
        assertNull(WidgetSnapshotParser.parse("{"));
        assertNull(WidgetSnapshotParser.parse(""));
        assertNull(WidgetSnapshotParser.parse(null));
    }
}