package com.dailyvalue.app.autobill;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

import java.util.Arrays;
import java.util.Collections;
import java.util.List;

/**
 * Daily Value - AutoBill 隐私边界测试（JVM）
 * - 包名白名单判定（第一行防线）
 * - 疑似交易预过滤：聊天内容不得命中；支付文本命中
 */
public class AutoBillPrivacyTest {

    @Test
    public void allowedPackage_onlyEnabledPkgPasses() {
        // 2.17.1：改用普通测试 fixture（Native Store 2.17.0 起不维护业务来源常量）
        List<String> enabled = Arrays.asList("pkg.a", "pkg.b");
        assertTrue(AutoBillPrivacy.isAllowedPackage(enabled, "pkg.a"));
        assertTrue(AutoBillPrivacy.isAllowedPackage(enabled, "pkg.b"));
        assertEquals(false, AutoBillPrivacy.isAllowedPackage(enabled, "com.example.evil"));
        assertEquals(false, AutoBillPrivacy.isAllowedPackage(enabled, null));
        assertEquals(false, AutoBillPrivacy.isAllowedPackage(Collections.emptyList(), "pkg.a"));
    }

    @Test
    public void financialKeywordsHit_paymentText() {
        // PRIVACY-04：支付宝真实样本（交易提醒 + 支出）→ true
        assertTrue(AutoBillPrivacy.looksPossiblyFinancial("支付宝交易提醒 你有一笔0.01元的支出"));
        assertTrue(AutoBillPrivacy.looksPossiblyFinancial("你有一笔0.01元的支出"));
        // PRIVACY-05：付款成功（含星巴克商户）→ true
        assertTrue(AutoBillPrivacy.looksPossiblyFinancial("付款成功 星巴克 ¥35"));
        // PRIVACY-06：微信支付凭证结构通知 → true
        assertTrue(AutoBillPrivacy.looksPossiblyFinancial("微信支付 微信支付凭证 ¥12.34"));
        assertTrue(AutoBillPrivacy.looksPossiblyFinancial("微信支付凭证 商户A ¥12.34"));
        // 保留结构词命中：退款 / 扣款 / 到账
        assertTrue(AutoBillPrivacy.looksPossiblyFinancial("退款到账50元"));
        assertTrue(AutoBillPrivacy.looksPossiblyFinancial("微信支付 收款 8元"));
        assertTrue(AutoBillPrivacy.looksPossiblyFinancial("招商银行 扣款通知"));
    }

    @Test
    public void nonFinancialTextNotCaptured() {
        // PRIVACY-01：微信普通聊天「帮我支付20元」→ Native 预过滤 false（裸“支付”不再命中）
        assertEquals(false, AutoBillPrivacy.looksPossiblyFinancial("小红：帮我支付20元"));
        assertEquals(false, AutoBillPrivacy.looksPossiblyFinancial("帮我支付20元"));
        // PRIVACY-02：纯聊天
        assertEquals(false, AutoBillPrivacy.looksPossiblyFinancial("小红：今晚一起吃饭吗"));
        // PRIVACY-03：验证码
        assertEquals(false, AutoBillPrivacy.looksPossiblyFinancial("您有新的验证码：123456。请勿泄露。"));
        assertEquals(false, AutoBillPrivacy.looksPossiblyFinancial(""));
        assertEquals(false, AutoBillPrivacy.looksPossiblyFinancial(null));
    }
}