package com.dailyvalue.app;

/**
 * Daily Value - Widget Snapshot V2 数据模型（2.18.0 Widget V2 Visual Refresh）
 *
 * 纯数据类（无 android.* 依赖，JVM 可测）。由 Web 侧 syncWidgetSnapshot
 * 计算 Version=2 快照写入 SharedPreferences；V1 快照（version=1/缺失）时
 * 由 WidgetSnapshotParser 填充兼容默认值。
 *
 * Theme 单一事实来源在 Web：Native 只消费计算好的
 * resolvedTheme / themeStyle / accentColor，不在 Android 复刻主题算法。
 */
public final class WidgetSnapshotData {

    /** V1 / 缺失时的视觉默认值（直至 App 打开后自然升级到 V2） */
    public static final String DEFAULT_CURRENCY = "¥";
    public static final String DEFAULT_RESOLVED_THEME = "dark";
    public static final String DEFAULT_THEME_STYLE = "classic";
    public static final String DEFAULT_ACCENT_COLOR = "#5B67F0"; // 品牌紫（Web light 基线）

    public final int version;
    public final long generatedAt;
    public final String monthKey;
    public final double monthExpense;
    public final double monthIncome;
    public final double monthBalance;
    public final String currency;
    public final String resolvedTheme;
    public final String themeStyle;
    public final String accentColor;

    /** V2 正常数据构造 */
    public WidgetSnapshotData(int version, long generatedAt, String monthKey,
                              double monthExpense, double monthIncome, double monthBalance,
                              String currency, String resolvedTheme, String themeStyle,
                              String accentColor) {
        this.version = version;
        this.generatedAt = generatedAt;
        this.monthKey = monthKey == null ? "" : monthKey;
        this.monthExpense = monthExpense;
        this.monthIncome = monthIncome;
        this.monthBalance = monthBalance;
        this.currency = currency == null || currency.isEmpty() ? DEFAULT_CURRENCY : currency;
        this.resolvedTheme = resolvedTheme == null || resolvedTheme.isEmpty()
                ? DEFAULT_RESOLVED_THEME : resolvedTheme;
        this.themeStyle = themeStyle == null || themeStyle.isEmpty()
                ? DEFAULT_THEME_STYLE : themeStyle;
        this.accentColor = accentColor == null || accentColor.isEmpty()
                ? DEFAULT_ACCENT_COLOR : accentColor;
    }
}