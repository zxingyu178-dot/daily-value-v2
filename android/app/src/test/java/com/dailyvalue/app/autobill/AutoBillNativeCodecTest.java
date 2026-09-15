package com.dailyvalue.app.autobill;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

import java.util.Arrays;
import java.util.List;

/**
 * Daily Value - AutoBill 编解码测试（JVM）
 * 私有行格式：转义 `\` `|` `\r` `\n`；损坏行跳过；轮转往返一致。
 */
public class AutoBillNativeCodecTest {

    private AutoBillNativeRecord rec(String id, String key, String text) {
        return new AutoBillNativeRecord(id, key, "com.eg.android.AlipayGphone",
                1000L, 2000L, "title", text, "", "", "channel-1");
    }

    @Test
    public void roundtrip_withSpecialChars() {
        String tricky = "支付25.80元，商户|瑞幸\\咖啡\n第二行";
        List<AutoBillNativeRecord> list = Arrays.asList(rec("a1", "key1", tricky));
        String encoded = AutoBillNativeCodec.encode(list);
        List<AutoBillNativeRecord> decoded = AutoBillNativeCodec.decode(encoded);
        assertEquals(1, decoded.size());
        assertEquals("a1", decoded.get(0).id);
        assertEquals(tricky, decoded.get(0).text);
        assertEquals("com.eg.android.AlipayGphone", decoded.get(0).packageName);
        assertEquals(1000L, decoded.get(0).postTime);
        assertEquals(2000L, decoded.get(0).capturedAt);
    }

    @Test
    public void decode_emptyAndCorruptLines() {
        assertEquals(0, AutoBillNativeCodec.decode(null).size());
        assertEquals(0, AutoBillNativeCodec.decode("").size());
        // 损坏行（字段不足 / 数字非法）跳过，不抛错
        String cropped = "v1\nbad|line\n";
        assertEquals(0, AutoBillNativeCodec.decode(cropped).size());
    }

    @Test
    public void roundtrip_multipleRecordsOrderStable() {
        List<AutoBillNativeRecord> list = Arrays.asList(rec("a", "k1", "t1"), rec("b", "k2", "t2"));
        assertEquals(2, AutoBillNativeCodec.decode(AutoBillNativeCodec.encode(list)).size());
    }
}