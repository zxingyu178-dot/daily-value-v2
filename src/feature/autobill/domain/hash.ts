/**
 * Daily Value v2 - 自动记账 去重指纹（2.15.0 Gate A）
 *
 * 需求：同一笔支付可能推送多条通知（付款成功 / 交易完成 / 商户通知），
 * 绝不能产生多笔候选账单。指纹规则（按规格）：
 *   sourceApp + amount + merchant + 时间窗口（天）+ rawText（归一化）
 *
 * 不参与指纹的字段刻意排除：通知时间戳精确值（同一笔跨天推送时间窗口取「交易发生日」）。
 * 实现为确定性哈希（djb2），纯函数、可跨 session 复现。
 */
import type { BillType } from '@/core/models/types';

/** 归一化文本：去首尾空白、压缩内部空白、转小写（金额/中文商户匹配不受大小写影响） */
export function normalizeNotificationText(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

/** 本地日期键 yyyy-MM-dd（时间窗口用「交易发生日」，跨天推送仍归同一笔） */
export function dayKey(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** djb2 确定性哈希 → 8 位十六进制串 */
export function hashString(input: string): string {
  let h = 5381;
  for (let i = 0; i < input.length; i += 1) {
    h = ((h << 5) + h + input.charCodeAt(i)) | 0;
  }
  // 转无符号十六进制并截断 8 位
  return (h >>> 0).toString(16).padStart(8, '0');
}

export interface NotificationHashInput {
  sourceApp: string;
  amount: number;
  merchant: string;
  type: BillType;
  /** 交易发生时间 ms；时间窗口取该时间的「天」 */
  transactionTime: number;
  rawText: string;
}

/** 生成去重指纹（确定性） */
export function buildNotificationHash(input: NotificationHashInput): string {
  const raw = `sourceApp=${input.sourceApp}|amount=${input.amount}|type=${input.type}|merchant=${input.merchant}|day=${dayKey(input.transactionTime)}|text=${normalizeNotificationText(input.rawText)}`;
  return hashString(raw);
}

/**
 * 2.17.2：rawText 归一化后的确定性哈希（隐私最小化：新候选不再持久化完整通知文本，
 * 只保存本哈希供未来审计/比对）。等于通知全文指纹，与 notificationHash 独立。
 */
export function buildRawTextHash(rawText: string): string {
  return hashString(normalizeNotificationText(rawText ?? ''));
}