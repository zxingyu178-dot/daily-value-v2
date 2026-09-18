package com.dailyvalue.app.autobill.background;

import java.util.ArrayList;
import java.util.List;

/**
 * Daily Value 2.21.0 - Native Candidate 编解码（纯 Java，可在 JVM 单测跑）。
 *
 * 私有稳定行格式（每行一条，字段以 `|` 分隔；转义沿用 AutoBillNativeCodec.esc/unesc）。
 * 存于 App 私有文件；刻意不依赖 org.json/android.*。
 *
 * 行：v1 | id | source | sourcePackage | notificationKey | amount | type | merchant | confidence | postTime | capturedAt | rawTextHash
 */
public final class NativeParsedCandidateCodec {

    private NativeParsedCandidateCodec() {
    }

    public static final int VERSION = 1;

    public static String encode(List<NativeParsedCandidate> list) {
        StringBuilder sb = new StringBuilder();
        sb.append("v").append(VERSION).append('\n');
        for (NativeParsedCandidate c : list) {
            sb.append(AutoBillNativeCodecRef.esc(c.id)).append('|')
              .append(AutoBillNativeCodecRef.esc(c.source)).append('|')
              .append(AutoBillNativeCodecRef.esc(c.sourcePackage)).append('|')
              .append(AutoBillNativeCodecRef.esc(c.notificationKey)).append('|')
              .append(c.amount).append('|')
              .append(AutoBillNativeCodecRef.esc(c.type)).append('|')
              .append(AutoBillNativeCodecRef.esc(c.merchant)).append('|')
              .append(AutoBillNativeCodecRef.esc(c.confidence)).append('|')
              .append(c.postTime).append('|')
              .append(c.capturedAt).append('|')
              .append(AutoBillNativeCodecRef.esc(c.rawTextHash))
              .append('\n');
        }
        return sb.toString();
    }

    public static List<NativeParsedCandidate> decode(String content) {
        List<NativeParsedCandidate> out = new ArrayList<>();
        if (content == null || content.isEmpty()) return out;
        String[] lines = content.split("\\n", -1);
        int start = 0;
        if (lines.length > 0 && lines[0].startsWith("v")) start = 1;
        for (int i = start; i < lines.length; i++) {
            String line = lines[i];
            if (line.isEmpty()) continue;
            String[] f = splitLine(line);
            if (f.length < 11) continue;
            try {
                out.add(new NativeParsedCandidate(
                        AutoBillNativeCodecRef.unesc(f[0]),
                        AutoBillNativeCodecRef.unesc(f[1]),
                        AutoBillNativeCodecRef.unesc(f[2]),
                        AutoBillNativeCodecRef.unesc(f[3]),
                        Double.parseDouble(f[4]),
                        AutoBillNativeCodecRef.unesc(f[5]),
                        AutoBillNativeCodecRef.unesc(f[6]),
                        AutoBillNativeCodecRef.unesc(f[7]),
                        Long.parseLong(f[8]),
                        Long.parseLong(f[9]),
                        AutoBillNativeCodecRef.unesc(f[10])));
            } catch (NumberFormatException ignored) {
                // 单行损坏跳过，不影响其余记录
            }
        }
        return out;
    }

    /** 按未转义 `|` 切分（与 Raw codec 相同的线性扫描；字段内转义序列原样保留给 unesc） */
    private static String[] splitLine(String line) {
        java.util.List<String> parts = new java.util.ArrayList<>();
        StringBuilder cur = new StringBuilder();
        for (int i = 0; i < line.length(); i++) {
            char c = line.charAt(i);
            if (c == '\\' && i + 1 < line.length()) {
                cur.append(c).append(line.charAt(i + 1));
                i++;
            } else if (c == '|') {
                parts.add(cur.toString());
                cur = new StringBuilder();
            } else {
                cur.append(c);
            }
        }
        parts.add(cur.toString());
        return parts.toArray(new String[0]);
    }

    /** 引用父包 codec 的转义函数（避免复制；保持单一实现） */
    private static final class AutoBillNativeCodecRef {
        static String esc(String s) {
            return com.dailyvalue.app.autobill.AutoBillNativeCodec.esc(s);
        }

        static String unesc(String s) {
            return com.dailyvalue.app.autobill.AutoBillNativeCodec.unesc(s);
        }
    }
}