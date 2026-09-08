/**
 * Daily Value v2 - 分类图标库（2.9.7 Category Final Refactor：真正本地 SVG 图标体系）
 *
 * 目标：让「分类图标」成为真正本地、统一风格的 SVG 图标体系，替代 2.9.5 的纯 emoji 字形。
 * - 图标源：lucide-vue-next（本地 tree-shakable SVG，无网络 / CDN / 远程字体依赖）。
 * - 统一视觉：线性 / 圆角 SVG，统一 stroke 宽度，颜色跟随 Theme Token（见 DVCategoryIcon.vue）。
 * - 数量：≥40 个常用分类图标（餐饮/咖啡/饮料/交通/汽车/地铁/手机/数码/游戏/住房/水电/话费/
 *   医疗/运动/旅行/学习/工资/红包/礼物/宠物/育儿/美容/衣物/保险/其他…）。
 * - 兼容既有数据：iconType/iconValue 不废弃；BUILTIN_ICONS 保留 2.9.5 的 id 集合与 glyph 兜底
 *   （旧分类 iconValue 指向的 id 仍然有效，只是渲染从 emoji 升级为 SVG）。
 * - 第二选择：自定义 emoji 保留（iconType='emoji'），作为「自定义图标」兜底。
 *
 * Category.iconType/iconValue（见 types.ts）：
 *   - iconType='builtin' → iconValue 存本表 id，渲染用 DVCategoryIcon / categoryIconComponent()
 *   - iconType='emoji'   → iconValue 存用户手输 emoji，渲染直接用 emoji
 *   - 旧数据（无 iconType/iconValue）→ 回退 cat.emoji
 */
import type { LucideIcon } from 'lucide-vue-next';
import {
  Utensils, Coffee, Milk, Cookie, ShoppingBag, ShoppingCart, Bus, Car, TramFront, TrainFront, Bike,
  Smartphone, Phone, Laptop, Computer, Gamepad2, Dices, Clapperboard, Music, Camera, Tv,
  House, Building2, KeyRound, Sofa, Droplets, Zap, Store, Wifi,
  Pill, Stethoscope, Dumbbell, Activity, Plane, GraduationCap, BookOpen,
  Banknote, HandCoins, Trophy, Coins, RotateCcw, Gift, PawPrint, Baby, Sparkles, Shirt, MessageCircle,
  ShieldCheck, Package,
} from 'lucide-vue-next';

export interface BuiltinIcon {
  /** 唯一 id（存入 Category.iconValue） */
  id: string;
  /** 中文标签（图标选择器展示） */
  label: string;
  /** 本地 SVG 组件（lucide-vue-next，线性/圆角统一风格） */
  component: LucideIcon;
  /** 兼容字形（emoji，作为 SVG 不可用/旧渲染路径的兜底展示） */
  glyph: string;
}

/**
 * 内置分类图标库（49 个，本地 SVG）。
 * 2.9.5 的 24 个 id 全部保留（id/glyph 不变，渲染升级为 SVG），保证既有 iconValue 兼容；
 * 新增 25 个覆盖更细分类（咖啡/汽车/地铁/火车/骑行/网购/相机/电视/房租/水电/电费/物业/网络/
 * 药品/健身/学费/收入/奖金/红包/退款/衣物等）。
 */
export const BUILTIN_ICONS: BuiltinIcon[] = [
  /* ---- 餐饮 / 生活 ---- */
  { id: 'dining', label: '餐饮', component: Utensils, glyph: '🍚' },
  { id: 'coffee', label: '咖啡', component: Coffee, glyph: '☕' },
  { id: 'drink', label: '饮料', component: Milk, glyph: '🥤' },
  { id: 'snack', label: '零食', component: Cookie, glyph: '🍿' },
  { id: 'shopping', label: '购物', component: ShoppingBag, glyph: '🛍️' },
  { id: 'cart', label: '网购', component: ShoppingCart, glyph: '🛒' },
  /* ---- 交通 / 出行 ---- */
  { id: 'transport', label: '交通', component: Bus, glyph: '🚗' },
  { id: 'car', label: '汽车', component: Car, glyph: '🚘' },
  { id: 'subway', label: '地铁', component: TramFront, glyph: '🚇' },
  { id: 'train', label: '火车', component: TrainFront, glyph: '🚆' },
  { id: 'bike', label: '骑行', component: Bike, glyph: '🚲' },
  /* ---- 数码 / 娱乐 ---- */
  { id: 'phone', label: '手机', component: Smartphone, glyph: '📲' },
  { id: 'phone-bill', label: '话费', component: Phone, glyph: '📱' },
  { id: 'computer', label: '电脑', component: Computer, glyph: '🖥️' },
  { id: 'digital', label: '数码', component: Laptop, glyph: '💻' },
  { id: 'fun', label: '娱乐', component: Gamepad2, glyph: '🎮' },
  { id: 'game', label: '游戏', component: Dices, glyph: '🎲' },
  { id: 'movie', label: '影视', component: Clapperboard, glyph: '🎬' },
  { id: 'music', label: '音乐', component: Music, glyph: '🎵' },
  { id: 'camera', label: '相机', component: Camera, glyph: '📷' },
  { id: 'tv', label: '电视', component: Tv, glyph: '📺' },
  /* ---- 居住 / 水电 ---- */
  { id: 'life', label: '生活', component: House, glyph: '🏠' },
  { id: 'housing', label: '住房', component: Building2, glyph: '🏢' },
  { id: 'rent', label: '房租', component: KeyRound, glyph: '🗝️' },
  { id: 'homeware', label: '家居', component: Sofa, glyph: '🛋️' },
  { id: 'water', label: '水电', component: Droplets, glyph: '💧' },
  { id: 'elec', label: '电费', component: Zap, glyph: '⚡' },
  { id: 'property', label: '物业', component: Store, glyph: '🏬' },
  { id: 'network', label: '网络', component: Wifi, glyph: '📶' },
  /* ---- 健康 / 学习 ---- */
  { id: 'medical', label: '医疗', component: Pill, glyph: '💊' },
  { id: 'medicine', label: '药品', component: Stethoscope, glyph: '💉' },
  { id: 'sport', label: '运动', component: Dumbbell, glyph: '⚽' },
  { id: 'gym', label: '健身', component: Activity, glyph: '🏋️' },
  { id: 'travel', label: '旅行', component: Plane, glyph: '✈️' },
  { id: 'study', label: '学习', component: GraduationCap, glyph: '📚' },
  { id: 'school', label: '学费', component: BookOpen, glyph: '🎓' },
  /* ---- 收入 / 财务 ---- */
  { id: 'salary', label: '工资', component: Banknote, glyph: '💰' },
  { id: 'income', label: '收入', component: HandCoins, glyph: '💵' },
  { id: 'bonus', label: '奖金', component: Trophy, glyph: '🏆' },
  { id: 'redpacket', label: '红包', component: Coins, glyph: '🧧' },
  { id: 'refund', label: '退款', component: RotateCcw, glyph: '↩️' },
  { id: 'gift', label: '礼物', component: Gift, glyph: '🎁' },
  /* ---- 家庭 / 个人 ---- */
  { id: 'pet', label: '宠物', component: PawPrint, glyph: '🐱' },
  { id: 'family', label: '育儿', component: Baby, glyph: '👶' },
  { id: 'beauty', label: '美容', component: Sparkles, glyph: '💄' },
  { id: 'clothes', label: '衣物', component: Shirt, glyph: '👕' },
  { id: 'social', label: '社交', component: MessageCircle, glyph: '💬' },
  { id: 'insurance', label: '保险', component: ShieldCheck, glyph: '🛡️' },
  /* ---- 其他 ---- */
  { id: 'other', label: '其他', component: Package, glyph: '📦' },
];

/** 按 id 取内置图标 */
export function builtinIconById(id?: string): BuiltinIcon | undefined {
  return BUILTIN_ICONS.find((i) => i.id === id);
}

/**
 * 取分类展示字形（emoji 兜底字符串）：
 * builtin → 内置图标 glyph；否则回退 emoji（含旧数据）。
 * 注：2.9.7 起正式 UI 用 DVCategoryIcon 渲染（builtin → SVG，emoji → 文字）；
 * 本函数仍保留，供非正式/测试与 SVG 不可用时的纯文本兜底。
 */
export function categoryGlyph(cat: {
  iconType?: 'emoji' | 'builtin';
  iconValue?: string;
  emoji: string;
}): string {
  if (cat.iconType === 'builtin') {
    return builtinIconById(cat.iconValue)?.glyph ?? cat.emoji;
  }
  return cat.emoji;
}

/**
 * 取分类的本地 SVG 图标组件（builtin 时返回 lucide 组件；emoji/旧数据返回 undefined，走 emoji 渲染）。
 * 用于 DVCategoryIcon 统一渲染。
 */
export function categoryIconComponent(cat: {
  iconType?: 'emoji' | 'builtin';
  iconValue?: string;
}): LucideIcon | undefined {
  if (cat.iconType !== 'builtin') return undefined;
  return builtinIconById(cat.iconValue)?.component;
}

/** 是否为内置图标分类（决定是否渲染统一 SVG 图标格样式） */
export function isBuiltinIcon(cat: { iconType?: 'emoji' | 'builtin' }): boolean {
  return cat.iconType === 'builtin';
}
