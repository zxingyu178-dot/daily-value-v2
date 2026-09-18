package com.dailyvalue.app.autobill.background;

/**
 * Daily Value 2.21.0 - Native Parser 注册表。
 *
 * 只按包名路由（与 Web Source Registry 的 packageNames 对齐，不维护业务来源默认值）：
 * - com.eg.android.AlipayGphone → AlipayNativeParser
 * - com.tencent.mm            → WechatNativeParser
 * - 其它包名 → null（Native 不支持该来源，走 Raw fallback 由 Web Parser 最后尝试）
 */
public final class NativeParserRegistry {

    public static final String PKG_ALIPAY = "com.eg.android.AlipayGphone";
    public static final String PKG_WECHAT = "com.tencent.mm";

    private NativeParserRegistry() {
    }

    /** 按包名路由解析；native 不支持或解析失败 → null（调用方写 Raw Queue fallback） */
    public static NativeParsedCandidate parse(NativeParseInput in) {
        if (PKG_WECHAT.equals(in.packageName)) {
            return WechatNativeParser.parse(in);
        }
        if (PKG_ALIPAY.equals(in.packageName)) {
            return AlipayNativeParser.parse(in);
        }
        return null;
    }
}