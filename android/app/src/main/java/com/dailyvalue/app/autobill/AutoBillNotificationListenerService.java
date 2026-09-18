package com.dailyvalue.app.autobill;

import android.app.Notification;
import android.content.ComponentName;
import android.content.Intent;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;

import com.dailyvalue.app.autobill.background.AutoBillBackgroundEngine;

/**
 * Daily Value - AutoBill 通知监听服务（2.15.1 Gate B；2.21.0 升级为后台识别引擎入口）
 *
 * 职责（2.21.0）：
 *   收到通知 → 包名白名单 → 疑似交易预过滤 → NativeParserRegistry：
 *     解析成功 → Native Candidate Queue（隐私最小化：只存 rawTextHash）+ 静默 Summary 提醒
 *     解析失败 → Raw Pending Queue（Web Parser 打开后最后尝试）
 *  App/WebView 完全关闭时本服务是唯一后台入口：识别在 Android 原生层完成，不依赖 WebView/JS。
 *  onCreate 初始化（进程被系统重建时也能工作）；onListenerDisconnected 带 30s cooldown 自恢复。
 * 隐私：包名白名单来自 Web Settings 同步；绝不落库普通聊天内容；绝不写完整支付文本日志。
 */
public class AutoBillNotificationListenerService extends NotificationListenerService {

    private static final String TAG = "AutoBill";

    /** 请求重绑的最小间隔（ms）：避免 onListenerDisconnected 高频触发导致疯狂重绑 */
    private static final long REBIND_COOLDOWN_MS = 30_000L;
    private static volatile long lastRebindRequestAt = 0L;

    /** App 内部私有事件（仅本 App 可接收；不允许其它 App 伪造）。 */
    public static final String ACTION_PENDING_CHANGED =
            "com.dailyvalue.app.autobill.PENDING_CHANGED";

    @Override
    public void onCreate() {
        super.onCreate();
        // 2.21.0：进程被系统重启时 Listener 也能在 onConnected 之前完成初始化
        AutoBillNativeStore.init(getApplicationContext());
    }

    @Override
    public void onListenerConnected() {
        super.onListenerConnected();
        AutoBillNativeStore.init(getApplicationContext());
        AutoBillNativeStore.markConnected();
    }

    @Override
    public void onListenerDisconnected() {
        super.onListenerDisconnected();
        AutoBillNativeStore.markDisconnected();
        // 2.21.0：已授权但连接异常时主动请求系统重绑（30s cooldown 防疯狂重绑）
        long now = System.currentTimeMillis();
        if (now - lastRebindRequestAt > REBIND_COOLDOWN_MS) {
            lastRebindRequestAt = now;
            try {
                ComponentName component =
                        new ComponentName(this, AutoBillNotificationListenerService.class);
                NotificationListenerService.requestRebind(component);
            } catch (Exception e) {
                android.util.Log.e(TAG, "request rebind failed", e);
            }
        }
    }

    @Override
    public void onNotificationPosted(StatusBarNotification sbn) {
        // 第一行：包名白名单（用户未开启的来源：内容不得写入任何队列）
        if (!AutoBillPrivacy.isAllowedPackage(AutoBillNativeStore.enabledPackages(), sbn.getPackageName())) {
            return;
        }
        Notification notification = sbn.getNotification();
        if (notification == null) return;

        android.os.Bundle extras = notification.extras;
        String title = extras == null ? "" : readString(extras, Notification.EXTRA_TITLE);
        String text = extras == null ? "" : readString(extras, Notification.EXTRA_TEXT);
        String bigText = extras == null ? "" : readString(extras, Notification.EXTRA_BIG_TEXT);
        String subText = extras == null ? "" : readString(extras, Notification.EXTRA_SUB_TEXT);

        // 预过滤：允许来源 + 疑似交易 才进入暂存（宁可少抓，不保存聊天内容）
        if (!AutoBillPrivacy.looksPossiblyFinancial(
                title + " " + text + " " + bigText + " " + subText)) {
            return;
        }

        long now = System.currentTimeMillis();
        AutoBillNativeRecord record = new AutoBillNativeRecord(
                now + "-" + sbn.getKey().hashCode(),
                sbn.getKey(),
                sbn.getPackageName(),
                sbn.getPostTime(),
                now,
                title,
                text,
                bigText,
                subText,
                notification.getChannelId());

        // 2.21.0：先尝试 Native 后台识别（App 完全关闭时也执行）。
        // 解析成功 → Candidate Queue（不回写 Raw，避免双队列重复）；
        // 解析失败 → Raw Pending Queue（保留给 Web Parser 最后尝试）。
        boolean parsed = AutoBillBackgroundEngine.process(record);
        if (parsed) {
            return; // Candidate 已入库，静默提醒由 engine 触发
        }
        // 2.17.2 P0：最终写 Raw Queue 前走【原子入队入口】——锁内二次读取最新 enabledPackages。
        // 只有真正入队成功（true）才广播 pendingChanged。
        if (!AutoBillNativeStore.enqueueIfEnabled(record)) {
            return;
        }
        notifyPendingChanged();
    }

    /** 广播 App 内部私有事件：Native Queue 有新内容（Web 层据此实时同步，不轮询）。 */
    private void notifyPendingChanged() {
        try {
            Intent intent = new Intent(ACTION_PENDING_CHANGED);
            // setPackage 限制仅本 App 接收，禁止被其它 App 伪造调用的公开广播
            intent.setPackage(getPackageName());
            sendBroadcast(intent);
        } catch (Exception e) {
            // 广播失败不阻塞采集（Web 下次 resume/拉取兜底）；只记录广播失败本身，绝不含支付内容
            android.util.Log.e(TAG, "pending changed broadcast failed", e);
        }
    }

    /** 安全读取 CharSequence 型 Extra（不记录完整文本日志） */
    private static String readString(android.os.Bundle extras, String key) {
        try {
            CharSequence cs = extras.getCharSequence(key);
            return cs == null ? "" : cs.toString();
        } catch (Exception e) {
            return "";
        }
    }
}