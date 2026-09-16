/**
 * Daily Value v2 - 支付宝通知解析器（2.16.1 Gate C；2.16.6 修正噪声/置信度）
 *
 * 第一版规则（不追求 100%，宁可少抓不误入账）：
 *  - 金额：¥/￥+数字、数字+元、0.01元 等（示例 1/2）
 *  - 方向：默认支出；含 退款/收款/到账 等视为收入
 *  - 商户：示例 2（付款成功 星巴克 ¥35）→ 中文商户词提取；无商户 → null（示例 1）
 *  - 2.16.6 噪声词过滤：积分/领取/优惠/红包/奖励/活动/会员 等营销片段绝不当作商户
 *  - 2.16.6 置信度规则：仅金额 → MEDIUM；商户存在且文本含「交易语义锚点」（付款/消费/
 *    支付成功/收款/到账/商家/订单/扣款…）→ HIGH；否则 MEDIUM（不再「任意中文词 = HIGH」）
 *  - 分类：本地商户→分类小表（星巴克/瑞幸/麦当劳/肯德基 → 餐饮 等）；未命中不指定
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

/**
 * 2.16.6：营销/系统噪声词 —— 含这些词的片段绝不作商户。
 * 例：「点击领取2个支付宝积分」中的 点击/领取/积分 均被剔除，防止「积分」被识别为商户。
 */
const NOISE_WORDS = [
  '积分', '领取', '点击', '优惠', '红包', '奖励', '活动', '会员', '折扣', '福利',
  '查看', '详情', '通知', '账单', '余额', '账户', '您好', '尊敬', '您的', '个', '笔',
];

/**
 * 2.16.6：交易语义锚点 —— 只有文本存在这些「真实交易完成/商家」语义时，
 * 提取到的商户片段才允许 HIGH 置信度；否则降为 MEDIUM。
 */
const TRANSACTION_ANCHORS = [
  '付款', '消费', '支付成功', '付款成功', '收款', '到账', '入账', '商家', '商户',
  '订单', '已支付', '交易成功', '扣款', '扫码', '银行', '收钱',
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
    const hasTransactionAnchor = TRANSACTION_ANCHORS.some((a) => text.includes(a));
    // 2.16.6：不再「任意中文词 = HIGH」—— 必须满足 商户存在 + 交易语义锚点
    const confidence: AutoBillConfidence = merchant && hasTransactionAnchor ? 'HIGH' : 'MEDIUM';
    const suggestCategoryId = merchant ? hintCategory(merchant) : undefined;

    return { source: 'alipay', type, amount, merchant: merchant ?? undefined, confidence, suggestCategoryId };
  }
}

/** 单字功能词（商户提取前全局剔除；「您在瑞幸咖啡消费」→「瑞幸咖啡」） */
const FUNC_CHARS = ['您', '在', '了', '的', '已', '等', '及', '和', '与'];

/** 交易尾缀：商户片段末尾剥离（「瑞幸咖啡消费」→「瑞幸咖啡」） */
const MERCHANT_SUFFIXES = ['消费', '付款', '支付', '成功', '订单', '到账', '收款', '入账'];

function guessMerchant(text: string): string | null {
  let remaining = text;
  // ① 剔除动作词，② 剔除营销/系统噪声词（2.16.6），③ 剔除单字功能词
  for (const w of ACTION_WORDS) remaining = remaining.split(w).join(' ');
  for (const w of NOISE_WORDS) remaining = remaining.split(w).join(' ');
  for (const ch of FUNC_CHARS) remaining = remaining.split(ch).join(' ');
  const candidates = remaining
    .split(/[ ,，。:：;；\n]+/)
    .map((s) => s.trim())
    // 只认纯中文（≥2 字）片段：金额残留（如「你有一笔0.01」）不当作商户
    .filter((s) => s.length >= 2 && /^[\u4e00-\u9fa5]+$/.test(s))
    // ④ 剥离交易尾缀并提供是否剥离的标记（真实商户多出现在「XX消费/付款」等之前）
    .map((s) => ({ orig: s, stripped: stripMerchantSuffix(s) }))
    .map((r) => ({ ...r, cleaned: r.stripped.trim() }))
    .filter((r) => (r.cleaned ? r.cleaned.length >= 2 : false));
  if (candidates.length === 0) return null;
  // 优先选「剥离过交易尾缀」的片段（瑞幸咖啡消费→瑞幸咖啡 优于 消费提示）；
  // 同层再按长度取最长。
  const stripped = candidates.filter((c) => c.cleaned !== c.orig);
  const pool = stripped.length > 0 ? stripped : candidates;
  return pool.sort((a, b) => b.cleaned.length - a.cleaned.length)[0].cleaned;
}

function stripMerchantSuffix(s: string): string {
  let cur = s;
  let changed = true;
  while (changed) {
    changed = false;
    for (const suffix of MERCHANT_SUFFIXES) {
      if (cur.endsWith(suffix) && cur.length - suffix.length >= 2) {
        cur = cur.slice(0, cur.length - suffix.length);
        changed = true;
        break;
      }
    }
  }
  return cur;
}

function hintCategory(merchant: string): string | undefined {
  for (const rule of MERCHANT_CATEGORY_HINTS) {
    if (rule.keywords.some((k) => merchant.includes(k))) return rule.categoryId;
  }
  return undefined;
}