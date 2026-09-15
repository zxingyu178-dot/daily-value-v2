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
        List<String> enabled = Arrays.asList(
                AutoBillNativeStore.PKG_ALIPAY, AutoBillNativeStore.PKG_WECHAT);
        assertTrue(AutoBillPrivacy.isAllowedPackage(enabled, AutoBillNativeStore.PKG_ALIPAY));
        assertTrue(AutoBillPrivacy.isAllowedPackage(enabled, AutoBillNativeStore.PKG_WECHAT));
        assertEquals(false, AutoBillPrivacy.isAllowedPackage(enabled, "com.example.evil"));
        assertEquals(false, AutoBillPrivacy.isAllowedPackage(enabled, null));
        assertEquals(false, AutoBillPrivacy.isAllowedPackage(Collections.emptyList(), AutoBillNativeStore.PKG_ALIPAY));
    }

    @Test
    public void financialKeywordsHit_paymentText() {
        assertTrue(AutoBillPrivacy.looksPossiblyFinancial("支付25.80元"));
        assertTrue(AutoBillPrivacy.looksPossiblyFinancial("付款成功"));
        assertTrue(AutoBillPrivacy.looksPossiblyFinancial("退款到账50元"));
        assertTrue(AutoBillPrivacy.looksPossiblyFinancial("微信支付 收款 8元"));
        assertTrue(AutoBillPrivacy.looksPossiblyFinancial("招商银行 扣款通知"));
    }

    @Test
    public void nonFinancialTextNotCaptured() {
        assertEquals(false, AutoBillPrivacy.looksPossiblyFinancial("小红：今晚一起吃饭吗"));
        assertEquals(false, AutoBillPrivacy.looksPossiblyFinancial("您有新的验证码：123456。请勿泄露。"));
        assertEquals(false, AutoBillPrivacy.looksPossiblyFinancial(""));
        assertEquals(false, AutoBillPrivacy.looksPossiblyFinancial(null));
    }
}