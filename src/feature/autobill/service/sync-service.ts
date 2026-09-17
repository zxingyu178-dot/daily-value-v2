/**
 * Daily Value v2 - AutoBillSyncService（2.16.1 Gate C）
 *
 * 分层：UI → Service → Repository(services) → Database。
 * 禁止页面直接读取 Native Queue。本服务是原生通知 → 业务候选的唯一通道：
 *   拉取 Native Pending → 按包名路由 ParserRegistry → 解析成功生成 AutoBillCandidate
 *   → 处理完 ack（解析失败/未知来源同样 ack，不进入候选）。
 *
 * 幂等：生成候选走 services.autoBill.ingest（hash + 10 分钟近邻去重），重复通知不会多建。
 */
import { services } from '@/core/services';
import type { AutoBillSource } from '@/core/models/types';
import { parserForPackage } from '@/feature/autobill/parser/registry';
import {
  pullPendingNativeNotifications,
  ackPendingNativeNotifications,
} from '@/feature/autobill/service/notification-bridge';
import {
  resolveEnabledSources,
  packagesForSourceIds,
} from '@/feature/autobill/source-registry';

export interface AutoBillSyncSummary {
  /** 本次从原生拉到的记录数 */
  received: number;
  /** 生成的新候选数 */
  created: number;
  /** 跳过数（无金额/非交易/未知来源/去重命中） */
  skipped: number;
}

/** 来源枚举 → 应用显示名（候选 sourceApp 展示用） */
export function sourceAppLabel(source: AutoBillSource): string {
  switch (source) {
    case 'alipay':
      return '支付宝';
    case 'wechat':
      return '微信支付';
    case 'bank':
      return '银行卡通知';
    default:
      return source;
  }
}

/**
 * 同步一次：Native Queue → Parser → AutoBillCandidate。
 * 总开关关闭时不拉取（不采集）。失败静默（不影响主流程/首页）。
 *
 * 2.17.1 P0 双层防线：即使 Native 白名单已正确，本函数仍以「当前 Settings」重新计算
 * 有效来源（effectiveSourceIds / effectivePackages）。对 Native Queue 中已有的记录，
 * 若其 packageName 已不在当前有效来源（例如用户先收到微信通知、随后关闭微信来源），
 * 则【不 Parser / 不生成 Candidate / ack 掉】，防止旧队列中的关闭来源进入账本流程。
 */
export async function syncAutoBillNotifications(): Promise<AutoBillSyncSummary> {
  try {
    const settings = await services.settings.get();
    if (!settings.autoBillEnabled) {
      return { received: 0, created: 0, skipped: 0 };
    }
    // 2.17.1 P0：同步时读取当前 Settings，计算“此刻仍被用户启用”的来源与包名集合。
    const effectiveSourceIds = resolveEnabledSources(
      settings.autoBillEnabledSources,
      settings.autoBillAllowedApps,
    );
    const effectivePackages = new Set(packagesForSourceIds(effectiveSourceIds));
    const records = await pullPendingNativeNotifications();
    if (records.length === 0) {
      return { received: 0, created: 0, skipped: 0 };
    }
    let created = 0;
    const handledIds: string[] = [];
    for (const r of records) {
      handledIds.push(r.id); // 无论结果如何，本机处理完即 ack（不会重复导入）
      // 2.17.1 P0：第二道来源边界。包名不在当前有效来源 → 跳过（不解析、不建候选），仅 ack。
      if (!effectivePackages.has(r.packageName)) continue;
      const parser = parserForPackage(r.packageName);
      if (!parser) continue; // 未知来源：不建候选（原生白名单外本就不该有）
      const result = parser.parse({
        packageName: r.packageName,
        title: r.title,
        text: r.text,
        bigText: r.bigText,
        subText: r.subText,
        postTime: r.postTime,
        // 2.17.0：channelId 贯通 Native → Web → Parser（微信区分 聊天/支付/服务通知 的信号）
        channelId: r.channelId,
      });
      if (!result) continue; // 无金额/非交易/未实现：跳过
      const ingestRes = await services.autoBill.ingest({
        sourceApp: sourceAppLabel(result.source),
        rawText: [r.title, r.text, r.bigText].filter((s) => s && s.trim()).join(' '),
        postedAt: r.postTime,
        // 2.17.2：notificationKey / sourcePackage 贯通到 ingest（去重第一优先级信号）
        sourcePackage: r.packageName,
        notificationKey: r.notificationKey,
        parsed: {
          source: result.source,
          confidence: result.confidence,
          suggestCategoryId: result.suggestCategoryId,
          type: result.type,
          // 2.16.2：解析结果完整传递（金额/商户唯一真实来源，不再由 ingest 重新猜）
          amount: result.amount,
          merchant: result.merchant,
        },
      });
      if (ingestRes.created) created += 1;
    }
    await ackPendingNativeNotifications(handledIds);
    return { received: records.length, created, skipped: records.length - created };
  } catch (err) {
    // 生产不打扰用户；开发模式保留可诊断信息（绝不记录 raw payment 文本，只记类型/阶段）
    // eslint-disable-next-line no-console
    console.warn('[AutoBill] sync failed:', String(err));
    return { received: 0, created: 0, skipped: 0 };
  }
}