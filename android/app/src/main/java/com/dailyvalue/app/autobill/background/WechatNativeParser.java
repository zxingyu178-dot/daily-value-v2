package com.dailyvalue.app.autobill.background;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Daily Value 2.21.0 - 微信原生解析器（与 Web WechatParser.ts 规则等价迁移）。
 *
 * 微信最大风险：com.tencent.mm 同时产出 聊天 / 支付 / 服务通知。
 * 因此比支付宝更严格：必须存在「微信支付系统通知结构」证据才解析，
 * 否则一律 null（宁可漏，不误抓聊天）。
 * - PAY_STRUCTURE 信号（微信支付凭证/收款方/付款方/转账到账/到账/退款…，或标题以「微信支付」开头）
 * - 金额：¥/￥+数字 或 数字+元/块
 * - 方向：收款/到账/转入/入账/退款/退还/退回 → income；否则 expense
 * - 商户：剔除系统词后中文开头片段（允许字母数字）最长段；可空
 * - 置信度：商户存在 HIGH；否则 MEDIUM（弱证据不生成，无 LOW 分支）
 */
public final class WechatNativeParser {

    private static final Pattern[] AMOUNT_PATTERNS = new Pattern[]{
            Pattern.compile("[¥￥]\\s*(\\d{1,9}(?:\\.\\d{1,2})?)"),
            Pattern.compile("(\\d{1,9}(?:\\.\\d{1,2})?)\\s*元"),
            Pattern.compile("(\\d{1,9}(?:\\.\\d{1,2})?)\\s*块"),
    };

    private static final String[] INCOME_WORDS = {"收款", "到账", "转入", "入账", "退款", "退还", "退回"};

    private static final String[] PAY_STRUCTURE = {
            "微信支付凭证", "支付凭证", "收款方", "付款方", "转账到账", "到账提醒", "已到账",
            "微信收款", "收款提醒", "退款成功", "已退还", "已退回", "交易单号", "商户订单号", "微信支付通知",
    };

    private static final String[] STRIP_WORDS = {
            "微信支付凭证", "支付凭证", "收款方", "付款方", "转账到账", "到账提醒", "已到账",
            "微信收款", "收款提醒", "退款成功", "已退还", "已退回", "交易单号", "商户订单号", "微信支付通知",
            "微信支付", "微信", "支付", "支出", "元", "收款", "到账", "转入", "入账", "退款", "退还", "退回",
    };

    public static final String SOURCE = "wechat";

    /** @return 解析结果；证据不足/无金额返回 null（写 Raw Queue fallback） */
    public static NativeParsedCandidate parse(NativeParseInput in) {
        String text = join(in);
        if (text.isEmpty()) return null;

        // ① 证据：标题「微信支付…」或正文含系统结构信号；否则视为聊天/无关通知
        String title = in.title == null ? "" : in.title.trim();
        boolean hasSystemStructure =
                title.matches("^微信支付([\\s!！]|$).*")
                        || containsAny(text, PAY_STRUCTURE);
        if (!hasSystemStructure) return null;

        // ② 金额
        double amount = matchAmount(text);
        if (amount < 0) return null;

        // ③ 方向
        boolean isIncome = containsAny(text, INCOME_WORDS);
        String type = isIncome ? "income" : "expense";

        // ④ 商户（可空）
        String merchant = guessMerchant(text);

        // ⑤ 置信度
        String confidence = merchant != null ? "HIGH" : "MEDIUM";

        long now = System.currentTimeMillis();
        return new NativeParsedCandidate(
                now + "-" + Integer.toHexString(in.notificationKey.hashCode()),
                SOURCE,
                in.packageName,
                in.notificationKey,
                amount,
                type,
                merchant,
                confidence,
                in.postTime,
                now,
                in.rawTextHash);
    }

    private static String join(NativeParseInput in) {
        StringBuilder sb = new StringBuilder();
        for (String s : new String[]{in.title, in.text, in.bigText, in.subText}) {
            if (s != null && !s.trim().isEmpty()) sb.append(' ').append(s.trim());
        }
        return sb.toString().replaceAll("\\s+", " ").trim();
    }

    static double matchAmount(String text) {
        for (Pattern p : AMOUNT_PATTERNS) {
            Matcher m = p.matcher(text);
            if (m.find()) {
                try {
                    double n = Double.parseDouble(m.group(1));
                    if (n >= 0) return Math.round(n * 100.0) / 100.0;
                } catch (NumberFormatException ignored) {
                }
            }
        }
        return -1;
    }

    static boolean containsAny(String text, String[] words) {
        for (String w : words) {
            if (text.contains(w)) return true;
        }
        return false;
    }

    /** 商户提取：剔除系统词后取「中文开头、允许字母数字」的最长业务段 */
    static String guessMerchant(String text) {
        String remaining = text;
        for (String w : STRIP_WORDS) remaining = remaining.replace(w, " ");
        String[] segments = remaining.split("[\\n,，。:：;；\\s]+");
        String best = null;
        for (String seg : segments) {
            String s = seg.trim();
            if (s.length() < 2) continue;
            if (!s.matches("^[\\u4e00-\\u9fa5][\\u4e00-\\u9fa5A-Za-z0-9]*$")) continue;
            if (best == null || s.length() > best.length()) best = s;
        }
        return best;
    }
}