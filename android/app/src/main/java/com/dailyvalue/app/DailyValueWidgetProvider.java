package com.dailyvalue.app;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.text.TextUtils;
import android.util.Log;
import android.util.TypedValue;
import android.widget.RemoteViews;

import java.util.Calendar;
import java.util.Locale;

/**
 * Daily Value v2 - 桌面 Widget Provider（Phase 7B-1 / 2.18.0 Widget V2 Visual Refresh）
 *
 * 信息 Widget：从 SharedPreferences（daily_value_widget）读取 Web 侧 syncWidgetSnapshot
 * 写入的月度摘要，渲染 RemoteViews。解析 / 金额格式化 / 主题选择分别由
 * {@link WidgetSnapshotParser} / {@link WidgetAmountFormatter} / {@link WidgetThemeResolver}
 * 负责（职责分离，JVM 可单测）。无 Snapshot 或 JSON 损坏时显示简洁空状态。
 *
 * 2.18.0 Widget V2：
 * - 快照 Version=2（currency / resolvedTheme / themeStyle / accentColor）；V1/缺失走
 *   WidgetSnapshotData 兼容默认值（dark / classic / 品牌紫 / ¥），首次打开 App 后自然升级。
 * - 跟随 Web Theme：背景（浅/深/Glass-like 半透明）、文字、Accent 由
 *   WidgetThemeResolver.derive 派生；支出固定绿、收入固定红、结余中性。
 * - 金额显示统一走 WidgetAmountFormatter（千位 / 零 / 负 / 超长紧凑万），币种来自 Snapshot。
 *
 * 整个 Widget 点击 → 打开 MainActivity → /accounting。不启动隐藏 WebView，不直接读 IndexedDB。
 */
public class DailyValueWidgetProvider extends AppWidgetProvider {

    private static final String TAG = "DVWidget";
    private static final String PREFS_NAME = "daily_value_widget";
    private static final String KEY_SNAPSHOT = "snapshot";

    @Override
    public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
        for (int id : appWidgetIds) {
            renderWidget(context, appWidgetManager, id);
        }
    }

    @Override
    public void onAppWidgetOptionsChanged(Context context, AppWidgetManager appWidgetManager,
                                          int appWidgetId, android.os.Bundle newOptions) {
        renderWidget(context, appWidgetManager, appWidgetId);
    }

    /**
     * 外部（WidgetBridgePlugin）刷新所有 Widget 实例。
     */
    static void updateWidgets(Context context, AppWidgetManager mgr, int[] ids) {
        for (int id : ids) {
            renderWidget(context, mgr, id);
        }
    }

    private static void renderWidget(Context context, AppWidgetManager mgr, int widgetId) {
        RemoteViews views = buildViews(context, mgr, widgetId);
        if (views != null) {
            mgr.updateAppWidget(widgetId, views);
        }
    }

    private static RemoteViews buildViews(Context context, AppWidgetManager mgr, int widgetId) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        String json = prefs.getString(KEY_SNAPSHOT, null);

        boolean wide = isWideLayout(context, mgr, widgetId);
        int layoutRes = wide
                ? R.layout.widget_daily_value_wide
                : R.layout.widget_daily_value;

        RemoteViews views = new RemoteViews(context.getPackageName(), layoutRes);

        // 快照解析（V2 / V1 fallback / 损坏 → null）
        WidgetSnapshotData snap = WidgetSnapshotParser.parse(json);

        // 主题 palette（V1 或无快照也用默认 dark/classic/品牌紫，保证不崩）
        String resolvedTheme = snap != null ? snap.resolvedTheme : WidgetSnapshotData.DEFAULT_RESOLVED_THEME;
        WidgetThemeResolver.Palette pal = WidgetThemeResolver.derive(
                resolvedTheme,
                snap != null ? snap.themeStyle : WidgetSnapshotData.DEFAULT_THEME_STYLE,
                snap != null ? snap.accentColor : WidgetSnapshotData.DEFAULT_ACCENT_COLOR);

        applyTheme(context, views, pal, WidgetThemeResolver.isDark(resolvedTheme));

        if (snap == null) {
            renderEmptyState(views);
            setClickIntent(context, views);
            return views;
        }

        String currency = snap.currency; // 默认 ¥（WidgetSnapshotData 已兜底）
        String monthKey = snap.monthKey == null ? "" : snap.monthKey;
        double expense = snap.monthExpense;
        double income = snap.monthIncome;
        double balance = snap.monthBalance;

        // 过期月份保护：monthKey 与设备当前年月不一致 → 显示 yyyy/MM 或 "MM月"，不冒充"本月支出"
        boolean isCurrentMonth = !monthKey.isEmpty() && monthKey.equals(currentMonthKey());
        String monthLabel = isCurrentMonth ? "本月支出"
                : (monthKey.isEmpty() ? "支出" : monthKey + " 支出");
        views.setTextViewText(R.id.widget_month_label, monthLabel);

        // 月份短标签（右顶）：当月 → "9月"；过期 → "2026/08"（导入式）
        views.setTextViewText(R.id.widget_month, shortMonthLabel(monthKey, isCurrentMonth));

        // 支出 = 绿色固定语义；金额统一 formatter（千位/零/负/超长紧凑万）
        String expenseText = WidgetAmountFormatter.smartFormat(expense, currency);
        views.setTextViewText(R.id.widget_amount, expenseText);
        applyAmountTextSize(views, wide, expenseText);

        views.setTextViewText(R.id.widget_income, WidgetAmountFormatter.smartFormat(income, currency));
        views.setTextViewText(R.id.widget_balance, WidgetAmountFormatter.formatSigned(balance, currency));

        setClickIntent(context, views);
        return views;
    }

    /** 2.18.0：应用主题 palette 到 RemoteViews（背景选择 + 文字颜色 + Accent 月份色） */
    private static void applyTheme(Context context, RemoteViews views,
                                   WidgetThemeResolver.Palette pal, boolean dark) {
        boolean glass = pal.border != 0x00000000;
        int bgRes;
        if (glass) {
            bgRes = dark ? R.drawable.widget_bg_glass_dark : R.drawable.widget_bg_glass_light;
        } else {
            bgRes = dark ? R.drawable.widget_bg_dark : R.drawable.widget_bg_light;
        }
        views.setInt(R.id.widget_root, "setBackgroundResource", bgRes);

        views.setTextColor(R.id.widget_title, pal.title);
        views.setTextColor(R.id.widget_month, pal.accent);          // 月份 = 主题 Accent
        views.setTextColor(R.id.widget_month_label, pal.textSecondary);
        views.setTextColor(R.id.widget_amount, pal.expense);        // 支出绿（固定语义）
        views.setTextColor(R.id.widget_income, pal.income);         // 收入红（固定语义）
        views.setTextColor(R.id.widget_balance, pal.balance);       // 结余中性
    }

    /** 2.18.0：简洁空状态（不再显示"— / 打开App完成同步"工程文案） */
    private static void renderEmptyState(RemoteViews views) {
        views.setTextViewText(R.id.widget_title, "每日的价值");
        views.setTextViewText(R.id.widget_month, "");
        views.setTextViewText(R.id.widget_month_label, "暂无数据");
        views.setTextViewText(R.id.widget_amount, "打开 DailyValue 同步");
        views.setTextViewText(R.id.widget_income, "");
        views.setTextViewText(R.id.widget_balance, "");
    }

    private static String shortMonthLabel(String monthKey, boolean isCurrent) {
        if (isCurrent) {
            // 当月：取月份数字 → "9月"
            try {
                int m = Integer.parseInt(monthKey.substring(5, 7));
                return m + "月";
            } catch (Exception e) {
                return "";
            }
        }
        // 过期月份：直接显示 yyyy/MM（如 2026/08），避免误导为当月
        return monthKey.isEmpty() ? "" : monthKey.replace("-", "/");
    }

    private static void setClickIntent(Context context, RemoteViews views) {
        Intent intent = new Intent(context, MainActivity.class);
        intent.setAction(Intent.ACTION_MAIN);
        intent.addCategory(Intent.CATEGORY_LAUNCHER);
        intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);

        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            flags |= PendingIntent.FLAG_IMMUTABLE;
        }
        PendingIntent pi = PendingIntent.getActivity(context, 0, intent, flags);
        views.setOnClickPendingIntent(R.id.widget_root, pi);
    }

    /**
     * 根据 Widget 当前占用宽度判断使用紧凑(2×2)还是展开(4×2)布局。
     * 只使用 MIN_WIDTH 作为当前宽度（AOSP Launcher 在缩放提交后写入）。
     */
    private static boolean isWideLayout(Context context, AppWidgetManager mgr, int widgetId) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.JELLY_BEAN) return false;
        try {
            android.os.Bundle opts = mgr.getAppWidgetOptions(widgetId);
            int minWidth = opts.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 0);
            int maxWidth = opts.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_WIDTH, 0);
            int useWidth = minWidth > 0 ? minWidth : maxWidth;
            Log.d(TAG, "widget options minW=" + minWidth + " maxW=" + maxWidth + " wide=" + useWidth);
            if (useWidth <= 0) return false;
            // 250dp 以上视为宽布局（约 4×2）
            return dpToPx(context, useWidth) >= dpToPx(context, 250);
        } catch (Exception e) {
            return false;
        }
    }

    private static int dpToPx(Context context, int dp) {
        return Math.round(TypedValue.applyDimension(
                TypedValue.COMPLEX_UNIT_DIP, dp,
                context.getResources().getDisplayMetrics()));
    }

    /**
     * 长金额适度缩小字号，避免超出 Widget。仅按金额文本长度做简单分段分级。
     * （紧凑万以内的金额一般不需要；超长仍兜底缩字号。）
     */
    private static void applyAmountTextSize(RemoteViews views, boolean wide, String text) {
        int maxSize = wide ? 24 : 26;
        int len = text.length();
        int size = maxSize;
        if (len >= 10) size = maxSize - 5; // ≥10 位：约 ¥123456.78 起
        if (len >= 12) size = maxSize - 9; // ≥12 位：约 ¥12345678.90 起
        if (size < 13) size = 13;          // 下限，保证可读
        views.setTextViewTextSize(R.id.widget_amount, TypedValue.COMPLEX_UNIT_SP, size);
    }

    /**
     * 设备当前本地年月（yyyy-MM），用于判断 snapshot 是否属于当月。
     */
    private static String currentMonthKey() {
        Calendar cal = Calendar.getInstance();
        return String.format(Locale.US, "%04d-%02d",
                cal.get(Calendar.YEAR), cal.get(Calendar.MONTH) + 1);
    }
}