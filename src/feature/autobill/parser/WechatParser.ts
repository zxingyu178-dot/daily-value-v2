/**
 * Daily Value v2 - 微信支付解析器（2.16.1 Gate C：框架占位）
 * 完整微信解析下一子阶段实现（验证支付宝闭环稳定后）。
 * 当前返回 null = 不建候选（不误抓）。
 */
import type { AutoBillSource } from '@/core/models/types';
import type { NotificationParser, ParsedResult, ParserInput } from './registry';

export class WechatParser implements NotificationParser {
  readonly source: AutoBillSource = 'wechat';

  parse(_input: ParserInput): ParsedResult | null {
    // Gate C 占位：待 WeChat 通知模板验证后实现
    return null;
  }
}