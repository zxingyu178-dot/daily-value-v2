/**
 * Daily Value v2 - 账单 CSV 导出（2.14.0）
 *
 * - UTF-8 BOM（Excel 直接打开中文不乱码）+ CRLF 行尾
 * - 字段：日期,时间,类型,金额,分类,备注,来源,账本影响
 * - 金额纯数字（25.50），不带币种符号
 * - 完整 CSV escaping（逗号/双引号/换行），不用 join(',')
 * - 导出全部账单，账本影响列区分 普通账单 / 仅日价（不丢数据）
 */
import type { Bill } from '@/core/models/types';

export const CSV_HEADER = ['日期', '时间', '类型', '金额', '分类', '备注', '来源', '账本影响'];

/** RFC 4180 字段转义：含 逗号/双引号/换行 时用双引号包裹，内部双引号翻倍 */
export function csvEscape(value: string): string {
  if (value.includes('"') || value.includes(',') || value.includes('\n') || value.includes('\r')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** 时间列来源：HH:mm（本地时间，由 timestamp 派生；无 timestamp 回退 '00:00'） */
function timeOf(bill: Bill): string {
  const ts = typeof bill.timestamp === 'number' && Number.isFinite(bill.timestamp) ? bill.timestamp : 0;
  const d = new Date(ts);
  if (ts === 0 || Number.isNaN(d.getTime())) return '00:00';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 单条账单 → CSV 行数据（数组，随后统一转义） */
export function billToCsvRow(bill: Bill): string[] {
  const sourceLabel =
    bill.source === 'manual' ? '手动' : bill.source === 'recurring' ? '周期' : '导入';
  const ledgerLabel = bill.ledgerImpact === 'daily-value-only' ? '仅日价' : '普通账单';
  return [
    bill.date ?? '',
    timeOf(bill),
    bill.type === 'expense' ? '支出' : '收入',
    bill.amount.toFixed(2), // 纯数字
    bill.categoryName ?? '',
    bill.note ?? '',
    sourceLabel,
    ledgerLabel,
  ];
}

/** 全部账单 → CSV 文本（含 BOM）。bill 顺序保持传入顺序，不入库排序。 */
export function buildBillsCsv(bills: Bill[]): string {
  const lines: string[] = [CSV_HEADER.map(csvEscape).join(',')];
  for (const b of bills) {
    lines.push(billToCsvRow(b).map(csvEscape).join(','));
  }
  // CRLF + BOM：Excel 直接打开不乱码
  return '\uFEFF' + lines.join('\r\n') + '\r\n';
}