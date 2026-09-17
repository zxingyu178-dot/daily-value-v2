package com.dailyvalue.app.autobill;

import android.content.Context;
import android.content.SharedPreferences;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * Daily Value - AutoBill 原生状态与队列引导（2.15.1 Gate B）
 *
 * 单例引导：Service 与 Capacitor Plugin 共用同一队列实例与同一份配置。
 * - 队列持久化：App 私有文件（getFilesDir，其它 App 不可访问）
 * - Enabled Packages：SharedPreferences（Web Settings 同步写入）
 * - 连接状态：onListenerConnected/Disconnected 写入（Plugin 读取）
 */
public final class AutoBillNativeStore {

    private static final String PREFS = "autobill_prefs";
    private static final String KEY_ENABLED_PACKAGES = "enabled_packages";
    private static final String KEY_CONNECTED = "listener_connected";
    private static final String KEY_LAST_CONNECTED_AT = "listener_last_connected_at";
    private static final String QUEUE_FILE = "autobill_pending.queue";

    private static volatile AutoBillNativeQueue queue;
    private static volatile Context appContext;

    /**
     * 2.17.2 P0：白名单替换 与 Listener 入队 共用同一把锁，消除竞态窗口。
     * - setEnabledPackagesAndPrune：锁内更新白名单 + 裁剪 Queue（原子）
     * - enqueueIfEnabled：锁内二次读取白名单 + upsert（原子）
     * 这样「Listener 已通过首层白名单检查，但用户同时关闭来源」时，
     * 最终入队阶段会基于最新白名单拒绝写回。
     */
    private static final Object STATE_LOCK = new Object();

    private AutoBillNativeStore() {
    }

    public static synchronized void init(Context context) {
        if (appContext == null) {
            appContext = context.getApplicationContext();
        }
        if (queue == null) {
            queue = new AutoBillNativeQueue(new AutoBillNativeQueue.Store() {
                @Override
                public String load() {
                    File f = new File(appContext.getFilesDir(), QUEUE_FILE);
                    try (FileInputStream in = new FileInputStream(f)) {
                        byte[] buf = new byte[in.available()];
                        int n = in.read(buf);
                        return n > 0 ? new String(buf, 0, n, StandardCharsets.UTF_8) : "";
                    } catch (Exception e) {
                        return "";
                    }
                }

                @Override
                public void save(String content) {
                    File f = new File(appContext.getFilesDir(), QUEUE_FILE);
                    try (FileOutputStream out = new FileOutputStream(f)) {
                        out.write(content.getBytes(StandardCharsets.UTF_8));
                    } catch (Exception e) {
                        // 写入失败静默：下次仍可重试，不抛给调用链
                    }
                }
            });
        }
    }

    public static AutoBillNativeQueue queue() {
        if (queue == null) throw new IllegalStateException("AutoBillNativeStore.init not called");
        return queue;
    }

    /* ---- Enabled Packages（2.17.0：只认 Web 同步来的 packageName；不维护业务来源默认值） ----
 * 取消原 PKG_ALIPAY / PKG_WECHAT / DEFAULT_PACKAGES：
 * Native 不理解「支付宝/微信/银行」，业务来源定义唯一在 Web Source Registry；
 * 新安装/未同步时 enabledPackages = 空（autoBillEnabled 默认本就是 false）。
 */

    public static Set<String> enabledPackages() {
        SharedPreferences sp = prefs();
        if (sp == null) return new HashSet<>();
        return new HashSet<>(sp.getStringSet(KEY_ENABLED_PACKAGES, Collections.<String>emptySet()));
    }

    /** Web 同步：把用户开启的来源包名写入原生配置（空集合 = 停止采集） */
    public static void setEnabledPackages(Collection<String> packageNames) {
        SharedPreferences sp = prefs();
        if (sp == null) return;
        Set<String> set = new HashSet<>(packageNames == null ? Collections.<String>emptyList() : packageNames);
        sp.edit().putStringSet(KEY_ENABLED_PACKAGES, set).apply();
    }

    /**
     * 2.17.2 P0：原子替换白名单 + 裁剪 Queue。
     * 同一把锁内完成：写新 enabledPackages → Queue.retainAllowedPackages(new)。
     * 关闭单个来源（如微信）时，该来源旧记录立即从 Queue 移除；空集合 = 全部清除。
     * 替代旧「setEnabledPackages + if empty clear」的两步模式（不完整处理单来源关闭场景）。
     */
    public static void setEnabledPackagesAndPrune(Collection<String> packageNames) {
        synchronized (STATE_LOCK) {
            setEnabledPackages(packageNames);
            if (queue != null) {
                queue.retainAllowedPackages(packageNames);
            }
        }
    }

    /**
     * 2.17.2 P0：原子入队入口（Listener 最终写 Queue 前必须调用）。
     * 锁内：① 重新读取【最新】enabledPackages ② 包名仍允许 → upsert 并返回 true；
     * 否则拒绝写回并返回 false。
     * 消除竞态：即使 Listener 首层白名单检查通过后用户刚关闭该来源，
     * 最终入队阶段也基于最新白名单判定，杜绝「关闭以后重新写回」。
     * 只有返回 true 才允许通知 pendingChanged。
     */
    public static boolean enqueueIfEnabled(AutoBillNativeRecord record) {
        synchronized (STATE_LOCK) {
            if (!AutoBillPrivacy.isAllowedPackage(enabledPackages(), record.packageName)) {
                return false;
            }
            queue.upsert(record);
            return true;
        }
    }

    /* ---- 连接状态 ---- */

    public static void markConnected() {
        SharedPreferences sp = prefs();
        if (sp == null) return;
        sp.edit().putBoolean(KEY_CONNECTED, true).putLong(KEY_LAST_CONNECTED_AT, System.currentTimeMillis()).apply();
    }

    public static void markDisconnected() {
        SharedPreferences sp = prefs();
        if (sp == null) return;
        sp.edit().putBoolean(KEY_CONNECTED, false).apply();
    }

    public static boolean isConnected() {
        SharedPreferences sp = prefs();
        return sp != null && sp.getBoolean(KEY_CONNECTED, false);
    }

    public static long lastConnectedAt() {
        SharedPreferences sp = prefs();
        return sp != null ? sp.getLong(KEY_LAST_CONNECTED_AT, 0L) : 0L;
    }

    private static SharedPreferences prefs() {
        return appContext != null ? appContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE) : null;
    }
}