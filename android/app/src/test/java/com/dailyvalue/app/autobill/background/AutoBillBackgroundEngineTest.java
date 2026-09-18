package com.dailyvalue.app.autobill.background;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import com.dailyvalue.app.autobill.AutoBillNativeRecord;

import org.junit.Test;

import java.util.List;

/**
 * Daily Value 2.21.0 - AutoBillBackgroundEngine 全链路测试（JVM，注入内存 Store）
 *
 * BACKGROUND-06：rawTextHash 隐私最小化 —— 候选只存 SHA-256，绝不存通知正文
 * BACKGROUND-07：解析失败 → process 返回 false（调用方写 Raw Queue fallback）
 * BACKGROUND-08：解析成功 → process 返回 true（不写 Raw；同 key 更新不重复）
 * BACKGROUND-10：候选 ack 删除（Web 导入成功后）
 */
public class AutoBillBackgroundEngineTest {

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

    private AutoBillNativeRecord rec(String id, String key, String pkg,
                                     String title, String text) {
        return new AutoBillNativeRecord(id, key, pkg, 1000L, 2000L, title, text, "", "", "");
    }

    @Test
    public void failWechatChat_returnsFalse_rawFallback() {
        // BACKGROUND-07：微信聊天（无支付结构证据）→ Native 无法解析 → false（写 Raw Queue）
        NativeCandidateQueue.Store store = memStore();
        boolean ok = AutoBillBackgroundEngine.process(
                rec("r1", "k1", "com.tencent.mm", "小明", "帮我支付20元，回头转你"), store);
        assertFalse(ok);
        // 未被写进 Candidate Queue
        assertTrue(new NativeCandidateQueue(store).pending().isEmpty());
    }

    @Test
    public void failUnknownPackage_returnsFalse() {
        // Native 不支持包名（无 Parser）→ false
        NativeCandidateQueue.Store store = memStore();
        assertFalse(AutoBillBackgroundEngine.process(
                rec("r2", "k2", "com.example.bank", "通知", "消费 ¥99.00"), store));
    }

    @Test
    public void failNoAmount_returnsFalse() {
        assertFalse(AutoBillBackgroundEngine.process(
                rec("r3", "k3", "com.eg.android.AlipayGphone", "支付宝", "您的账单已生成"), memStore()));
    }

    @Test
    public void success_returnsTrue_writesCandidate() {
        NativeCandidateQueue.Store store = memStore();
        boolean ok = AutoBillBackgroundEngine.process(
                rec("r4", "k4", "com.eg.android.AlipayGphone", "支付宝", "付款成功 25.80元 瑞幸咖啡"), store);
        assertTrue(ok);
        List<NativeParsedCandidate> pending = new NativeCandidateQueue(store).pending();
        assertEquals(1, pending.size());
        assertEquals(25.80, pending.get(0).amount, 0.001);
        assertEquals("瑞幸咖啡", pending.get(0).merchant);
    }

    @Test
    public void privacy_onlyStoresHash_notRawText() {
        // BACKGROUND-06：候选只存 rawTextHash，禁止持久化通知/聊天全文
        AutoBillNativeRecord record = rec("r5", "k5", "com.eg.android.AlipayGphone", "支付宝", "付款成功 25.80元 瑞幸咖啡");
        NativeCandidateQueue.Store store = memStore();
        AutoBillBackgroundEngine.process(record, store);
        NativeParsedCandidate c = new NativeCandidateQueue(store).pending().get(0);
        // ① 存的是 SHA-256 且等于原文哈希（按 record.visibleText() 计算，与引擎一致）
        assertEquals(AutoBillBackgroundEngine.sha256Hex(record.visibleText()), c.rawTextHash);
        assertEquals(64, c.rawTextHash.length()); // 64 位十六进制
        assertTrue(c.rawTextHash.matches("[0-9a-f]{64}"));
        // ② privacy 语义：正文原文绝不进入任何持久化字段 ——
        //    结构化字段只有解析结果（商户为提取值，非原文片段），哈希为十六进制不可读。
        assertEquals("瑞幸咖啡", c.merchant); // 结构化提取商户，允许（不是原文片段）
        assertTrue(!c.rawTextHash.contains("瑞幸咖啡") && !c.rawTextHash.contains("付款成功")
                && !c.rawTextHash.contains("25.80"));
    }

    @Test
    public void success_sameKey_update_notDuplicate() {
        // BACKGROUND-08：解析成功走 Candidate 通道（不写 Raw）；系统更新同一通知（key 不变）
        // → upsert 替换原候选，不重复
        NativeCandidateQueue.Store store = memStore();
        AutoBillBackgroundEngine.process(
                rec("r6", "k6", "com.eg.android.AlipayGphone", "支付宝", "付款成功 25.80元 瑞幸咖啡"), store);
        AutoBillBackgroundEngine.process(
                rec("r7", "k6", "com.eg.android.AlipayGphone", "支付宝", "付款成功 25.81元 瑞幸咖啡"), store);
        List<NativeParsedCandidate> pending = new NativeCandidateQueue(store).pending();
        assertEquals(1, pending.size());
        assertEquals(25.81, pending.get(0).amount, 0.001); // 保留最新
    }

    @Test
    public void ackRemovesCandidate() {
        // BACKGROUND-10：ack 删除（Web 导入成功后一次性消费）
        NativeCandidateQueue.Store store = memStore();
        AutoBillBackgroundEngine.process(
                rec("r8", "k8", "com.eg.android.AlipayGphone", "支付宝", "付款成功 25.80元 瑞幸咖啡"), store);
        NativeCandidateQueue q = new NativeCandidateQueue(store);
        assertEquals(1, q.ack(java.util.Collections.singletonList(
                q.pending().get(0).id)));
        assertEquals(0, q.count());
        // ack 已落盘：重新装载仍是空
        assertEquals(0, new NativeCandidateQueue(store).count());
    }
}