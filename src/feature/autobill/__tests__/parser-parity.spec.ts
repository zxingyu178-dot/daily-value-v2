/**
 * Daily Value 2.21.0 - PARSER-PARITY（Web/Native 双实现一致性）
 *
 * 与 android/app/src/test/.../background/NativeParserParityTest.java 共用
 * 同一份脱敏 fixtures（仓库根 autobill-fixtures/alipay.json + wechat.json）。
 * 断言：Web Parser（AlipayParser/WechatParser）输出与 fixture expected 完全一致，
 * 即 Native 移植以 Web 为准且未升级/降级规则。
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { AlipayParser } from '../parser/AlipayParser';
import { WechatParser } from '../parser/WechatParser';

interface ParityCase {
  label: string;
  title: string;
  text: string;
  bigText?: string;
  subText?: string;
  expected: {
    parsed: boolean;
    amount?: number;
    type?: string;
    merchant?: string | null;
    confidence?: string;
  };
}

function loadFixture(fileName: string): ParityCase[] {
  const candidates = [
    path.resolve(__dirname, '../../../../autobill-fixtures', fileName),
    path.resolve(process.cwd(), 'autobill-fixtures', fileName),
  ];
  const found = candidates.find((p) => fs.existsSync(p));
  if (!found) throw new Error(`fixture not found: ${fileName}`);
  return JSON.parse(fs.readFileSync(found, 'utf-8')) as ParityCase[];
}

describe('PARSER-PARITY alipay.json（Web AlipayParser ↔ 共享 fixture）', () => {
  const parser = new AlipayParser();
  for (const c of loadFixture('alipay.json')) {
    it(`${c.label}`, () => {
      const result = parser.parse({
        packageName: 'com.eg.android.AlipayGphone',
        title: c.title,
        text: c.text,
        bigText: c.bigText ?? '',
        subText: c.subText ?? '',
        postTime: 0,
      });
      if (!c.expected.parsed) {
        expect(result).toBeNull();
        return;
      }
      expect(result).not.toBeNull();
      expect(result!.amount).toBeCloseTo(c.expected.amount!, 2);
      expect(result!.type).toBe(c.expected.type);
      expect(result!.merchant ?? null).toBe(c.expected.merchant ?? null);
      expect(result!.confidence ?? null).toBe(c.expected.confidence ?? null);
    });
  }
});

describe('PARSER-PARITY wechat.json（Web WechatParser ↔ 共享 fixture）', () => {
  const parser = new WechatParser();
  for (const c of loadFixture('wechat.json')) {
    it(`${c.label}`, () => {
      const result = parser.parse({
        packageName: 'com.tencent.mm',
        title: c.title,
        text: c.text,
        bigText: c.bigText ?? '',
        subText: c.subText ?? '',
        postTime: 0,
      });
      if (!c.expected.parsed) {
        expect(result).toBeNull();
        return;
      }
      expect(result).not.toBeNull();
      expect(result!.amount).toBeCloseTo(c.expected.amount!, 2);
      expect(result!.type).toBe(c.expected.type);
      expect(result!.merchant ?? null).toBe(c.expected.merchant ?? null);
      expect(result!.confidence ?? null).toBe(c.expected.confidence ?? null);
    });
  }
});