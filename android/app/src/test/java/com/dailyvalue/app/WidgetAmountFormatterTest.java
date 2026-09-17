package com.dailyvalue.app;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

/**
 * Daily Value - Widget 金额格式化测试（2.18.0，JVM）
 * - WIDGET-FORMAT-01：0
 * - WIDGET-FORMAT-02：普通金额 + 千位
 * - WIDGET-FORMAT-03：负结余
 * - WIDGET-FORMAT-04：超长金额紧凑显示（万级）
 */
public class WidgetAmountFormatterTest {

    @Test
    public void format_zero() {
        assertEquals("¥0.00", WidgetAmountFormatter.format(0, "¥"));
        assertEquals("$0.00", WidgetAmountFormatter.format(0, "$"));
    }

    @Test
    public void format_normalThousand() {
        assertEquals("¥3,268.50", WidgetAmountFormatter.format(3268.5, "¥"));
        assertEquals("¥8,600.00", WidgetAmountFormatter.format(8600, "¥"));
        assertEquals("¥86.00", WidgetAmountFormatter.format(86, "¥"));
        assertEquals("€1,234.56", WidgetAmountFormatter.format(1234.56, "€"));
    }

    @Test
    public void format_signed_negativeBalance() {
        assertEquals("-¥5,331.50", WidgetAmountFormatter.formatSigned(-5331.5, "¥"));
        assertEquals("¥5,331.50", WidgetAmountFormatter.formatSigned(5331.5, "¥"));
        assertEquals("-¥1.00", WidgetAmountFormatter.formatSigned(-1, "¥"));
    }

    @Test
    public void smartFormat_longAmountCompactWan() {
        // 小于 10 万：仍标准千位
        assertEquals("¥3,268.50", WidgetAmountFormatter.smartFormat(3268.5, "¥"));
        assertEquals("¥0.00", WidgetAmountFormatter.smartFormat(0, "¥"));
        assertEquals("¥8,600.00", WidgetAmountFormatter.smartFormat(8600, "¥"));
        // 恰好低于阈值（99,999.99）→ 千位
        assertEquals("¥99,999.99", WidgetAmountFormatter.smartFormat(99999.99, "¥"));
        // 任务示例：128,650 → 12.87万（≥10 万起紧凑）
        assertEquals("¥12.87万", WidgetAmountFormatter.smartFormat(128650, "¥"));
        // 100 万 → 100.00万
        assertEquals("¥100.00万", WidgetAmountFormatter.smartFormat(1000000, "¥"));
        // 负超长（结余）
        assertEquals("-¥12.87万", WidgetAmountFormatter.smartFormat(-128650, "¥"));
    }

    @Test
    public void format_defaultCurrencyWhenMissing() {
        assertEquals("¥3,268.50", WidgetAmountFormatter.format(3268.5, null));
        assertEquals("¥3,268.50", WidgetAmountFormatter.format(3268.5, ""));
    }
}