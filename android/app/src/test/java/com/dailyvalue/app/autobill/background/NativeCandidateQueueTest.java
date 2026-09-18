package com.dailyvalue.app.autobill.background;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

import java.util.Arrays;
import java.util.Collections;
import java.util.List;

/**
 * Daily Value 2.21.0 - Native Candidate Queue 测试（JVM，内存 Store）
 * BACKGROUND-04：同 notificationKey → 更新原候选（不新增）
 * BACKGROUND-05：10 分钟近邻（source+amount±0.005+type+merchant+postTime）→ 不新增
 * BACKGROUND-02/03：持久化（encode/decode）重建恢复
 * 容量 200 + oldest-drop；ack 删除后落盘
 */
public class NativeCandidateQueueTest {

    private static NativeCandidateQueue.Store memStore() {
        return new NativeCandidateQueue.Store() {
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

    private NativeParsedCandidate cand(String id, String key, String source, String sourcePackage,
                                       double amount, String type, String merchant,
                                       long postTime, long capturedAt) {
        return new NativeParsedCandidate(id, source, sourcePackage, key, amount, type,
                merchant, "HIGH", postTime, capturedAt, "hash-" + id);
    }

    /** 微信支出 25.80（BASE_NOW 起算；不同调用 capturedAt 递增保证 pending 顺序可判） */
    private long now = 1_000_000L;

    private NativeParsedCandidate wx(String id, String key, double amount, long postTimeOffMs) {
        return cand(id, key, "wechat", "com.tencent.mm", amount, "expense", "瑞幸咖啡",
                now + postTimeOffMs, now + postTimeOffMs);
    }

    @Test
    public void upsert_sameNotificationKey_replacesNotDuplicates() {
        // BACKGROUND-04：系统更新同一通知（key 不变）→ 只保留最新一条
        NativeCandidateQueue q = new NativeCandidateQueue(memStore(), 10);
        assertTrue(q.upsert(wx("a1", "key-x", 25.80, 0)));
        assertTrue(q.upsert(wx("a2", "key-x", 25.81, 1000L))); // 内容更新 → 替换
        assertEquals(1, q.count());
        assertEquals("a2", q.pending().get(0).id);
    }

    @Test
    public void upsert_nearDuplicateWithin10Min_notAdded() {
        // BACKGROUND-05：付款成功 + 交易提醒 两条不同通知（不同 key）→ 金额/商户/去向相同且 10 分钟内
        // → 视为同一笔支付，保留先到那条，不新增
        NativeCandidateQueue q = new NativeCandidateQueue(memStore(), 10);
        assertTrue(q.upsert(wx("a1", "k1", 25.80, 0)));
        assertFalse(q.upsert(wx("a2", "k2", 25.80, 5 * 60 * 1000L))); // 5 分钟后
        assertEquals(1, q.count());
        assertEquals("a1", q.pending().get(0).id); // 保留先到
    }

    @Test
    public void upsert_nearDuplicateDifferentMerchant_orDifferentAmount_added() {
        NativeCandidateQueue q = new NativeCandidateQueue(memStore(), 10);
        assertTrue(q.upsert(wx("a1", "k1", 25.80, 0)));
        // 不同商户 → 新增
        assertTrue(q.upsert(cand("a2", "k2", "wechat", "com.tencent.mm", 25.80, "expense",
                "肯德基", now + 1000L, now + 2000L)));
        // 不同金额 → 新增
        assertTrue(q.upsert(wx("a3", "k3", 30.00, 2000L)));
        assertEquals(3, q.count());
    }

    @Test
    public void upsert_beyond10Min_sameEverything_added() {
        NativeCandidateQueue q = new NativeCandidateQueue(memStore(), 10);
        assertTrue(q.upsert(wx("a1", "k1", 25.80, 0)));
        // 11 分钟后相同的支付（新的一笔）→ 允许新增
        assertTrue(q.upsert(wx("a2", "k2", 25.80, 11 * 60 * 1000L)));
        assertEquals(2, q.count());
    }

    @Test
    public void persist_restoresAfterReload() {
        // BACKGROUND-02/03：Service / 进程重启后从磁盘恢复
        NativeCandidateQueue.Store store = memStore();
        NativeCandidateQueue q = new NativeCandidateQueue(store, 10);
        q.upsert(wx("a1", "k1", 25.80, 0));
        NativeCandidateQueue q2 = new NativeCandidateQueue(store, 10); // 重新装载
        assertEquals(1, q2.count());
        assertEquals("a1", q2.pending().get(0).id);
    }

    @Test
    public void capacity_200_oldestDropped() {
        // 容量上限 200 + oldest-drop
        NativeCandidateQueue q = new NativeCandidateQueue(memStore(), 200);
        for (int i = 0; i < 205; i++) {
            q.upsert(wx("c" + i, "k" + i, 10.0 + i, i * 1000L));
        }
        assertEquals(200, q.count());
        List<NativeParsedCandidate> pending = q.pending();
        assertEquals("c5", pending.get(0).id); // 最旧 c0..c4 被丢弃
        assertEquals("c204", pending.get(pending.size() - 1).id);
    }

    @Test
    public void ack_removesById_Persists() {
        // BACKGROUND-10：Web 导入成功后 ack 删除
        NativeCandidateQueue.Store store = memStore();
        NativeCandidateQueue q = new NativeCandidateQueue(store, 10);
        q.upsert(wx("a1", "k1", 25.80, 0));
        q.upsert(wx("b1", "k2", 12.00, 1000L));
        assertEquals(1, q.ack(Collections.singletonList("a1")));
        NativeCandidateQueue q2 = new NativeCandidateQueue(store, 10); // ack 已落盘
        assertEquals(1, q2.count());
        assertEquals("b1", q2.pending().get(0).id);
        assertEquals(0, q2.ack(Arrays.asList("missing")));
    }

    @Test
    public void pending_ordersByCapturedAtAsc() {
        NativeCandidateQueue q = new NativeCandidateQueue(memStore(), 10);
        q.upsert(wx("late", "k2", 12.00, 9000L));
        q.upsert(wx("early", "k1", 25.80, 100L));
        List<NativeParsedCandidate> pending = q.pending();
        assertEquals("early", pending.get(0).id);
        assertEquals("late", pending.get(1).id);
    }

    @Test
    public void clear_removesAll() {
        NativeCandidateQueue q = new NativeCandidateQueue(memStore(), 10);
        q.upsert(wx("a1", "k1", 25.80, 0));
        q.clear();
        assertEquals(0, q.count());
    }

    @Test
    public void retainAllowedPackages_prunesClosedSourceKeepsOpenOne() {
        // 2.21.1 AUTOBILL-CANDIDATE-PRUNE-01：微信已后台识别 → 关闭微信 → Candidate 同步裁剪
        NativeCandidateQueue q = new NativeCandidateQueue(memStore(), 10);
        q.upsert(cand("al1", "ak1", "alipay", "com.eg.android.AlipayGphone", 25.80, "expense", "瑞幸咖啡",
                now + 1000L, now + 2000L));
        q.upsert(wx("wx1", "wk1", 12.00, 3000L));

        int removed = q.retainAllowedPackages(Collections.singletonList("com.eg.android.AlipayGphone"));
        assertEquals(1, removed);
        List<NativeParsedCandidate> pending = q.pending();
        assertEquals(1, pending.size());
        assertEquals("al1", pending.get(0).id); // 支付宝候选保留
    }

    @Test
    public void retainAllowedPackages_emptyClearsAll() {
        // 2.21.1 AUTOBILL-CANDIDATE-PRUNE-02：总开关关闭（enabledPackages=[]）→ Candidate Queue 清空
        NativeCandidateQueue q = new NativeCandidateQueue(memStore(), 10);
        q.upsert(cand("al1", "ak1", "alipay", "com.eg.android.AlipayGphone", 25.80, "expense", "瑞幸咖啡",
                now + 1000L, now + 2000L));
        q.upsert(wx("wx1", "wk1", 12.00, 3000L));

        int removed = q.retainAllowedPackages(Collections.<String>emptyList());
        assertEquals(2, removed);
        assertEquals(0, q.count());
    }

    @Test
    public void retainAllowedPackages_persistsAfterPrune() {
        NativeCandidateQueue.Store store = memStore();
        NativeCandidateQueue q = new NativeCandidateQueue(store, 10);
        q.upsert(cand("al1", "ak1", "alipay", "com.eg.android.AlipayGphone", 25.80, "expense", "瑞幸咖啡",
                now + 1000L, now + 2000L));
        q.upsert(wx("wx1", "wk1", 12.00, 3000L));
        q.retainAllowedPackages(Collections.singletonList("com.eg.android.AlipayGphone"));
        // 重新装载（进程重启）：裁剪已落盘
        NativeCandidateQueue q2 = new NativeCandidateQueue(store, 10);
        assertEquals(1, q2.count());
        assertEquals("al1", q2.pending().get(0).id);
    }
}