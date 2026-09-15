/**
 * Daily Value v2 - 银行通知解析器（2.16.1 Gate C：框架占位）
 * 预留分支（招商银行第一优先级）；本阶段不实现。
 * 当前返回 null = 不建候选。
 */
import type { AutoBillSource } from '@/core/models/types';
import type { NotificationParser, ParsedResult, ParserInput } from './registry';

export class BankParser implements NotificationParser {
  readonly source: AutoBillSource = 'bank';

  parse(_input: ParserInput): ParsedResult | null {
    // 占位：后续按银行子类扩展（CMB/ICBC/CCB/BOC）
    return null;
  }
}