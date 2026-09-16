/**
 * Daily Value v2 - AutoBill 来源注册表（2.17.0 Source Expansion Gate 1）
 *
 * 单一事实源：Web UI / Native 包同步 / Parser 路由 / 安装状态查询都从本表派生，
 * 禁止在各模块各自维护「支付宝/微信/银行」的业务列表（历史四份定义合并于此）。
 *
 * 约定：
 * - supported=true 才可被用户开启并参与解析（未开=UI 不展示可用开关、Parser 不路由）。
 * - packageNames 是内部路由用的包名；展示一律用 label（支付宝 / 微信支付…），
 *   绝不把 com.tencent.mm 之类包名暴露给用户。
 * - 银行来源（cmb 等）在拿到真实 packageName + 真实样本 + Parser 前只注册框架
 *   supported=false；写 Release Notes 同理，不见证据不写“支持 XX银行”。
 */
import type { AutoBillSource } from '@/core/models/types';

/** 来源 id（运行时候选 source 枚举的父级；cmb 为框架占位 id） */
export type AutoBillSourceId = 'alipay' | 'wechat' | 'cmb';

export interface AutoBillSourceDefinition {
  id: AutoBillSourceId;
  /** 用户展示名（候选 sourceApp / 设置开关） */
  label: string;
  group: 'wallet' | 'bank';
  /** 内部真实包名（Native 白名单 / Parser 路由）。空 = 暂未确认包名。 */
  packageNames: string[];
  /** 绑定 Parser 的 source 枚举（supported=true 时必须有对应 Parser） */
  parserId: AutoBillSource;
  /** 是否正式支持（=已有 Parser + 样本验证；否则 UI 不展示可操作开关） */
  supported: boolean;
}

/** 2.17.0：正式支持 支付宝 / 微信支付；招商银行仅框架占位（无真实包名与 Parser） */
export const AUTOBILL_SOURCES: AutoBillSourceDefinition[] = [
  {
    id: 'alipay',
    label: '支付宝',
    group: 'wallet',
    packageNames: ['com.eg.android.AlipayGphone'],
    parserId: 'alipay',
    supported: true,
  },
  {
    id: 'wechat',
    label: '微信支付',
    group: 'wallet',
    packageNames: ['com.tencent.mm'],
    parserId: 'wechat',
    supported: true,
  },
  {
    id: 'cmb',
    label: '招商银行',
    group: 'bank',
    // 未拿到真机确认的 packageName 前不得填写包名（禁止凭印象硬编码）
    packageNames: [],
    parserId: 'bank',
    supported: false,
  },
];

/** 按 id 查定义（未知 id → undefined） */
export function sourceDefinition(id: string): AutoBillSourceDefinition | undefined {
  return AUTOBILL_SOURCES.find((s) => s.id === id);
}

/** 正式支持的来源定义 */
export function supportedSourceDefinitions(): AutoBillSourceDefinition[] {
  return AUTOBILL_SOURCES.filter((s) => s.supported);
}

/** 按分组取定义（UI 分组渲染用） */
export function sourceDefinitionsByGroup(group: AutoBillSourceDefinition['group']): AutoBillSourceDefinition[] {
  return AUTOBILL_SOURCES.filter((s) => s.group === group);
}

/** 来源 id 集合 → 全部包名（Native 白名单同步；空集合 = 停止采集） */
export function packagesForSourceIds(ids: readonly string[]): string[] {
  const out: string[] = [];
  for (const id of ids ?? []) {
    const def = sourceDefinition(id);
    if (def) out.push(...def.packageNames);
  }
  return out;
}

/** 包名 → 来源定义（Parser 路由 / 白名单判定；未知包名 → undefined） */
export function sourceDefinitionForPackage(packageName: string): AutoBillSourceDefinition | undefined {
  if (!packageName) return undefined;
  return AUTOBILL_SOURCES.find(
    (s) => s.packageNames.includes(packageName) && s.supported,
  );
}

/* ---- 旧 Settings 兼容（2.17.0：autoBillAllowedApps: string[] → autoBillEnabledSources: source id[]） ---- */

/** 旧字段中文应用名 → 来源 id（迁移辅助） */
const LEGACY_LABEL_TO_ID: Record<string, AutoBillSourceId> = {
  支付宝: 'alipay',
  微信支付: 'wechat',
};

/** 默认开启来源（总开关默认关闭，一旦开启即默认 支付宝+微信支付） */
export const DEFAULT_SOURCE_IDS: AutoBillSourceId[] = ['alipay', 'wechat'];

/**
 * 把任意旧/新 Settings 形态解析为「来源 id 数组」：
 * - 新字段 autoBillEnabledSources 存在（哪怕 []）→ 直接使用（过滤未知/不支持 id；
 *   显式 [] = 用户全部关闭 = 空，语义为停止采集，区别于「未配置」）；
 * - 否则旧字段 autoBillAllowedApps（中文名）→ 迁移映射（支付宝→alipay…）；
 * - 两个字段都未配置 → 默认 DEFAULT_SOURCE_IDS。
 */
export function resolveEnabledSources(
  enabledSources?: readonly string[],
  legacyAllowedApps?: readonly string[],
): AutoBillSourceId[] {
  if (enabledSources !== undefined) {
    return enabledSources
      .map((id) => (sourceDefinition(id) ? (id as AutoBillSourceId) : undefined))
      .filter((id): id is AutoBillSourceId => Boolean(id));
  }
  if (legacyAllowedApps !== undefined) {
    const mapped = legacyAllowedApps
      .map((label) => LEGACY_LABEL_TO_ID[label.trim()])
      .filter((id): id is AutoBillSourceId => Boolean(id));
    return mapped;
  }
  return [...DEFAULT_SOURCE_IDS];
}

/** 来源 id → 用户展示名（候选 sourceApp / 缺省标签） */
export function sourceLabel(sourceId: string): string {
  return sourceDefinition(sourceId)?.label ?? sourceId;
}