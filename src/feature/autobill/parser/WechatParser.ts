/**
 * Daily Value v2 - 微信支付解析器（2.17.0 Source Expansion：第一版保守实现）
 *
 * 微信最大风险：com.tencent.mm 同时产出 聊天 / 支付 / 服务通知。
 * 因此 WechatParser 比支付宝更严格：证据不足一律 return null（宁可漏，不误抓聊天）。
 *
 * 安全原则（§十一~§十三）：
 * - 必须存在「微信支付系统通知结构」信号（支付凭证 / 收款方 / 付款方 / 转账到账 / 到账 /
 *   退款…，或标题为「微信支付」）才算证据；仅正文含「支付 / 转账 / ¥20」绝不建账单
 *   （普通聊天「我刚支付20块」不进入账本）。
 * - HIGH：明确支付结构 + 金额 + 商户；MEDIUM：明确支付结构 + 金额但商户缺失；
 *   弱证据（LOW 优先不生成）→ null。
 * - 方向：退款 / 收款 / 到账 → income；支付凭证支出 → expense（暂不扩 BillType）。
 *
 * 测试样本均为脱敏 fixture（商户A / ¥12.34），不包含任何真实用户聊天内容。
 */
import type { AutoBillSource } from '@/core/models/types';
import type { NotificationParser, ParsedResult, ParserInput } from './registry';

/** 金额字面：¥/￥ + 数字，或 数字+元/块 */
const AMOUNT_PATTERNS: RegExp[] = [
  /[¥￥]\s*(\d{1,9}(?:\.\d{1,2})?)/,
  /(\d{1,9}(?:\.\d{1,2})?)\s*元/,
  /(\d{1,9}(?:\.\d{1,2})?)\s*块/,
];

/** 收入/到账方向词（退款沿用 income 语义） */
const INCOME_WORDS = ['收款', '到账', '转入', '入账', '退款', '退还', '退回'];

/**
 * 微信支付「系统通知结构」信号：只有正文/标题出现这些才认为是微信支付官方通知。
 * 刻意不放裸「支付」「转账」——它们会出现在普通聊天里。
 */
const PAY_STRUCTURE = [
  '微信支付凭证', '支付凭证', '收款方', '付款方', '转账到账', '到账提醒', '已到账',
  '微信收款', '收款提醒', '退款成功', '已退还', '已退回', '交易单号', '商户订单号', '微信支付通知',
];

/** 商户提取前剔除的系统词（避免「微信支付凭证」整段被当商户） */
const STRIP_WORDS = [
  ...PAY_STRUCTURE,
  '微信支付', '微信', '支付', '支出', '元',
  ...INCOME_WORDS,
];

export class WechatParser implements NotificationParser {
  readonly source: AutoBillSource = 'wechat';

  parse(input: ParserInput): ParsedResult | null {
    const text = [input.title, input.text, input.bigText, input.subText]
      .filter((s) => s && String(s).trim())
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!text) return null;

    // ① 证据：标题为「微信支付*」或正文含系统结构信号，否则一律视为聊天/无关通知
    const hasSystemStructure =
      /^微信支付(\s|$|!|！)/.test(String(input.title ?? '').trim()) ||
      PAY_STRUCTURE.some((k) => text.includes(k));
    if (!hasSystemStructure) return null;

    // ② 金额
    let amount: number | null = null;
    for (const pattern of AMOUNT_PATTERNS) {
      const m = text.match(pattern);
      if (m?.[1]) {
        const n = Number(m[1]);
        if (Number.isFinite(n) && n >= 0) {
          amount = Math.round(n * 100) / 100;
          break;
        }
      }
    }
    if (amount === null) return null;

    // ③ 方向
    const isIncome = INCOME_WORDS.some((k) => text.includes(k));
    const type = isIncome ? ('income' as const) : ('expense' as const);

    // ④ 商户（可空）
    const merchant = guessMerchant(text);

    // ⑤ 置信度：有商户 HIGH；无商户 MEDIUM（弱证据直接不生成候选，无 LOW 分支）
    const confidence = merchant ? ('HIGH' as const) : ('MEDIUM' as const);

    return { source: 'wechat', type, amount, merchant: merchant ?? undefined, confidence };
  }
}

/** 提取商户：剔除系统词后取「中文开头、允许字母数字」的最长业务段（商户A → 商户A） */
function guessMerchant(text: string): string | null {
  let remaining = text;
  for (const w of STRIP_WORDS) remaining = remaining.split(w).join(' ');
  const segments = remaining
    .split(/[\n,，。:：;；\s]+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 2 && /^[\u4e00-\u9fa5][\u4e00-\u9fa5A-Za-z0-9]*$/.test(s));
  if (segments.length === 0) return null;
  return segments.sort((a, b) => b.length - a.length)[0];
}