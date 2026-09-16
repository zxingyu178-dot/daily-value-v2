/**
 * Daily Value v2 - ParserRegistry（2.16.1 Gate C；2.17.0 改用 Source Registry 路由）
 *
 * 来源定义唯一来自 source-registry.ts：包名 → 来源 → Parser，禁止本文件再维护
 * 一份独立的「包名 → 来源」映射（杜绝 Registry 说支持但 Parser 不认识包的漂移）。
 * 本期完整实现 AlipayParser / WechatParser；BankParser 为占位（返回 null = 不建候选）。
 */
import type { AutoBillSource, BillType, AutoBillConfidence } from '@/core/models/types';
import { sourceDefinitionForPackage } from '@/feature/autobill/source-registry';
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
  /** 2.17.0：通知渠道 id（同包名下区分 聊天/支付/服务通知 的信号；可空） */
  channelId?: string;
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

/** Registry：Parser 实例（按 source 枚举寻址） */
const parsers: NotificationParser[] = [
  new AlipayParser(),
  new WechatParser(),
  new BankParser(),
];

/** 按包名路由到对应 Parser（经 Source Registry；未知/未支持来源 → null 不建候选） */
export function parserForPackage(packageName: string): NotificationParser | null {
  const def = sourceDefinitionForPackage(packageName);
  if (!def) return null;
  return parsers.find((p) => p.source === def.parserId) ?? null;
}

/** 应用显示名 → 来源枚举（idb/memory 构造候选时兜底推断） */
export function sourceFromLabel(sourceApp: string): AutoBillSource | undefined {
  if (sourceApp.includes('支付宝')) return 'alipay';
  if (sourceApp.includes('微信')) return 'wechat';
  if (sourceApp.includes('银行') || sourceApp.includes('招商')) return 'bank';
  return undefined;
}