package com.dailyvalue.app.autobill.background;

import java.util.ArrayList;
import java.util.Collection;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;

/**
 * Daily Value 2.21.0 - Native Candidate Queue（App 完全关闭时后台识别结果的持久化队列）。
 *
 * 纯 Java 核心（JVM 单测可跑）：
 * - 容量 200 + oldest-drop（与 Raw Queue 一致）。
 * - 去重第一层：notificationKey 相同 → 更新原候选（系统更新同一通知只保留最新一条）。
 * - 去重第二层：近邻窗口（source + amount±0.005 + type + merchant 相同，且两条
 *   postTime 差 <= 10 分钟）→ 视为同一次支付的重复通知（付款成功 + 交易提醒），
 *   不新增（保留先到的那条）。杜绝「付款成功/交易提醒」生成两条后台候选。
 * - ack(ids) 删除；pending() 按 capturedAt 升序快照。
 */
public final class NativeCandidateQueue {

    public interface Store {
        String load();
        void save(String content);
    }

    /** 近邻去重时间窗口（ms）：10 分钟 */
    public static final long DUP_WINDOW_MS = 10 * 60 * 1000L;
    public static final int DEFAULT_CAPACITY = 200;

    private final Store store;
    private final int capacity;
    private final List<NativeParsedCandidate> items;

    public NativeCandidateQueue(Store store, int capacity) {
        this.store = store;
        this.capacity = Math.max(1, capacity);
        this.items = new ArrayList<>(NativeParsedCandidateCodec.decode(store.load()));
    }

    public NativeCandidateQueue(Store store) {
        this(store, DEFAULT_CAPACITY);
    }

    /** 相同金额（两位小数语义 ±0.005） */
    private static boolean sameAmount(double a, double b) {
        return Math.abs(a - b) < 0.005;
    }

    /** 第二层近邻命中：source/amount/type/merchant 相同 + postTime 窗口 10 分钟 */
    private boolean isNearDuplicate(NativeParsedCandidate c, NativeParsedCandidate existing) {
        if (!c.source.equals(existing.source)) return false;
        if (!sameAmount(c.amount, existing.amount)) return false;
        if (!c.type.equals(existing.type)) return false;
        if (!safeEquals(c.merchant, existing.merchant)) return false;
        return Math.abs(c.postTime - existing.postTime) <= DUP_WINDOW_MS;
    }

    private static boolean safeEquals(String a, String b) {
        if (a == null && b == null) return true;
        if (a == null || b == null) return false;
        return a.equals(b);
    }

    /**
     * 新候选落库：
     * 1. 同 notificationKey → 更新原候选（同一通知只保留最新一条）；
     * 2. 命中 10 分钟近邻 → 不新增（保存先到的那条，返回 false 表示被去重）；
     * 3. 否则新增；超出容量丢最旧。
     */
    public synchronized boolean upsert(NativeParsedCandidate candidate) {
        int keyIdx = -1;
        for (int i = 0; i < items.size(); i++) {
            if (candidate.notificationKey.equals(items.get(i).notificationKey)) {
                keyIdx = i;
                break;
            }
        }
        if (keyIdx >= 0) {
            items.set(keyIdx, candidate);
            persist();
            return true;
        }
        for (NativeParsedCandidate existing : items) {
            if (isNearDuplicate(candidate, existing)) {
                return false; // 同一支付的重复通知：不新增
            }
        }
        items.add(candidate);
        trimToCapacity();
        persist();
        return true;
    }

    private void trimToCapacity() {
        if (items.size() <= capacity) return;
        Collections.sort(items, Comparator
                .comparingLong((NativeParsedCandidate c) -> c.capturedAt)
                .thenComparingLong(c -> c.postTime));
        while (items.size() > capacity) items.remove(0);
    }

    public synchronized List<NativeParsedCandidate> pending() {
        List<NativeParsedCandidate> copy = new ArrayList<>(items);
        Collections.sort(copy, Comparator.comparingLong(c -> c.capturedAt));
        return copy;
    }

    public synchronized int ack(Collection<String> ids) {
        if (ids == null || ids.isEmpty()) return 0;
        int removed = 0;
        for (int i = items.size() - 1; i >= 0; i--) {
            if (ids.contains(items.get(i).id)) {
                items.remove(i);
                removed++;
            }
        }
        if (removed > 0) persist();
        return removed;
    }

    public synchronized int count() {
        return items.size();
    }

    /**
     * 2.21.1：按允许来源包名裁剪（Web 同步 enabledPackages 时调用；与 Raw Queue 同语义）。
     * - 关闭单个来源 → 该来源已后台解析出的候选立即移除（防止重新开启后再被导入的「幽灵候选」）；
     * - 空集合（总开关关闭）→ 清空。已导入 IndexedDB 的候选与正式 Bill 由 Web 层管理，这里不动。
     * @return 移除的候选数
     */
    public synchronized int retainAllowedPackages(Collection<String> allowedPackages) {
        if (allowedPackages == null || allowedPackages.isEmpty()) {
            int n = items.size();
            if (n > 0) {
                items.clear();
                persist();
            }
            return n;
        }
        java.util.Set<String> allowed = new java.util.HashSet<>(allowedPackages);
        int removed = 0;
        for (int i = items.size() - 1; i >= 0; i--) {
            if (!allowed.contains(items.get(i).sourcePackage)) {
                items.remove(i);
                removed++;
            }
        }
        if (removed > 0) persist();
        return removed;
    }

    public synchronized void clear() {
        items.clear();
        persist();
    }

    private void persist() {
        store.save(NativeParsedCandidateCodec.encode(items));
    }
}