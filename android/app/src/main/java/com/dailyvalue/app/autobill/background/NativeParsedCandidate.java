package com.dailyvalue.app.autobill.background;

/**
 * Daily Value 2.21.0 - 后台识别候选（App 完全关闭时由 Native Parser 生成）。
 *
 * 隐私最小化：只持久化以下最小字段，禁止保存通知/聊天全文。
 * 原始正文只在内存解析阶段出现 → SHA-256 → rawTextHash → 立即丢弃。
 */
public final class NativeParsedCandidate {

    /** 本 App 侧唯一 id（ack 用） */
    public final String id;
    /** 解析来源（'alipay' | 'wechat'，与 Web Source Registry 一致） */
    public final String source;
    /** 来源包名（白名单判定唯一依赖，禁止用中文名判定） */
    public final String sourcePackage;
    /** 系统通知 key（去重第一优先级：同一通知被系统更新时 key 不变） */
    public final String notificationKey;
    /** 金额（元） */
    public final double amount;
    /** 'expense' | 'income' */
    public final String type;
    /** 商户（可空） */
    public final String merchant;
    /** 'HIGH' | 'MEDIUM' */
    public final String confidence;
    /** 系统通知发布时间（ms） */
    public final long postTime;
    /** 捕获/解析时间（ms） */
    public final long capturedAt;
    /** 原始通知文本的 SHA-256 十六进制（隐私最小化，不保存正文） */
    public final String rawTextHash;

    public NativeParsedCandidate(String id, String source, String sourcePackage,
                                 String notificationKey, double amount, String type,
                                 String merchant, String confidence,
                                 long postTime, long capturedAt, String rawTextHash) {
        this.id = id;
        this.source = source == null ? "" : source;
        this.sourcePackage = sourcePackage == null ? "" : sourcePackage;
        this.notificationKey = notificationKey == null ? "" : notificationKey;
        this.amount = amount;
        this.type = type == null ? "" : type;
        this.merchant = merchant == null ? "" : merchant;
        this.confidence = confidence == null ? "" : confidence;
        this.postTime = postTime;
        this.capturedAt = capturedAt;
        this.rawTextHash = rawTextHash == null ? "" : rawTextHash;
    }
}