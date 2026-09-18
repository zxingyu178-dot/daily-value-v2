package com.dailyvalue.app.autobill;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;

import com.dailyvalue.app.autobill.background.NativeCandidateQueue;

/**
 * Daily Value 2.21.0 - 后台识别完成提醒（静默 Summary 通知）。
 *
 * 无感原则：
 * - Channel IMPORTANCE_LOW：默认不响铃、不振动、不抢屏、不 Heads-up。
 * - 正文只写「识别到 N 笔待确认账单」，绝不展示金额/商户（锁屏不泄露消费信息）。
 * - 连续多次识别只维护一条 Summary（更新同一 notification id），不逐笔弹窗。
 * - 不依赖 POST_NOTIFICATIONS：通知权限未授权时静默跳过（识别与 Candidate 保存照常），
 *   下一次打开 App 仍然可见。
 * - 点击通知 → 打开 App 并携带打开自动记账审核的 Intent Extra。
 */
public final class AutoBillRecognitionNotifier {

    public static final String CHANNEL_ID = "autobill_recognition";
    public static final String EXTRA_OPEN_AUTOBILL = "open_autobill_review";
    private static final int NOTIFICATION_ID = 0xAB10;

    private AutoBillRecognitionNotifier() {
    }

    /**
     * 2.21.1：统一刷新「识别到 N 笔待确认账单」Summary 生命周期。
     * - candidateCount > 0 且 提醒开启 且 通知权限允许 → 显示/更新
     * - candidateCount == 0 → cancel（候选已全部导入，不能残留旧提醒）
     * - 提醒关闭 → cancel（即时清理已显示的通知）
     * 以下动作都必须调用本方法：新增 Native Candidate / ack / 裁剪 Queue / 关闭提醒。
     */
    public static void refresh(Context context) {
        try {
            NotificationManager nm = context.getSystemService(NotificationManager.class);
            if (nm == null) return;

            if (android.os.Build.VERSION.SDK_INT >= 26) {
                NotificationChannel channel = new NotificationChannel(
                        CHANNEL_ID,
                        "自动记账识别",
                        NotificationManager.IMPORTANCE_LOW);
                channel.setDescription("App 未打开时识别到新账单的静默提醒（不响铃不振动）");
                channel.setShowBadge(false);
                nm.createNotificationChannel(channel);
            }

            boolean noticeOn = AutoBillNativeStore.recognitionNoticeEnabled();
            int count = 0;
            NativeCandidateQueue q = AutoBillNativeStore.candidateQueue();
            if (q != null) count = q.count();

            // 取消分支：候选清空 / 提醒关闭 → 立即取消（不依赖通知权限，cancel 幂等）
            if (count <= 0 || !noticeOn) {
                nm.cancel(NOTIFICATION_ID);
                return;
            }

            // 展示分支：POST_NOTIFICATIONS 未授权（Android 13+）→ 不发提醒，识别照常进行
            if (!canPostNotifications(context)) {
                return;
            }

            Intent intent = new Intent(context, com.dailyvalue.app.MainActivity.class);
            intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            intent.putExtra(EXTRA_OPEN_AUTOBILL, true);
            PendingIntent pi = PendingIntent.getActivity(
                    context, 0, intent,
                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

            Notification.Builder builder = android.os.Build.VERSION.SDK_INT >= 26
                    ? new Notification.Builder(context, CHANNEL_ID)
                    : new Notification.Builder(context);
            Notification notification = builder
                    .setSmallIcon(android.R.drawable.stat_notify_sync)
                    .setContentTitle("每日的价值")
                    .setContentText("识别到 " + count + " 笔待确认账单")
                    .setOngoing(false)
                    .setAutoCancel(true)
                    .setContentIntent(pi)
                    .setPriority(Notification.PRIORITY_LOW)
                    .setCategory(Notification.CATEGORY_SERVICE)
                    .build();
            nm.notify(NOTIFICATION_ID, notification);
        } catch (Exception e) {
            // 通知失败静默：不影响识别与 Candidate 保存
        }
    }

    /**
     * 2.21.0 兼容别名（语义与 refresh 相同；保留原方法名避免破坏既有调用点）。
     * 新增候选后的刷新。
     */
    public static void update(Context context) {
        refresh(context);
    }

    /** 纯决策（JVM 可测）：candidateCount>0 且提醒开启 且 权限允许 → 显示 Summary */
    static boolean shouldShowSummary(int candidateCount, boolean noticeEnabled, boolean canPost) {
        return candidateCount > 0 && noticeEnabled && canPost;
    }

    /** 纯决策（JVM 可测）：候选清空 或 提醒关闭 → 取消 Summary */
    static boolean shouldCancelSummary(int candidateCount, boolean noticeEnabled) {
        return candidateCount <= 0 || !noticeEnabled;
    }

    /** Android 13+ 需要 POST_NOTIFICATIONS；未授权时静默跳过提醒（识别照常）。Plugin/设置页共用。 */
    public static boolean canPostNotifications(Context context) {
        if (android.os.Build.VERSION.SDK_INT < 33) return true;
        try {
            return android.app.NotificationManager.class
                    .getMethod("areNotificationsEnabled")
                    .invoke(context.getSystemService(Context.NOTIFICATION_SERVICE)) == Boolean.TRUE;
        } catch (Exception e) {
            return true; // 无法判断时当作可发（由系统兜底拒绝）
        }
    }
}