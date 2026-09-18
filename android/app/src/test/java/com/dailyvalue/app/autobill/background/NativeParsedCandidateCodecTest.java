package com.dailyvalue.app.autobill.background;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

import java.util.Arrays;
import java.util.List;

/**
 * Daily Value 2.21.0 - Native Candidate 编解码测试（JVM）
 * - 编解码往返一致（含转义字符 | \ 与金额小数）
 * - 损坏行/字段不足跳过，不抛错
 * - 多记录顺序稳定
 */
public class NativeParsedCandidateCodecTest {

    private NativeParsedCandidate cand(String id, String key, double amount, String merchant) {
        return new NativeParsedCandidate(id, "alipay", "com.eg.android.AlipayGphone",
                key, amount, "expense", merchant, "HIGH",
                1000L, 2000L, "abc123");
    }

    @Test
    public void roundtrip_withSpecialChars() {
        String trickyMerchant = "瑞幸|咖啡\\店";
        NativeParsedCandidate c = cand("c1", "key|1", 25.80, trickyMerchant);
        List<NativeParsedCandidate> decoded = NativeParsedCandidateCodec.decode(
                NativeParsedCandidateCodec.encode(Arrays.asList(c)));
        assertEquals(1, decoded.size());
        NativeParsedCandidate out = decoded.get(0);
        assertEquals("c1", out.id);
        assertEquals("alipay", out.source);
        assertEquals("com.eg.android.AlipayGphone", out.sourcePackage);
        assertEquals("key|1", out.notificationKey);
        assertEquals(25.80, out.amount, 0.001);
        assertEquals("expense", out.type);
        assertEquals(trickyMerchant, out.merchant);
        assertEquals("HIGH", out.confidence);
        assertEquals(1000L, out.postTime);
        assertEquals(2000L, out.capturedAt);
        assertEquals("abc123", out.rawTextHash);
    }

    @Test
    public void decode_emptyAndCorruptLines() {
        assertEquals(0, NativeParsedCandidateCodec.decode(null).size());
        assertEquals(0, NativeParsedCandidateCodec.decode("").size());
        // 字段不足 / 数字非法 → 跳过，不抛错
        assertEquals(0, NativeParsedCandidateCodec.decode("v1\nbad|line\n").size());
        assertEquals(0, NativeParsedCandidateCodec.decode("v1\nc1|x|y|z|not-a-number|expense\n").size());
    }

    @Test
    public void roundtrip_multipleRecordsOrderStable() {
        List<NativeParsedCandidate> list = Arrays.asList(
                cand("a", "k1", 12.34, "商户A"),
                cand("b", "k2", 9.99, "商户B"));
        List<NativeParsedCandidate> decoded = NativeParsedCandidateCodec.decode(
                NativeParsedCandidateCodec.encode(list));
        assertEquals(2, decoded.size());
        assertEquals("a", decoded.get(0).id);
        assertEquals("b", decoded.get(1).id);
    }

    @Test
    public void encoded_hasVersionHeader() {
        String encoded = NativeParsedCandidateCodec.encode(
                Arrays.asList(cand("a", "k1", 1.0, null)));
        assertTrue(encoded.startsWith("v" + NativeParsedCandidateCodec.VERSION + "\n"));
    }
}