package com.dailyvalue.app.autobill.background;

import com.dailyvalue.app.autobill.AutoBillNativeRecord;
import com.dailyvalue.app.autobill.AutoBillNativeStore;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;

/**
 * Daily Value 2.21.0 - AutoBill Background Engine。
 *
 * App/WebView 完全不运行时由 NotificationListenerService 触发：
 *   通知 → NativeParserRegistry →
 *     解析成功 → Native Candidate Queue（隐私最小化，只存 rawTextHash）+ 静默提醒
 *     解析失败 → Raw Pending Queue（Web Parser 打开后最后一次尝试）
 *
 * 原始通知正文只在内存中出现 → SHA-256 → 丢弃，不进入任何持久化存储。
 */
public final class AutoBillBackgroundEngine {

    private AutoBillBackgroundEngine() {
    }

    /**
     * 处理一条已通过白名单/隐私过滤的通知。
     * @return true = 已在 Native 解析成功并写入 Candidate Queue；false = 无法解析（调用方写 Raw Queue）
     */
    public static boolean process(AutoBillNativeRecord record) {
        return process(record, null);
    }

    /**
     * 可注入持久化入口（JVM 单测无 Android Context 时传入纯 Java 内存 Store；null = 使用
     * AutoBillNativeStore 的 App 私有文件）。业务逻辑与 process(record) 完全一致。
     */
    public static boolean process(AutoBillNativeRecord record, NativeCandidateQueue.Store storeOverride) {
        String rawTextHash = sha256Hex(record.visibleText());
        NativeParseInput input = new NativeParseInput(
                record.packageName,
                record.notificationKey,
                record.postTime,
                record.title,
                record.text,
                record.bigText,
                record.subText,
                rawTextHash);
        NativeParsedCandidate candidate = NativeParserRegistry.parse(input);
        if (candidate == null) {
            return false;
        }
        NativeCandidateQueue queue = storeOverride != null
                ? new NativeCandidateQueue(storeOverride)
                : AutoBillNativeStore.candidateQueue();
        boolean accepted = queue.upsert(candidate);
        if (accepted && storeOverride == null) {
            // 注入 Store（测试）时不触发 Android 通知/广播；正式链路才刷新静默提醒
            AutoBillNativeStore.notifyRecognitionChanged();
        }
        return true;
    }

    /** SHA-256 十六进制（隐私最小化：候选只存 hash，不存正文） */
    public static String sha256Hex(String text) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] digest = md.digest(text.getBytes(StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder(digest.length * 2);
            for (byte b : digest) {
                sb.append(Character.forDigit((b >> 4) & 0xf, 16)).append(Character.forDigit(b & 0xf, 16));
            }
            return sb.toString();
        } catch (Exception e) {
            return "";
        }
    }
}