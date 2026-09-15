/**
 * 2.14.0 账单 CSV 导出测试（CSV-01..05）
 * - CSV-01 中文分类/备注 + UTF-8 BOM（Excel 直接打开不乱码）
 * - CSV-02 金额纯数字（25.50，无币种符号）
 * - CSV-03 Expense/Income 类型正确
 * - CSV-04 normal / daily-value-only 都有正确账本影响标识
 * - CSV-05 备注含 逗号/双引号/换行 → RFC4180 escaping（不手拼 join(',')）
 */
import { describe, it, expect } from 'vitest';
import { csvEscape, billToCsvRow, buildBillsCsv, CSV_HEADER } from '@/core/backup/csv';
import type { Bill } from '@/core/models/types';

function makeBill(over: Partial<Bill> = {}): Bill {
  return {
    id: 'b1',
    type: 'expense',
    amount: 25.5,
    categoryId: 'c-food',
    categoryEmoji: '🍚',
    categoryName: '餐饮',
    note: '午饭',
    date: '2026-09-14',
    timestamp: 1757802000000, // 2026-09-14 13:20 附近（本地时间）
    source: 'manual',
    ledgerImpact: 'normal',
    ...over,
  } as Bill;
}

describe('CSV-01 BOM + 中文（Excel 直接打开不乱码）', () => {
  it('buildBillsCsv 输出以 UTF-8 BOM（\uFEFF）开头，中文按 UTF-8 原样存在', () => {
    const csv = buildBillsCsv([makeBill({ categoryName: '交通', note: '地铁通勤' })]);
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain('交通');
    expect(csv).toContain('地铁通勤');
    expect(csv).toContain('普通账单');
  });

  it('CSV-02 金额纯数字：不带币种符号、保留两位小数', () => {
    expect(billToCsvRow(makeBill({ amount: 25.5 }))[3]).toBe('25.50');
    expect(billToCsvRow(makeBill({ amount: 100 }))[3]).toBe('100.00');
    expect(billToCsvRow(makeBill({ amount: 0.1 }))[3]).toBe('0.10');
    expect(billToCsvRow(makeBill({ amount: -0 }))[3]).toBe('0.00');
  });
});

describe('CSV-03/04 类型与账本影响', () => {
  it('Expense → 支出；Income → 收入', () => {
    expect(billToCsvRow(makeBill({ type: 'expense' }))[2]).toBe('支出');
    expect(billToCsvRow(makeBill({ type: 'income' }))[2]).toBe('收入');
  });

  it('CSV-04 normal → 普通账单；daily-value-only → 仅日价（两者都保留，不丢数据）', () => {
    expect(billToCsvRow(makeBill({ ledgerImpact: 'normal' }))[7]).toBe('普通账单');
    expect(billToCsvRow(makeBill({ ledgerImpact: 'daily-value-only' }))[7]).toBe('仅日价');
  });

  it('头行包含「账本影响」列；来源列正确', () => {
    expect(CSV_HEADER).toEqual(['日期', '时间', '类型', '金额', '分类', '备注', '来源', '账本影响']);
    expect(billToCsvRow(makeBill({ source: 'manual' }))[6]).toBe('手动');
    expect(billToCsvRow(makeBill({ source: 'recurring' }))[6]).toBe('周期');
  });
});

describe('CSV-05 RFC4180 escaping（不手拼 join(",")）', () => {
  it('含逗号 → 整体加双引号', () => {
    expect(csvEscape('午餐,加蛋')).toBe('"午餐,加蛋"');
  });

  it('含双引号 → 内部双引号翻倍并整体加引号', () => {
    expect(csvEscape('他说"好吃"')).toBe('"他说""好吃"""');
  });

  it('含换行 → 整体加双引号（保留换行）', () => {
    expect(csvEscape('第一行\n第二行')).toBe('"第一行\n第二行"');
    expect(csvEscape('第一行\r\n第二行')).toBe('"第一行\r\n第二行"');
  });

  it('普通文本不加引号', () => {
    expect(csvEscape('普通文本')).toBe('普通文本');
  });

  it('整行组装：备注含逗号+引号+换行 → 该字段转义并加引号，行内其余字段不被破坏', () => {
    const row = billToCsvRow(makeBill({ note: '买菜, 水果 "特价"\n第二行' }));
    const line = row.map(csvEscape).join(',');
    expect(line).toContain('"买菜, 水果 ""特价""\n第二行"');
    expect(line.startsWith('2026-09-14,')).toBe(true);
    expect(line).toContain(',25.50,');
  });

  it('buildBillsCsv 行尾 CRLF；日期/时间列存在', () => {
    const csv = buildBillsCsv([makeBill()]);
    expect(csv.includes('\r\n')).toBe(true);
    expect(csv).toMatch(/2026-09-14,\d{2}:\d{2},支出,25\.50,餐饮,午饭,手动,普通账单/);
  });
});