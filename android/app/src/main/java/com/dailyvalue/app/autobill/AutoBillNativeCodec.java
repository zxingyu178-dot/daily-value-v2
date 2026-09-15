package com.dailyvalue.app.autobill;

import java.util.ArrayList;
import java.util.List;

/**
 * Daily Value - AutoBill 队列编解码（2.15.1 Gate B）
 *
 * 私有稳定行格式（每行一条记录，字段以 `|` 分隔；转义 `\`、`|`、`\r`、`\n`），
 * 存于 App 私有文件（其它 App 不可访问）。刻意不依赖 org.json/android.*，
 * 保证核心逻辑可在 JVM 单元测试中直接运行。
 *
 * 行：id | notificationKey | packageName | postTime | capturedAt | title | text | bigText | subText | channelId
 * 空串字段直接留空；字符串字段均转义。
 */
public final class AutoBillNativeCodec {

    private AutoBillNativeCodec() {
    }

    /** `\` → `\\`，`|` → `\p`，`\r` → `\r`(字面)，`\n` → `\n`(字面)，避免破坏行结构 */
    static String esc(String s) {
        if (s == null) return "";
        StringBuilder sb = new StringBuilder(s.length() + 8);
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '\\': sb.append("\\\\"); break;
                case '|': sb.append("\\p"); break;
                case '\r': sb.append("\\r"); break;
                case '\n': sb.append("\\n"); break;
                default: sb.append(c);
            }
        }
        return sb.toString();
    }

    static String unesc(String s) {
        StringBuilder sb = new StringBuilder(s.length());
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (c == '\\' && i + 1 < s.length()) {
                char n = s.charAt(i + 1);
                if (n == '\\') sb.append('\\');
                else if (n == 'p') sb.append('|');
                else if (n == 'r') sb.append('\r');
                else if (n == 'n') sb.append('\n');
                else {
                    sb.append(n);
                }
                i++;
            } else {
                sb.append(c);
            }
        }
        return sb.toString();
    }

    /** 当前记录行格式版本（未来字段增补时升版本并做兼容解码） */
    public static final int VERSION = 1;

    public static String encode(List<AutoBillNativeRecord> records) {
        StringBuilder sb = new StringBuilder();
        sb.append("v").append(VERSION).append('\n');
        for (AutoBillNativeRecord r : records) {
            sb.append(esc(r.id)).append('|')
              .append(esc(r.notificationKey)).append('|')
              .append(esc(r.packageName)).append('|')
              .append(r.postTime).append('|')
              .append(r.capturedAt).append('|')
              .append(esc(r.title)).append('|')
              .append(esc(r.text)).append('|')
              .append(esc(r.bigText)).append('|')
              .append(esc(r.subText)).append('|')
              .append(esc(r.channelId))
              .append('\n');
        }
        return sb.toString();
    }

    public static List<AutoBillNativeRecord> decode(String content) {
        List<AutoBillNativeRecord> out = new ArrayList<>();
        if (content == null || content.isEmpty()) return out;
        String[] lines = content.split("\\n", -1);
        // 首行版本头（v1）；空文件视为无记录。行内字段不足时跳过（容错，不抛错）。
        int start = 0;
        if (lines.length > 0 && lines[0].startsWith("v")) {
            start = 1;
        }
        for (int i = start; i < lines.length; i++) {
            String line = lines[i];
            if (line.isEmpty()) continue;
            String[] f = splitLine(line);
            if (f.length < 10) continue;
            try {
                out.add(new AutoBillNativeRecord(
                        unesc(f[0]), unesc(f[1]), unesc(f[2]),
                        Long.parseLong(f[3]), Long.parseLong(f[4]),
                        unesc(f[5]), unesc(f[6]), unesc(f[7]), unesc(f[8]), unesc(f[9])));
            } catch (NumberFormatException ignored) {
                // 单行损坏跳过，不影响其余记录
            }
        }
        return out;
    }

    /** 按未转义的 `|` 切分（一次线性扫描） */
    private static String[] splitLine(String line) {
        List<String> parts = new ArrayList<>();
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
}