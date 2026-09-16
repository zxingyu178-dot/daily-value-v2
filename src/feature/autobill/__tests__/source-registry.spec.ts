/**
 * 2.17.0 SOURCE-01..04：AutoBill 来源 Registry 单测
 * - SOURCE-01 旧 autoBillAllowedApps（中文名）正确迁移为来源 id
 * - SOURCE-02 Registry 生成 package list 正确（支持来源 → 包名）
 * - SOURCE-03 关闭/开启来源后 Native 包同步（白名单包名集合）正确
 * - SOURCE-04 未知来源不进入 Parser（parserForPackage null）
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { openDatabase } from '@/core/db/database';
import { IdbSettingsService } from '@/core/services/idb';
import {
  AUTOBILL_SOURCES,
  resolveEnabledSources,
  packagesForSourceIds,
  sourceDefinition,
  sourceDefinitionForPackage,
  DEFAULT_SOURCE_IDS,
} from '@/feature/autobill/source-registry';
import { parserForPackage } from '@/feature/autobill/parser/registry';
import { enabledSourceIds } from '@/feature/autobill/service/notification-bridge';

beforeEach(async () => {
  const db = await openDatabase();
  const tx = db.transaction(['settings', 'meta'], 'readwrite');
  for (const s of ['settings', 'meta'] as const) tx.objectStore(s).clear();
  await tx.done;
});

describe('SOURCE-01 旧 Settings 兼容迁移', () => {
  it('旧 autoBillAllowedApps 中文名 → 来源 id（支付宝→alipay / 微信支付→wechat）', () => {
    expect(resolveEnabledSources(undefined, ['支付宝', '微信支付'])).toEqual(['alipay', 'wechat']);
    expect(resolveEnabledSources(undefined, ['支付宝'])).toEqual(['alipay']);
  });

  it('新 autoBillEnabledSources 优先于旧字段', () => {
    expect(resolveEnabledSources(['wechat'], ['支付宝', '微信支付'])).toEqual(['wechat']);
  });

  it('未知来源 id 被过滤；显式空数组 = 全关（停止采集）；均未配置 → 默认支付宝+微信', () => {
    expect(resolveEnabledSources(['alipay', 'unknown-id'], undefined)).toEqual(['alipay']);
    // 显式 []：用户全部关闭（区别于未配置）
    expect(resolveEnabledSources([], [])).toEqual([]);
    // 均未配置 → 默认
    expect(resolveEnabledSources(undefined, undefined)).toEqual(DEFAULT_SOURCE_IDS);
  });

  it('读取旧字段 Settings 后，enabledSourceIds 返回迁移后的来源 id（持久化读取）', async () => {
    await new IdbSettingsService().update({ autoBillAllowedApps: ['微信支付'] });
    expect(await enabledSourceIds()).toEqual(['wechat']);
  });
});

describe('SOURCE-02 Registry 定义与包名生成', () => {
  it('正式支持 = 支付宝 + 微信支付（wallet）；招商银行框架占位 supported=false 且无包名', () => {
    const supported = AUTOBILL_SOURCES.filter((s) => s.supported);
    expect(supported.map((s) => s.id).sort()).toEqual(['alipay', 'wechat']);
    const cmb = sourceDefinition('cmb')!;
    expect(cmb.supported).toBe(false);
    expect(cmb.group).toBe('bank');
    expect(cmb.packageNames).toHaveLength(0); // 未拿真实包名前不硬编码
  });

  it('packagesForSourceIds 生成正确包名列表', () => {
    expect(packagesForSourceIds(['alipay', 'wechat'])).toEqual([
      'com.eg.android.AlipayGphone',
      'com.tencent.mm',
    ]);
    expect(packagesForSourceIds([])).toEqual([]);
  });

  it('包名 → 来源定义（反查）', () => {
    expect(sourceDefinitionForPackage('com.eg.android.AlipayGphone')?.id).toBe('alipay');
    expect(sourceDefinitionForPackage('com.tencent.mm')?.id).toBe('wechat');
    expect(sourceDefinitionForPackage('com.example.evil')).toBeUndefined();
  });
});

describe('SOURCE-03 关闭来源后 Native 包同步（Web 层解析来源 → 包名集合）', () => {
  it('只开启 wechat → 同步包列表仅 com.tencent.mm（alipay 不在白名单）', async () => {
    await new IdbSettingsService().update({ autoBillEnabledSources: ['wechat'] });
    expect(await enabledSourceIds()).toEqual(['wechat']);
    expect(packagesForSourceIds(await enabledSourceIds())).toEqual(['com.tencent.mm']);
  });

  it('全部关闭 → 空包名集合（停止采集）', async () => {
    await new IdbSettingsService().update({ autoBillEnabledSources: [] });
    expect(packagesForSourceIds(await enabledSourceIds())).toEqual([]);
  });
});

describe('SOURCE-04 未知来源不进入 Parser', () => {
  it('未注册包名 / 未支持来源 → parserForPackage = null（不建候选）', () => {
    expect(parserForPackage('com.example.evil')).toBeNull();
    expect(parserForPackage('com.tencent.mm')).not.toBeNull();
    expect(parserForPackage('')).toBeNull();
    expect(parserForPackage(undefined as unknown as string)).toBeNull();
  });
});