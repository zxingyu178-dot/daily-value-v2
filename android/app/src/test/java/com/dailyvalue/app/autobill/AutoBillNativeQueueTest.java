package com.dailyvalue.app.autobill;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

import java.util.Arrays;
import java.util.List;

/**
 * Daily Value - AutoBill Native Pending Queue 测试（JVM，内存 Store）
 * - 同 notificationKey upsert：只保留最新一条
 * - ack：Web 导入成功后删除对应 id
 * - 容量上限 + oldest-drop
 */
public class AutoBillNativeQueueTest {

    private static AutoBillNativeQueue.Store memStore() {
        return new AutoBillNativeQueue.Store() {
            private String s = "";

            @Override
            public String load() {
                return s;
            }

            @Override
            public void save(String content) {
                s = content;
            }
        };
    }

    private AutoBillNativeRecord rec(String id, String key, long capturedAt) {
        return new AutoBillNativeRecord(id, key, "com.tencent.mm", capturedAt - 1000, capturedAt,
                "微信支付", "付款成功 25.80元", "", "", "");
    }

    @Test
    public void upsert_sameKey_keepsSingleLatest() {
        AutoBillNativeQueue q = new AutoBillNativeQueue(memStore(), 10);
        q.upsert(rec("a1", "key-x", 1000L));
        q.upsert(rec("a2", "key-x", 3000L)); // 系统更新同一条通知 → key 不变
        assertEquals(1, q.count());
        List<AutoBillNativeRecord> pending = q.pending();
        assertEquals("a2", pending.get(0).id); // 只保留最新内容
    }

    @Test
    public void ack_removesById_only() {
        AutoBillNativeQueue q = new AutoBillNativeQueue(memStore(), 10);
        q.upsert(rec("a1", "k1", 1000L));
        q.upsert(rec("b1", "k2", 2000L));
        assertEquals(1, q.ack(Arrays.asList("a1")));
        assertEquals(1, q.count());
        assertEquals("b1", q.pending().get(0).id);
        assertEquals(0, q.ack(Arrays.asList("missing")));
    }

    @Test
    public void capacity_oldestDropped() {
        AutoBillNativeQueue q = new AutoBillNativeQueue(memStore(), 3);
        q.upsert(rec("a", "k1", 1000L));
        q.upsert(rec("b", "k2", 2000L));
        q.upsert(rec("c", "k3", 3000L));
        q.upsert(rec("d", "k4", 4000L)); // 超出 → 丢最旧 a
        List<AutoBillNativeRecord> pending = q.pending();
        assertEquals(3, pending.size());
        assertEquals("b", pending.get(0).id);
    }

    @Test
    public void persistRestoresAfterEncodeDecode() {
        AutoBillNativeQueue.Store store = memStore();
        AutoBillNativeQueue q = new AutoBillNativeQueue(store, 10);
        q.upsert(rec("a1", "k1", 1000L));
        // 重新装载（模拟 Service/进程重启）
        AutoBillNativeQueue q2 = new AutoBillNativeQueue(store, 10);
        assertEquals(1, q2.count());
        assertEquals("a1", q2.pending().get(0).id);
    }
}