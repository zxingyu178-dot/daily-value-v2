package com.dailyvalue.app;

import android.annotation.SuppressLint;
import android.content.Intent;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;

import static android.content.Context.MODE_PRIVATE;

/**
 * Daily Value v2 - 宿主 Activity
 *
 * 安全区治理（Phase 7A-Fix3 → Phase 7B-0 线程修正）：
 *   addJavascriptInterface 的方法运行在线程池/后台线程，不能直接操作 Window/View。
 *   修正：UI Thread 通过 WindowInsetsCompat listener 缓存 top/bottom primitive，
 *   getSafeArea() 只读取已缓存值；setAppearance() 转发到 runOnUiThread。
 *
 *   Phase 7B 新增 Native 能力不再使用 addJavascriptInterface，改用正式 Capacitor local plugin。
 */
public class MainActivity extends BridgeActivity {

    private float densityPx = 1f;
    private volatile int cachedTopPx = 0;
    private volatile int cachedBottomPx = 0;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Phase 7B-1：注册 WidgetBridge 本地插件（正式 Capacitor plugin，非 addJavascriptInterface）
        this.registerPlugin(WidgetBridgePlugin.class);
        // 2.14.0：注册 FileBridge 本地插件（SAF 文件保存/选择）
        this.registerPlugin(FileBridgePlugin.class);
        // 2.15.1 Gate B：注册 AutoBill 本地插件（通知使用权状态/队列/白名单同步）
        this.registerPlugin(com.dailyvalue.app.autobill.AutoBillPlugin.class);
        super.onCreate(savedInstanceState);

        // 2.21.0：后台识别静默提醒被点击 → 记录「打开后进入自动记账审核」标志（Web 读取并消费）
        handleAutobillNotificationTap(getIntent());

        // ---- Phase 7A-Fix2：首帧前 WebView 背景兜底品牌紫 ----
        WebView web = getBridge() != null ? getBridge().getWebView() : null;
        if (web != null) {
            web.setBackgroundColor(Color.parseColor("#5B67F0"));
        }

        // ---- Phase 7A-Fix3：真正的 edge-to-edge + 统一系统栏颜色 + 安全区注入桥 ----
        enableEdgeToEdge();
        applySystemBarAppearance(/* dark= */ false);
        densityPx = getResources().getDisplayMetrics().density;

        // ---- Phase 7B-0：UI Thread 缓存 insets，JavascriptInterface 只读 primitive ----
        updateCachedInsets();
        View decorView = getWindow().getDecorView();
        ViewCompat.setOnApplyWindowInsetsListener(decorView, (v, insets) -> {
            Insets s = insets.getInsets(WindowInsetsCompat.Type.statusBars());
            Insets n = insets.getInsets(WindowInsetsCompat.Type.navigationBars());
            cachedTopPx = s.top;
            cachedBottomPx = Math.max(n.bottom, n.top);
            return ViewCompat.onApplyWindowInsets(v, insets);
        });

        if (web != null) {
            web.addJavascriptInterface(new SafeAreaBridge(), "DailyValueSafeArea");
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        // 2.21.0：通知点击（CLEAR_TOP 复用本 Activity）→ 同样记录审核入口标志
        handleAutobillNotificationTap(intent);
    }

    /** 读取后台提醒通知的 Intent Extra，写入 prefs 标志（Web 启动后消费进 AutoBill 审核页）。 */
    private void handleAutobillNotificationTap(Intent intent) {
        try {
            if (intent != null && intent.getBooleanExtra(
                    com.dailyvalue.app.autobill.AutoBillRecognitionNotifier.EXTRA_OPEN_AUTOBILL, false)) {
                getSharedPreferences("autobill_prefs", MODE_PRIVATE)
                        .edit()
                        .putLong("open_autobill_review", System.currentTimeMillis())
                        .apply();
                intent.removeExtra(com.dailyvalue.app.autobill.AutoBillRecognitionNotifier.EXTRA_OPEN_AUTOBILL);
            }
        } catch (Exception ignored) {
        }
    }

    /** 启用真正的 edge-to-edge：内容绘制到状态栏与手势导航栏之下，系统栏背景透明。 */
    @SuppressLint("ObsoleteSdkInt")
    private void enableEdgeToEdge() {
        Window window = getWindow();
        WindowCompat.setDecorFitsSystemWindows(window, false);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            window.clearFlags(WindowManager.LayoutParams.FLAG_TRANSLUCENT_STATUS);
            window.clearFlags(WindowManager.LayoutParams.FLAG_TRANSLUCENT_NAVIGATION);
            window.setStatusBarColor(Color.TRANSPARENT);
            window.setNavigationBarColor(Color.TRANSPARENT);
        }
    }

    /**
     * 系统栏图标/文字颜色的明暗适配：dark=true → 深色图标（适合浅色主题）。
     * 必须在 UI Thread 调用（WindowInsetsControllerCompat 要求）。
     */
    public void applySystemBarAppearance(boolean dark) {
        Window window = getWindow();
        WindowInsetsControllerCompat c =
                WindowCompat.getInsetsController(window, window.getDecorView());
        if (c == null) return;
        c.setAppearanceLightStatusBars(dark);
        c.setAppearanceLightNavigationBars(dark);
    }

    /** UI Thread 上读取当前 WindowInsets 并缓存 primitive 值。 */
    private void updateCachedInsets() {
        try {
            View root = getWindow().getDecorView();
            WindowInsetsCompat insets = ViewCompat.getRootWindowInsets(root);
            if (insets != null) {
                Insets s = insets.getInsets(WindowInsetsCompat.Type.statusBars());
                Insets n = insets.getInsets(WindowInsetsCompat.Type.navigationBars());
                cachedTopPx = s.top;
                cachedBottomPx = Math.max(n.bottom, n.top);
            } else {
                cacheInsetsFromResources();
            }
        } catch (Throwable ignored) {
            cacheInsetsFromResources();
        }
    }

    /** API 兼容回退：从系统资源维度读取状态栏/导航栏高度。 */
    private void cacheInsetsFromResources() {
        int statusRes = getResources().getIdentifier("status_bar_height", "dimen", "android");
        if (statusRes > 0) cachedTopPx = getResources().getDimensionPixelSize(statusRes);
        int navRes = getResources().getIdentifier("navigation_bar_height", "dimen", "android");
        if (navRes > 0) cachedBottomPx = getResources().getDimensionPixelSize(navRes);
    }

    /** Web 侧经 window.DailyValueSafeArea.getSafeArea() 同步读取的桥（CSS px）。 */
    public class SafeAreaBridge {

        SafeAreaBridge() { }

        /** 返回 "top,bottom"（CSS px，已按 density 换算）。只读 volatile 缓存，不操作 View。 */
        @JavascriptInterface
        public String getSafeArea() {
            int top = Math.round(cachedTopPx / densityPx);
            int bottom = Math.round(cachedBottomPx / densityPx);
            return top + "," + bottom;
        }

        /** 随 Web 主题切换系统栏图标明暗：dark=true → 深色图标（浅色主题）。转发到 UI Thread。 */
        @JavascriptInterface
        public void setAppearance(boolean dark) {
            runOnUiThread(() -> applySystemBarAppearance(dark));
        }
    }
}
