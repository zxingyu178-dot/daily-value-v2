/**
 * Daily Value v2 - 分类定义统一真源（2.9.7 Category Final Refactor）
 *
 * 唯一权威来源：核心内置分类（CORE_BUILTINS，5 类，不可删除）+ 默认预置分类（DEFAULT_PRESETS，
 * 7 类，builtin=false，可自由编辑/删除）。
 *
 * 2.9.5 曾把 12 个分类全部标为 builtin=true（强制不可删除），导致：
 * - 用户自定义的「饮料」与系统「c-drink 饮料」并存，实机出现「饮料 + 饮料」「一个有×一个没×」。
 * 2.9.7 收紧为：只有最初的 5 类系统分类是核心（🔒 不可删除、可改图标）；其余 7 个默认分类一律
 * builtin=false，作为「新安装预置」，用户可删除/改名/改图标（删除后重启绝不复活，见 services/index.ts
 * initCore 的 reconciliation 逻辑）。
 *
 * 各消费方（services/index.ts、memory.ts、v1-to-v2 迁移、测试 fixture、Handoff）必须从这里取定义，
 * 禁止各自硬编码一套「核心分类」。
 */
import type { Category } from '@/core/models/types';

/**
 * 系统核心分类（固定 id，🔒 不可删除；可修改图标）。
 * 与 2.9.5 之前的原始 5 类完全一致。
 */
export const CORE_BUILTINS: Category[] = [
  { id: 'c-food', name: '餐饮', emoji: '🍚', iconType: 'builtin', iconValue: 'dining', builtin: true, sort: 1 },
  { id: 'c-transport', name: '交通', emoji: '🚗', iconType: 'builtin', iconValue: 'transport', builtin: true, sort: 2 },
  { id: 'c-shopping', name: '购物', emoji: '🛍️', iconType: 'builtin', iconValue: 'shopping', builtin: true, sort: 3 },
  { id: 'c-fun', name: '娱乐', emoji: '🎮', iconType: 'builtin', iconValue: 'fun', builtin: true, sort: 4 },
  { id: 'c-life', name: '生活', emoji: '🏠', iconType: 'builtin', iconValue: 'life', builtin: true, sort: 5 },
];

/**
 * 默认预置分类（固定 id，builtin=false）。
 * 新安装时预置；用户可删除/改名/改图标。删除后重启不复活（见 initCore reconciliation）。
 * 这些分类正是 2.9.5 曾错误标为 builtin=true 的那 7 个。
 */
export const DEFAULT_PRESETS: Category[] = [
  { id: 'c-drink', name: '饮料', emoji: '🥤', iconType: 'builtin', iconValue: 'drink', builtin: false, sort: 6 },
  { id: 'c-bill', name: '话费', emoji: '📱', iconType: 'builtin', iconValue: 'phone-bill', builtin: false, sort: 7 },
  { id: 'c-salary', name: '工资', emoji: '💰', iconType: 'builtin', iconValue: 'salary', builtin: false, sort: 8 },
  { id: 'c-medical', name: '医疗', emoji: '💊', iconType: 'builtin', iconValue: 'medical', builtin: false, sort: 9 },
  { id: 'c-housing', name: '住房', emoji: '🏢', iconType: 'builtin', iconValue: 'housing', builtin: false, sort: 10 },
  { id: 'c-travel', name: '旅行', emoji: '✈️', iconType: 'builtin', iconValue: 'travel', builtin: false, sort: 11 },
  { id: 'c-other', name: '其他', emoji: '📦', iconType: 'builtin', iconValue: 'other', builtin: false, sort: 12 },
];

/** 2.9.5 曾强制 builtin=true 的 7 个「待降级」固定分类 id（reconciliation 用） */
export const LEGACY_FIXED_PRESET_IDS: string[] = DEFAULT_PRESETS.map((c) => c.id);

/** 全部内置定义（核心 + 预置），用于新安装首写与迁移对齐 */
export const BUILTIN_CATEGORIES: Category[] = [...CORE_BUILTINS, ...DEFAULT_PRESETS];
