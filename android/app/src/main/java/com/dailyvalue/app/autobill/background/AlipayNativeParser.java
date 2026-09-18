package com.dailyvalue.app.autobill.background;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Daily Value 2.21.0 - 支付宝原生解析器（与 Web AlipayParser.ts 规则等价迁移）。
 *
 * 规则（尽力保持与 TypeScript 一致，禁止本轮「顺便升级」规则）：
 * - 金额：¥/￥ + 数字，或 数字 + 元/块（0.01元）
 * - 方向：退款/收款/到账/入账/转入/收入 → income；否则 expense
 * - 商户：动作词/营销噪声词/单字功能词剔除 + 纯中文(≥2字)片段 + 交易尾缀剥离
 * - 置信度：商户存在 且 文本含交易语义锚点 → HIGH；否则 MEDIUM
 * - 无金额 → 返回 null（不生成候选）
 */
public final class AlipayNativeParser {

    private static final Pattern[] AMOUNT_PATTERNS = new Pattern[]{
            Pattern.compile("[¥￥]\\s*(\\d{1,9}(?:\\.\\d{1,2})?)"),
            Pattern.compile("(\\d{1,9}(?:\\.\\d{1,2})?)\\s*元"),
            Pattern.compile("(\\d{1,9}(?:\\.\\d{1,2})?)\\s*块"),
    };

    private static final String[] INCOME_KEYWORDS = {"退款", "收款", "到账", "入账", "转入", "收入"};
    private static final String[] ACTION_WORDS = {
            "支付宝", "付款", "支付", "成功", "已", "交易", "提醒", "你的", "元", "¥", "￥",
            "你有一笔", "的支出", "支出", "收入", "笔", "一笔",
    };
    private static final String[] NOISE_WORDS = {
            "积分", "领取", "点击", "优惠", "红包", "奖励", "活动", "会员", "折扣", "福利",
            "查看", "详情", "通知", "账单", "余额", "账户", "您好", "尊敬", "您的", "个", "笔",
    };
    private static final String[] TRANSACTION_ANCHORS = {
            "付款", "消费", "支付成功", "付款成功", "收款", "到账", "入账", "商家", "商户",
            "订单", "已支付", "交易成功", "扣款", "扫码", "银行", "收钱",
    };
    private static final char[] FUNC_CHARS = {'您', '在', '了', '的', '已', '等', '及', '和', '与'};
    private static final String[] MERCHANT_SUFFIXES = {
            "消费", "付款", "支付", "成功", "订单", "到账", "收款", "入账",
    };

    public static final String SOURCE = "alipay";

    /** @return 解析结果；无法解析（无金额）返回 null（写 Raw Queue fallback） */
    public static NativeParsedCandidate parse(NativeParseInput in) {
        String text = join(in);
        if (text.isEmpty()) return null;

        double amount = matchAmount(text);
        if (amount < 0) return null;

        boolean isIncome = containsAny(text, INCOME_KEYWORDS);
        String type = isIncome ? "income" : "expense";

        String merchant = guessMerchant(text);
        boolean hasAnchor = containsAny(text, TRANSACTION_ANCHORS);
        String confidence = (merchant != null && hasAnchor) ? "HIGH" : "MEDIUM";

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

    /** 匹配金额；无金额返回 -1 */
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

    /** 商户提取：剔除动作/噪声/功能词 → 纯中文片段 ≥2 字 → 优先带交易尾缀剥离的片段，取最长 */
    static String guessMerchant(String text) {
        String remaining = text;
        for (String w : ACTION_WORDS) remaining = remaining.replace(w, " ");
        for (String w : NOISE_WORDS) remaining = remaining.replace(w, " ");
        for (char ch : FUNC_CHARS) remaining = remaining.replace(String.valueOf(ch), " ");

        String[] tokens = remaining.split("[ ,，。:：;；\\n]+");
        String best = null;
        String bestStripped = null;
        for (String tok : tokens) {
            String t = tok.trim();
            if (t.length() < 2) continue;
            if (!t.matches("^[\\u4e00-\\u9fa5]+$")) continue; // 只认纯中文片段
            String stripped = stripMerchantSuffix(t).trim();
            String cleaned = stripped.length() >= 2 ? stripped : t;
            boolean isStripped = !cleaned.equals(t);
            if (best == null) {
                best = t;
                bestStripped = isStripped ? cleaned : null;
            } else if (isStripped) {
                if (bestStripped == null || cleaned.length() > bestStripped.length()) {
                    bestStripped = cleaned;
                }
            } else if (bestStripped == null && cleaned.length() > best.length()) {
                best = cleaned;
            }
        }
        if (bestStripped != null) return bestStripped;
        return best;
    }

    static String stripMerchantSuffix(String s) {
        String cur = s;
        boolean changed = true;
        while (changed) {
            changed = false;
            for (String suffix : MERCHANT_SUFFIXES) {
                if (cur.endsWith(suffix) && cur.length() - suffix.length() >= 2) {
                    cur = cur.substring(0, cur.length() - suffix.length());
                    changed = true;
                    break;
                }
            }
        }
        return cur;
    }
}