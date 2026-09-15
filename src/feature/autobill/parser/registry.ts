/**
 * Daily Value v2 - 自动记账 ParserRegistry（2.16.1 Gate C）
 *
 * 来源架构不写死（禁止 if 支付宝 / if 微信 / if 某银行）：
 * 新来源只需注册 Parser。本期完整实现 AlipayParser，
 * WechatParser / BankParser 注册占位（返回 null = 不建候选）。
 */
import type { AutoBillSource, BillType, AutoBillConfidence } from '@/core/models/types';
import { AlipayParser } from './AlipayParser';
import { WechatParser } from './WechatParser';
import { BankParser } from './BankParser';

/** Parser 输入：Native Notification 最小快照（Web 桥拉取后传入） */
export interface ParserInput {
  packageName: string;
  title: string;
  text: string;
  bigText: string;
  subText: string;
  postTime: number;
}

/** Parser 输出：可建候选的解析结果；null = 不建（无金额/非交易/未实现） */
export interface ParsedResult {
  source: AutoBillSource;
  type: BillType;
  amount: number;
  merchant?: string;
  confidence?: AutoBillConfidence;
  suggestCategoryId?: string;
}

export interface NotificationParser {
  readonly source: AutoBillSource;
  /** 解析；返回 null 表示该通知不应生成候选 */
  parse(input: ParserInput): ParsedResult | null;
}

/** Registry：包名 → Parser（先按来源包名前缀匹配，再到占位兜底） */
const parsers: NotificationParser[] = [
  new AlipayParser(),
  new WechatParser(),
  new BankParser(),
];

/** 已知来源包名（原生白名单同步基于同一映射） */
export const PACKAGE_SOURCE_MAP: Record<string, AutoBillSource> = {
  'com.eg.android.AlipayGphone': 'alipay',
  'com.tencent.mm': 'wechat',
};

/** 按包名路由到对应 Parser；未知包名 → null（不建候选） */
export function parserForPackage(packageName: string): NotificationParser | null {
  const source = PACKAGE_SOURCE_MAP[packageName];
  if (!source) return null;
  return parsers.find((p) => p.source === source) ?? null;
}

/** 应用显示名 → 来源枚举（idb/memory 构造候选时兜底推断） */
export function sourceFromLabel(sourceApp: string): AutoBillSource | undefined {
  if (sourceApp.includes('支付宝')) return 'alipay';
  if (sourceApp.includes('微信')) return 'wechat';
  if (sourceApp.includes('银行') || sourceApp.includes('招商')) return 'bank';
  return undefined;
}