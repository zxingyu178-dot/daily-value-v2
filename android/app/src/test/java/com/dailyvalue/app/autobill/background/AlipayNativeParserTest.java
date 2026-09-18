package com.dailyvalue.app.autobill.background;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/**
 * Daily Value 2.21.0 - 支付宝 Native Parser 测试（JVM）
 * NATIVE-PARSER-ALIPAY-01..：金额写法、收入方向、商户提取、噪声剔除、置信度、无金额 → null
 */
public class AlipayNativeParserTest {

    private NativeParseInput in(String title, String text) {
        return new NativeParseInput("com.eg.android.AlipayGphone", "k-" + hashCode(),
                1000L, title, text, "", "", "hash");
    }

    @Test
    public void parse_symbolYuan_amount() {
        NativeParsedCandidate c = AlipayNativeParser.parse(in("支付宝", "付款成功 你有一笔 ¥35.60 消费"));
        assertNotNull(c);
        assertEquals(35.60, c.amount, 0.001);
        assertEquals("expense", c.type);
        assertEquals("alipay", c.source);
    }

    @Test
    public void parse_numberYuan_and_numberKuai() {
        NativeParsedCandidate c1 = AlipayNativeParser.parse(in("支付宝", "你有一笔支出 25.80元 瑞幸咖啡"));
        assertNotNull(c1);
        assertEquals(25.80, c1.amount, 0.001);
        NativeParsedCandidate c2 = AlipayNativeParser.parse(in("支付宝", "你有一笔支出 16块 便利店"));
        assertNotNull(c2);
        assertEquals(16.00, c2.amount, 0.001);
    }

    @Test
    public void parse_incomeKeywords_mapToIncome() {
        NativeParsedCandidate c = AlipayNativeParser.parse(in("支付宝", "你有一笔收入 到账 ¥500.00 转账"));
        assertNotNull(c);
        assertEquals("income", c.type);
        assertEquals(500.00, c.amount, 0.001);
    }

    @Test
    public void parse_refund_isIncome() {
        NativeParsedCandidate c = AlipayNativeParser.parse(in("支付宝", "退款到账 ¥20.00 原路退回"));
        assertNotNull(c);
        assertEquals("income", c.type);
    }

    @Test
    public void parse_merchant_extracted_withSuffixStripped() {
        NativeParsedCandidate c = AlipayNativeParser.parse(in("支付宝", "您在瑞幸咖啡消费 付款成功 ¥35"));
        assertNotNull(c);
        assertEquals("瑞幸咖啡", c.merchant);
        assertEquals("HIGH", c.confidence); // 商户 + 交易锚点
    }

    @Test
    public void parse_noiseWords_notTreatAsMerchant() {
        // 积分提醒（无金额）→ null 不生成候选
        assertNull(AlipayNativeParser.parse(in("支付宝", "点击领取2个支付宝积分 查看详情")));
    }

    @Test
    public void parse_noAmount_returnsNull() {
        assertNull(AlipayNativeParser.parse(in("支付宝", "您的账单已生成，请查看")));
        assertNull(AlipayNativeParser.parse(in("", "")));
    }

    @Test
    public void parse_merchantWithoutAnchor_confidenceMEDIUM() {
        NativeParsedCandidate c = AlipayNativeParser.parse(in("支付宝", "星巴克 ¥35"));
        assertNotNull(c);
        assertEquals("星巴克", c.merchant);
        assertEquals("MEDIUM", c.confidence); // 无交易语义锚点 → MEDIUM
    }

    @Test
    public void parse_noMerchant_confidenceMEDIUM() {
        // 无中文商户片段 → 仅金额 → MEDIUM（不任意中文词 = HIGH）
        NativeParsedCandidate c = AlipayNativeParser.parse(in("支付宝", "付款成功0.01元"));
        assertNotNull(c);
        assertEquals(0.01, c.amount, 0.001);
        assertNoMerchant(c); // null 经构造器归一化为 ""（无商户）
        assertEquals("MEDIUM", c.confidence);
    }

    /** 候选存储语义：无商户 = null 归一化为 "" */
    private static void assertNoMerchant(NativeParsedCandidate c) {
        assertTrue(c.merchant == null || c.merchant.isEmpty());
    }

    @Test
    public void parse_rawTextHash_passthrough() {
        NativeParseInput input = new NativeParseInput("com.eg.android.AlipayGphone", "k1",
                1000L, "支付宝", "付款成功 25.80元 瑞幸咖啡", "", "", "expected-hash-64");
        NativeParsedCandidate c = AlipayNativeParser.parse(input);
        assertNotNull(c);
        assertEquals("expected-hash-64", c.rawTextHash); // privacy：只透传 hash
        assertEquals("k1", c.notificationKey);
        assertEquals("com.eg.android.AlipayGphone", c.sourcePackage);
    }
}