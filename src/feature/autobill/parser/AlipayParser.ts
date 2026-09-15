/**
 * Daily Value v2 - 支付宝通知解析器（2.16.1 Gate C）
 *
 * 第一版规则（不追求 100%，宁可少抓不误入账）：
 *  - 金额：¥/￥+数字、数字+元、0.01元 等（示例 1/2）
 *  - 方向：默认支出；含 退款/收款/到账 等视为收入
 *  - 商户：示例 2（付款成功 星巴克 ¥35）→ 中文商户词提取；无商户 → null（示例 1）
 *  - 分类：本地商户→分类小表（星巴克/瑞幸/麦当劳/肯德基 → 餐饮 等）；未命中不指定
 *  - 可信度：金额+商户齐全 → HIGH；仅金额 → MEDIUM
 *  - 无金额（示例 3 积分提醒）→ 返回 null，不生成账单
 */
import type { AutoBillConfidence, AutoBillSource, BillType } from '@/core/models/types';
import type { NotificationParser, ParsedResult, ParserInput } from './registry';

/** 金额字面规则：¥/￥ + 数字，或 数字 + 元/块/分（0.01元） */
const AMOUNT_PATTERNS: RegExp[] = [
  /[¥￥]\s*(\d{1,9}(?:\.\d{1,2})?)/,
  /(\d{1,9}(?:\.\d{1,2})?)\s*元/,
  /(\d{1,9}(?:\.\d{1,2})?)\s*块/,
];

const INCOME_KEYWORDS = ['退款', '收款', '到账', '入账', '转入', '收入'];

/** 本地商户 → 建议分类（内置小表；后续接入用户修改习惯学习） */
const MERCHANT_CATEGORY_HINTS: Array<{ keywords: string[]; categoryId: string }> = [
  { keywords: ['星巴克', '瑞幸', '麦当劳', '肯德基', '汉堡王', '喜茶', '奶茶', '咖啡'], categoryId: 'c-food' },
  { keywords: ['滴滴', '打车', '地铁', '公交', '高德', '滴滴出行'], categoryId: 'c-transport' },
  { keywords: ['淘宝', '京东', '拼多多', '天猫'], categoryId: 'c-shopping' },
];

/** 动作词（商户提取时剔除） */
const ACTION_WORDS = [
  '支付宝', '付款', '支付', '成功', '已', '交易', '提醒', '你的', '元', '¥', '￥',
  '你有一笔', '的支出', '支出', '收入', '笔', '一笔',
];

export class AlipayParser implements NotificationParser {
  readonly source: AutoBillSource = 'alipay';

  parse(input: ParserInput): ParsedResult | null {
    const text = [input.title, input.text, input.bigText, input.subText]
      .filter((s) => s)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!text) return null;

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
    // 示例 3：积分提醒等无金额 → 不生成账单
    if (amount === null) return null;

    const isIncome = INCOME_KEYWORDS.some((k) => text.includes(k));
    const type: BillType = isIncome ? 'income' : 'expense';

    const merchant = guessMerchant(text);
    const suggestCategoryId = merchant ? hintCategory(merchant) : undefined;
    const confidence: AutoBillConfidence = merchant ? 'HIGH' : 'MEDIUM';

    return { source: 'alipay', type, amount, merchant: merchant ?? undefined, confidence, suggestCategoryId };
  }
}

function guessMerchant(text: string): string | null {
  let remaining = text;
  for (const w of ACTION_WORDS) remaining = remaining.split(w).join(' ');
  const segments = remaining
    .split(/[ ,，。:：;；\n]+/)
    .map((s) => s.trim())
    // 只认纯中文（≥2 字）片段：金额残留（如「你有一笔0.01」）不当作商户
    .filter((s) => s.length >= 2 && /^[\u4e00-\u9fa5]+$/.test(s));
  if (segments.length === 0) return null;
  return segments.sort((a, b) => b.length - a.length)[0];
}

function hintCategory(merchant: string): string | undefined {
  for (const rule of MERCHANT_CATEGORY_HINTS) {
    if (rule.keywords.some((k) => merchant.includes(k))) return rule.categoryId;
  }
  return undefined;
}