package com.dailyvalue.app.autobill;

import java.util.ArrayList;
import java.util.Collection;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;

/**
 * Daily Value - AutoBill 原生 Pending Queue 核心（2.15.1 Gate B）
 *
 * 纯 Java 核心（可在 JVM 单测跑）：
 * - 按 notificationKey upsert：系统更新同一通知只保留最新一条（不新增第二条）
 * - ack(ids) 删除：Web 成功导入后回调删除
 * - 容量上限 + oldest-drop：默认 200 条，超出丢弃最早（capturedAt 优先，其次 postTime）
 * - 持久化走 Store 接口（Android 实现为 App 私有文件），其它 App 不可访问
 *
 * 本类不操作 android.* API。
 */
public final class AutoBillNativeQueue {

    /** 持久化抽象：load 返回上次编码内容；save 接收编码内容（App 私有文件实现） */
    public interface Store {
        String load();
        void save(String content);
    }

    private final Store store;
    private final int capacity;
    private final List<AutoBillNativeRecord> records;

    public AutoBillNativeQueue(Store store, int capacity) {
        this.store = store;
        this.capacity = Math.max(1, capacity);
        this.records = new ArrayList<>(AutoBillNativeCodec.decode(store.load()));
    }

    /** 默认容量（规格：最多保留合理数量，例如 200 条） */
    public static final int DEFAULT_CAPACITY = 200;

    public AutoBillNativeQueue(Store store) {
        this(store, DEFAULT_CAPACITY);
    }

    /** 新通知落库：同 notificationKey → 更新原记录（保留最新内容）；否则新增（超出容量丢最旧） */
    public synchronized void upsert(AutoBillNativeRecord record) {
        int existing = -1;
        for (int i = 0; i < records.size(); i++) {
            if (records.get(i).notificationKey.equals(record.notificationKey)) {
                existing = i;
                break;
            }
        }
        if (existing >= 0) {
            records.set(existing, record); // 同 key 只保留最新一条
        } else {
            records.add(record);
        }
        trimToCapacity();
        persist();
    }

    private void trimToCapacity() {
        if (records.size() <= capacity) return;
        Collections.sort(records, Comparator
                .comparingLong((AutoBillNativeRecord r) -> r.capturedAt)
                .thenComparingLong(r -> r.postTime));
        while (records.size() > capacity) {
            records.remove(0); // 丢最旧
        }
    }

    /** 待同步记录（按捕获时间升序返回，保证 Web 处理顺序稳定；返回快照） */
    public synchronized List<AutoBillNativeRecord> pending() {
        List<AutoBillNativeRecord> copy = new ArrayList<>(records);
        Collections.sort(copy, Comparator.comparingLong(r -> r.capturedAt));
        return copy;
    }

    /** ack：Web 成功导入后删除对应 id；返回实际删除数量 */
    public synchronized int ack(Collection<String> ids) {
        if (ids == null || ids.isEmpty()) return 0;
        int removed = 0;
        for (int i = records.size() - 1; i >= 0; i--) {
            if (ids.contains(records.get(i).id)) {
                records.remove(i);
                removed++;
            }
        }
        if (removed > 0) persist();
        return removed;
    }

    public synchronized int count() {
        return records.size();
    }

    public synchronized void clear() {
        records.clear();
        persist();
    }

    private void persist() {
        store.save(AutoBillNativeCodec.encode(records));
    }
}