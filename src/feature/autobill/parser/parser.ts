/**
 * Daily Value v2 - 自动记账 通知文本解析（2.15.0 Gate A）
 *
 * Gate A 只做「基础启发式」：支付宝/微信支付常见模板的金额与收支方向识别。
 * - 金额：¥25.80 / 25.80元 / 支付25.80元 / 收入50.00元 等
 * - 类型：收入（收款到账/退款/入账）→ income；其余默认 expense
 * - 商户：基础启发式（中文商户名 token）；解析不到时为来源应用名（Gate A 兜底，
 *   完整商户识别在 2.15.1 Gate B）
 *
 * 纯函数、确定性，便于 vitest 覆盖（测试 1）。
 */
import type { BillType } from '@/core/models/types';

export interface ParsedNotification {
  amount: number | null;
  type: BillType;
  merchant: string | null;
  /** 归一化后的全文（用于去重） */
  normalizedText: string;
}

/** 金额句法：¥/￥ + 数字，或 数字 + 元/块。小数 1-2 位。 */
const AMOUNT_PATTERNS: RegExp[] = [
  /[¥￥]\s*(\d{1,9}(?:\.\d{1,2})?)/,
  /(\d{1,9}(?:\.\d{1,2})?)\s*元/,
  /(\d{1,9}(?:\.\d{1,2})?)\s*块/,
];

/** 收入方向关键词（退款/收款/到账/入账）；命中 → income，否则 expense */
const INCOME_KEYWORDS = ['退款', '收款', '到账', '入账', '转入', '收入'];

/** 解析单条支付通知文本。解析不到金额返回 amount=null（调用方决定是否建候选）。 */
export function parseNotification(rawText: string): ParsedNotification {
  const normalizedText = rawText.replace(/\s+/g, ' ').trim();

  let amount: number | null = null;
  for (const pattern of AMOUNT_PATTERNS) {
    const m = normalizedText.match(pattern);
    if (m?.[1]) {
      const parsed = Number(m[1]);
      if (Number.isFinite(parsed) && parsed >= 0) {
        amount = Math.round(parsed * 100) / 100;
        break;
      }
    }
  }

  const isIncome = INCOME_KEYWORDS.some((k) => normalizedText.includes(k));
  const type: BillType = isIncome ? 'income' : 'expense';

  // 基础商户启发式：去掉来源应用名与动作词后，取第一个中文字段（Gate B 再细化）
  const merchant = guessMerchant(normalizedText);

  return { amount, type, merchant, normalizedText };
}

/** 常见动作/结构词（不参与商户名识别）；Gate A 保守策略：识别不到就用来源 App 名。 */
const ACTION_WORDS = [
  '支付宝', '微信支付', '支付', '付款', '成功', '已', '收款', '到账', '退款',
  '转账', '向', '交易', '完成', '元的', '元', '¥', '￥',
];

function guessMerchant(text: string): string | null {
  // 简单启发式：去除动作词后，若剩余仍含 2+ 字中文片段则取最长片段
  let remaining = text;
  for (const w of ACTION_WORDS) {
    remaining = remaining.split(w).join(' ');
  }
  const segments = remaining
    .split(/[ ,，。:：;；\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 2 && /[\u4e00-\u9fa5]/.test(s));
  if (segments.length === 0) return null;
  return segments.sort((a, b) => b.length - a.length)[0];
}