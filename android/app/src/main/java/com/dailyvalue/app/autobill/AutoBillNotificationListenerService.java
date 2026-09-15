package com.dailyvalue.app.autobill;

import android.app.Notification;
import android.content.Intent;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;

/**
 * Daily Value - AutoBill 通知监听服务（2.15.1 Gate B）
 *
 * 职责刻意保持最小：
 *   收到通知 → 第一行包名白名单 → 疑似交易预过滤 → 最小字段快照 → Native Pending Queue
 *
 * 不在 Service 内：操作 IndexedDB / 创建 Bill / 跑支付解析 / 调 Vue / 启动 Activity。
 * 隐私：包名白名单来自 Web Settings 同步（SharedPreferences）；微信/支付宝统一走
 *       looksPossiblyFinancial 预过滤，绝不落库普通聊天内容。输出绝不写完整支付文本日志。
 */
public class AutoBillNotificationListenerService extends NotificationListenerService {

    /** App 内部私有事件（仅本 App 可接收；不允许其它 App 伪造）。 */
    public static final String ACTION_PENDING_CHANGED =
            "com.dailyvalue.app.autobill.PENDING_CHANGED";

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
    }

    @Override
    public void onNotificationPosted(StatusBarNotification sbn) {
        // 第一行：包名白名单（用户未开启的来源：内容不得写入 Native Queue）
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

        // 同 notificationKey 由队列 upsert（系统更新的同一条通知只保留最新内容）
        AutoBillNativeStore.queue().upsert(record);
        notifyPendingChanged();
    }

    /** 广播 App 内部私有事件：Native Queue 有新内容（Web 层据此实时同步，不轮询）。 */
    private void notifyPendingChanged() {
        try {
            Intent intent = new Intent(ACTION_PENDING_CHANGED);
            // setPackage 限制仅本 App 接收，禁止被其它 App 伪造调用的公开广播
            intent.setPackage(getPackageName());
            sendBroadcast(intent);
        } catch (Exception ignored) {
            // 广播失败不阻塞采集（Web 下次 resume/拉取兜底）
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