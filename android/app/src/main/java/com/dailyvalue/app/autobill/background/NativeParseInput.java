package com.dailyvalue.app.autobill.background;

/**
 * Daily Value 2.21.0 - 解析输入快照（原始通知最小字段）。
 * 只为 Native Parser 提供内存输入；Parser 解析后仅输出 Candidate（含 rawTextHash），
 * 原始文本在本类生命周期结束后不可再访问（不持久化）。
 */
public final class NativeParseInput {

    public final String packageName;
    public final String notificationKey;
    public final String title;
    public final String text;
    public final String bigText;
    public final String subText;
    public final long postTime;
    /** 通知全文的 SHA-256（由调用方计算传入；Parser 不再接触明文） */
    public final String rawTextHash;

    public NativeParseInput(String packageName, String notificationKey,
                            long postTime, String title, String text,
                            String bigText, String subText, String rawTextHash) {
        this.packageName = packageName;
        this.notificationKey = notificationKey;
        this.postTime = postTime;
        this.title = title == null ? "" : title;
        this.text = text == null ? "" : text;
        this.bigText = bigText == null ? "" : bigText;
        this.subText = subText == null ? "" : subText;
        this.rawTextHash = rawTextHash == null ? "" : rawTextHash;
    }
}