package com.dailyvalue.app.autobill.background;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;

/**
 * Daily Value 2.21.0 - PARSER-PARITY（Web/Native 双实现一致性）
 *
 * 与 src/feature/autobill/__tests__/parser-parity.spec.ts 共用同一份脱敏 fixtures
 * （仓库根 autobill-fixtures/alipay.json + wechat.json）。断言 Native Parser 输出与
 * fixture expected 完全一致 —— Native 是 Web 规则的等价迁移（未升级/降级）。
 */
public class NativeParserParityTest {

    private static final String[] CANDIDATES = {
            "autobill-fixtures/%s",
            "../autobill-fixtures/%s",
            "../../autobill-fixtures/%s",
    };

    private static String resolveFixture(String fileName) throws Exception {
        for (String c : CANDIDATES) {
            File f = new File(System.getProperty("user.dir"), String.format(c, fileName));
            if (f.isFile()) return f.getAbsolutePath();
        }
        throw new IllegalStateException("fixture not found: " + fileName);
    }

    private static JSONArray load(String fileName) throws Exception {
        String content = new String(
                Files.readAllBytes(new File(resolveFixture(fileName)).toPath()),
                StandardCharsets.UTF_8);
        return new JSONArray(content);
    }

    private NativeParseInput input(JSONObject c, int index, String pkg) throws Exception {
        return new NativeParseInput(pkg, "parity-" + index, index,
                c.optString("title"), c.optString("text"),
                c.optString("bigText"), c.optString("subText"),
                "hash");
    }

    private void assertExpected(JSONObject c, NativeParsedCandidate out) throws Exception {
        JSONObject exp = c.getJSONObject("expected");
        if (!exp.getBoolean("parsed")) {
            assertNull("label=" + c.optString("label"), out);
            return;
        }
        assertNotNull("label=" + c.optString("label"), out);
        assertEquals("label=" + c.optString("label") + " amount",
                exp.getDouble("amount"), out.amount, 0.001);
        assertEquals("label=" + c.optString("label") + " type",
                exp.getString("type"), out.type);
        String expMerchant = exp.isNull("merchant") ? "" : exp.getString("merchant");
        // 候选存储语义：无商户 = null 归一化为 ""
        assertEquals("label=" + c.optString("label") + " merchant",
                expMerchant, out.merchant);
        assertEquals("label=" + c.optString("label") + " confidence",
                exp.optString("confidence"), out.confidence);
    }

    @Test
    public void parity_alipay_matchesSharedFixture() throws Exception {
        JSONArray cases = load("alipay.json");
        assertTrue("fixture 不应为空", cases.length() > 0);
        for (int i = 0; i < cases.length(); i++) {
            JSONObject c = cases.getJSONObject(i);
            assertExpected(c, AlipayNativeParser.parse(
                    input(c, i, NativeParserRegistry.PKG_ALIPAY)));
        }
    }

    @Test
    public void parity_wechat_matchesSharedFixture() throws Exception {
        JSONArray cases = load("wechat.json");
        assertTrue("fixture 不应为空", cases.length() > 0);
        for (int i = 0; i < cases.length(); i++) {
            JSONObject c = cases.getJSONObject(i);
            assertExpected(c, WechatNativeParser.parse(
                    input(c, i, NativeParserRegistry.PKG_WECHAT)));
        }
    }

    @Test
    public void registry_routesByPackageOnly() {
        // Registry 只按包名路由；未知包 → null（Raw fallback）
        NativeParseInput in = new NativeParseInput("com.example.other", "k1", 0L,
                "通知", "消费 ¥99.00", "", "", "hash");
        assertNull(NativeParserRegistry.parse(in));
        assertNotNull(NativeParserRegistry.parse(new NativeParseInput(
                NativeParserRegistry.PKG_ALIPAY, "k2", 0L, "支付宝", "付款成功 ¥9.90", "", "", "hash")));
    }
}