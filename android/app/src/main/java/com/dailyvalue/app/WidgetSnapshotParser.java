package com.dailyvalue.app;

import org.json.JSONObject;

/**
 * Daily Value - Widget Snapshot 解析（2.18.0）
 *
 * 解析 Web 侧写入的 JSON 快照为 WidgetSnapshotData：
 * - version=2：读取全部字段（currency / resolvedTheme / themeStyle / accentColor）
 * - version=1 / version 缺失：使用兼容默认值（dark / classic / 品牌紫 / ¥）
 * - 损坏 JSON：不崩溃，返回 null（Provider 显示空状态）
 *
 * 纯解析（不依赖 android.*），JVM 可测。
 */
public final class WidgetSnapshotParser {

    private WidgetSnapshotParser() {
    }

    public static WidgetSnapshotData parse(String json) {
        if (json == null || json.trim().isEmpty()) {
            return null;
        }
        try {
            JSONObject snap = new JSONObject(json);
            int version = snap.optInt("version", 1);
            double expense = snap.optDouble("monthExpense", 0);
            double income = snap.optDouble("monthIncome", 0);
            double balance = snap.has("monthBalance")
                    ? snap.optDouble("monthBalance", income - expense)
                    : income - expense;

            return new WidgetSnapshotData(
                    version,
                    snap.optLong("generatedAt", 0L),
                    snap.optString("monthKey", ""),
                    expense,
                    income,
                    balance,
                    version >= 2 ? snap.optString("currency", WidgetSnapshotData.DEFAULT_CURRENCY)
                            : WidgetSnapshotData.DEFAULT_CURRENCY,
                    version >= 2 ? snap.optString("resolvedTheme", WidgetSnapshotData.DEFAULT_RESOLVED_THEME)
                            : WidgetSnapshotData.DEFAULT_RESOLVED_THEME,
                    version >= 2 ? snap.optString("themeStyle", WidgetSnapshotData.DEFAULT_THEME_STYLE)
                            : WidgetSnapshotData.DEFAULT_THEME_STYLE,
                    version >= 2 ? snap.optString("accentColor", WidgetSnapshotData.DEFAULT_ACCENT_COLOR)
                            : WidgetSnapshotData.DEFAULT_ACCENT_COLOR
            );
        } catch (Exception e) {
            // 损坏 JSON：不崩溃（Provider 显示空状态）
            return null;
        }
    }
}