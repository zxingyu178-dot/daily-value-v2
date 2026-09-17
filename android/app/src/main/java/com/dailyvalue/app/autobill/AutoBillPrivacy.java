package com.dailyvalue.app.autobill;

import java.util.Collection;

/**
 * Daily Value - AutoBill 隐私边界（2.15.1 Gate B）
 *
 * 纯 Java 静态工具（JVM 可测），拒绝成为「全手机通知收集器」：
 * 1) 包名白名单：只有用户开启的来源（Enabled Packages）才允许进入 Native Queue；
 *    判定必须用 Android packageName（不是应用中文名）。
 * 2) 疑似交易预过滤：只保存「疑似金融」通知，微信聊天等普通内容一律不暂存。
 *
 * 预过滤是宽松关键词启发（非正式支付解析，正式解析在 Gate C）。
 */
public final class AutoBillPrivacy {

    /**
     * 主支付中文关键文本（宽松命中即疑似金融）。
     * 2.17.1 P1：收紧预过滤——移除 bare 裸词「支付/付款/收款」，
     * 它们会命中普通聊天（如「帮我支付20元」）。优先识别更明确的金融结构词，
     * 保持「第一层粗筛」定位（正式解析仍在 Web Parser，这里只负责不误暂存聊天）。
     */
    private static final String[] FINANCIAL_KEYWORDS = {
            "支付宝", "微信支付", "支付成功", "付款成功", "支付凭证", "收款提醒",
            "退款", "扣款", "交易", "消费", "到账", "入账", "支出"
    };

    private AutoBillPrivacy() {
    }

    /** 包名是否在启用来源集合中（第一行防线） */
    public static boolean isAllowedPackage(Collection<String> enabledPackages, String packageName) {
        return enabledPackages != null && packageName != null && enabledPackages.contains(packageName);
    }

    /** 候选通知预过滤：文本中含任一关键词 → 疑似交易（宽松；宁可少抓，不保存聊天内容） */
    public static boolean looksPossiblyFinancial(String visibleText) {
        if (visibleText == null || visibleText.isEmpty()) return false;
        for (String kw : FINANCIAL_KEYWORDS) {
            if (visibleText.contains(kw)) return true;
        }
        return false;
    }
}