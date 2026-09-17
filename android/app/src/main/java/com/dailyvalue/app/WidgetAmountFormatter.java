package com.dailyvalue.app;

import java.text.DecimalFormat;
import java.text.NumberFormat;
import java.util.Locale;

/**
 * Daily Value - Widget 金额格式化（2.18.0 Widget V2 Visual Refresh）
 *
 * 统一金额显示逻辑（不要给三个 TextView 各写一套）：
 * - 普通金额：千位分隔 + 两位小数，如 ¥3,268.50
 * - 0：¥0.00
 * - 负结余：-¥5,331.50（符号在币种前）
 * - 超长金额：Widget 显示层中文紧凑格式（≥1 万 → ¥12.87万），数据库/App 页面不变
 *
 * 币种来自 Snapshot（默认 ¥），Native 只负责显示。
 */
public final class WidgetAmountFormatter {

    private static final double WAN = 10000d;
    /** 触发紧凑显示的阈值：金额 ≥ 100,000（10 万）在 2×2 Widget 上已明显偏长 → 用「万」级紧凑显示 */
    private static final double COMPACT_THRESHOLD = 100_000d;

    private WidgetAmountFormatter() {
    }

    /**
     * 格式化普通金额（千位 + 两位小数）。currency 为展示符号（如 ¥ / $ / €）。
     * 例：3268.5 → "¥3,268.50"；0 → "¥0.00"。
     */
    public static String format(double value, String currency) {
        String sym = (currency == null || currency.isEmpty())
                ? WidgetSnapshotData.DEFAULT_CURRENCY : currency;
        DecimalFormat df = new DecimalFormat("#,##0.00");
        return sym + df.format(value);
    }

    /**
     * 格式化带符号金额（结余等可能有负值）。负值符号在币种前：
     * -5331.5 → "-¥5,331.50"；5331.5 → "¥5,331.50"。
     */
    public static String formatSigned(double value, String currency) {
        if (value < 0) {
            return "-" + format(Math.abs(value), currency);
        }
        return format(value, currency);
    }

    /**
     * 智能金额：优先紧凑（超长）还是标准（千位）。
     * 仅 Widget 显示层缩写；数据库/App 页面金额仍精确。
     * 例：128,650 → "¥12.87万"（绝对值 ≥ 10 万阈值）；
     *     -128,650 → "-¥12.87万"；3268.5 → "¥3,268.50"；0 → "¥0.00"。
     */
    public static String smartFormat(double value, String currency) {
        double abs = Math.abs(value);
        if (abs >= COMPACT_THRESHOLD) {
            String sym = safeSym(currency);
            double wan = abs / WAN;
            NumberFormat nf = NumberFormat.getNumberInstance(Locale.US);
            if (nf instanceof DecimalFormat) {
                ((DecimalFormat) nf).applyPattern("#,##0.00");
            }
            if (value < 0) {
                return "-" + sym + nf.format(wan) + "万";
            }
            return sym + nf.format(wan) + "万";
        }
        return format(value, currency);
    }

    private static String safeSym(String currency) {
        return (currency == null || currency.isEmpty())
                ? WidgetSnapshotData.DEFAULT_CURRENCY : currency;
    }
}