package com.dailyvalue.app;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.res.Resources;
import android.os.Build;
import android.text.TextUtils;
import android.util.Log;
import android.util.TypedValue;
import android.widget.RemoteViews;

import org.json.JSONObject;

import java.util.Calendar;
import java.util.Locale;

/**
 * Daily Value v2 - 桌面 Widget Provider（Phase 7B-1）
 *
 * 信息 Widget：从 SharedPreferences（daily_value_widget）读取 Web 侧 syncWidgetSnapshot
 * 写入的月度摘要，渲染 RemoteViews。无 Snapshot 时显示"打开 App 完成同步"。
 *
 * 整个 Widget 点击 → 打开 MainActivity → /accounting。
 * 不启动隐藏 WebView，不直接读 IndexedDB。
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

        if (TextUtils.isEmpty(json)) {
            views.setTextViewText(R.id.widget_amount, "—");
            views.setTextViewText(R.id.widget_expense, "打开App完成同步");
            views.setTextViewText(R.id.widget_income, "");
            views.setTextViewText(R.id.widget_balance, "");
            setClickIntent(context, views);
            return views;
        }

        try {
            JSONObject snap = new JSONObject(json);
            double expense = snap.optDouble("monthExpense", 0);
            double income = snap.optDouble("monthIncome", 0);
            double balance = income - expense;
            String monthKey = snap.optString("monthKey", "");

            // 过期快照：monthKey 与设备当前本地年月不一致时，不把旧数据标成"本月支出"（Phase 7B-Final）
            boolean isCurrentMonth = !monthKey.isEmpty() && monthKey.equals(currentMonthKey());
            String monthLabel = isCurrentMonth ? "本月支出"
                    : (monthKey.isEmpty() ? "支出" : monthKey + " 支出");
            views.setTextViewText(R.id.widget_month_label, monthLabel);

            views.setTextViewText(R.id.widget_amount, formatAmount(expense));
            applyAmountTextSize(views, wide, formatAmount(expense));
            views.setTextViewText(R.id.widget_expense, "支出 " + formatAmount(expense));

            if (wide) {
                views.setTextViewText(R.id.widget_income, "收入 " + formatAmount(income));
                views.setTextViewText(R.id.widget_balance, "结余 " + formatSigned(balance));
            } else {
                views.setTextViewText(R.id.widget_income, "收入 " + formatAmount(income));
                views.setTextViewText(R.id.widget_balance, "结余 " + formatSigned(balance));
            }
        } catch (Exception e) {
            Log.w(TAG, "parse snapshot failed", e);
            views.setTextViewText(R.id.widget_amount, "—");
            views.setTextViewText(R.id.widget_expense, "打开App完成同步");
            views.setTextViewText(R.id.widget_income, "");
            views.setTextViewText(R.id.widget_balance, "");
        }

        setClickIntent(context, views);
        return views;
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
     *
     * AOSP Launcher 在放置/缩放提交后会把当前跨度写入 OPTION_APPWIDGET_MIN_WIDTH。
     * 注意不能取 max(min, max)：部分 Launcher 的 MAX_WIDTH 表示"可展开到的最宽"（而非当前宽度），
     * 会导致 2×2 被误判为 wide（Phase 7B-Final 修复）。故仅用 MIN_WIDTH 作为当前宽度。
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

    private static String formatAmount(double v) {
        // 与主 App 记账金额一致：固定两位小数（¥316.10 / ¥0.00）
        return "¥" + String.format(Locale.US, "%.2f", v);
    }

    /**
     * 长金额适度缩小字号，避免超出 Widget（Phase 7B-Final）。
     * 仅按金额文本长度做简单分段，不引入复杂自动排版。
     * 例：¥0.00(5) / ¥316.10(8) 正常，¥1234567.89(11) 适度缩小。
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

    private static String formatSigned(double v) {
        return (v < 0 ? "-¥" : "¥") + String.format(Locale.US, "%.2f", Math.abs(v));
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
