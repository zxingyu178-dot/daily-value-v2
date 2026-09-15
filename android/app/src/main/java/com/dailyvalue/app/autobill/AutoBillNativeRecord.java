package com.dailyvalue.app.autobill;

/**
 * Daily Value - AutoBill 原生通知记录（2.15.1 Gate B）
 *
 * 只保存解析所需最小字段，绝不保存 RemoteViews/图片/头像/附件/无关 Extras。
 * 由 NotificationListenerService 快照，写入私有 Pending Queue，等待 Web 层同步后 ack 删除。
 */
public final class AutoBillNativeRecord {

    /** 本 App 侧唯一 id（ack 用） */
    public final String id;
    /** 系统通知 key（同一通知被系统更新时 key 不变 → upsert 更新原记录） */
    public final String notificationKey;
    /** 来源包名（隐私白名单判定用，禁止用中文名判定） */
    public final String packageName;
    /** SDK 通知发布时间（ms） */
    public final long postTime;
    /** 捕获时间（ms） */
    public final long capturedAt;
    public final String title;
    public final String text;
    public final String bigText; // 可空
    public final String subText; // 可空
    public final String channelId; // 可空

    public AutoBillNativeRecord(String id, String notificationKey, String packageName,
                                long postTime, long capturedAt,
                                String title, String text, String bigText,
                                String subText, String channelId) {
        this.id = id;
        this.notificationKey = notificationKey;
        this.packageName = packageName;
        this.postTime = postTime;
        this.capturedAt = capturedAt;
        this.title = title == null ? "" : title;
        this.text = text == null ? "" : text;
        this.bigText = bigText == null ? "" : bigText;
        this.subText = subText == null ? "" : subText;
        this.channelId = channelId == null ? "" : channelId;
    }

    /** 拼接用于「疑似金融」预过滤的全部可见文本 */
    public String visibleText() {
        return title + " " + text + " " + bigText + " " + subText;
    }
}