package com.dailyvalue.app.autobill.background;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/**
 * Daily Value 2.21.0 - 微信 Native Parser 测试（JVM）
 * NATIVE-PARSER-WECHAT-01..：必须 PAY_STRUCTURE 证据；聊天绝不入账；收入/退款方向；商户；无金额 → null
 */
public class WechatNativeParserTest {

    private NativeParseInput in(String title, String text) {
        return new NativeParseInput("com.tencent.mm", "k-" + hashCode(),
                1000L, title, text, "", "", "hash");
    }

    @Test
    public void parse_payStructureInBody_parsed() {
        NativeParsedCandidate c = WechatNativeParser.parse(in("微信支付", "微信支付凭证 商户A ¥12.34"));
        assertNotNull(c);
        assertEquals(12.34, c.amount, 0.001);
        assertEquals("expense", c.type);
        assertEquals("商户A", c.merchant); // 中文开头允许字母数字
        assertEquals("HIGH", c.confidence); // 有商户
    }

    @Test
    public void parse_titleWechatPay_parsed() {
        // 标题精确为「微信支付」/「微信支付！」等（^微信支付(\s|$|!|！)）→ 证据成立
        NativeParsedCandidate c = WechatNativeParser.parse(in("微信支付", "支付成功 商品B 25.80元"));
        assertNotNull(c);
        assertEquals(25.80, c.amount, 0.001);
        assertEquals("expense", c.type);
        assertEquals("商品B", c.merchant);
    }

    @Test
    public void parse_chat_payMentioned_notParsed_null() {
        // ★ 关键隐私防线：普通聊天「帮我支付20元」→ 无系统结构证据 → null
        assertNull(WechatNativeParser.parse(in("小明", "帮我支付20元，回头转你")));
        assertNull(WechatNativeParser.parse(in("", "刚转了20块给你，收到没")));
        assertNull(WechatNativeParser.parse(in("", "这个月话费¥35，记得交")));
    }

    @Test
    public void parse_structureButNoAmount_null() {
        // 有证据但无金额 → null
        assertNull(WechatNativeParser.parse(in("微信支付凭证", "支付成功，暂无金额信息")));
    }

    @Test
    public void parse_incomeWords_isIncome() {
        NativeParsedCandidate c = WechatNativeParser.parse(in("微信支付", "微信收款 收款人：商户B ¥50.00"));
        assertNotNull(c);
        assertEquals("income", c.type);
    }

    @Test
    public void parse_refund_isIncome() {
        NativeParsedCandidate c = WechatNativeParser.parse(in("微信支付", "退款成功 ¥20.00 已退回原支付方式"));
        assertNotNull(c);
        assertEquals("income", c.type);
    }

    @Test
    public void parse_noMerchant_confidenceMEDIUM() {
        NativeParsedCandidate c = WechatNativeParser.parse(in("微信支付", "微信支付凭证 ¥66.00"));
        assertNotNull(c);
        assertEquals(66.00, c.amount, 0.001);
        assertNoMerchant(c); // null 经构造器归一化为 ""（无商户）
        assertEquals("MEDIUM", c.confidence);
    }

    /** 候选存储语义：无商户 = null 归一化为 "" */
    private static void assertNoMerchant(NativeParsedCandidate c) {
        assertTrue(c.merchant == null || c.merchant.isEmpty());
    }

    @Test
    public void parse_systemStructureNotIncludedInMerchant() {
        NativeParsedCandidate c = WechatNativeParser.parse(in("微信支付", "微信支付凭证 付款方：刘小姐 商户C 交易单号123 ¥45.00"));
        assertNotNull(c);
        // STRIP_WORDS 剔除后取最长的「中文开头业务段」：同等长度取先出现者
        // 系统词（微信支付凭证/付款方/交易单号）+ 金额残留（¥45.00）不得出现在商户中
        assertEquals("刘小姐", c.merchant);
    }
}