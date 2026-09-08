/**
 * Daily Value v2 - 迁移层类型定义
 * 目标（rules/Migration_Rules.md）：
 * - 用户升级 APK 不卸载，数据保留
 * - 仅迁移 Bill 账单数据 + 日价数据；不迁移壁纸/主题/Widget/预算/UI状态/其他设置
 * - 启动时检测数据版本并执行迁移
 * - 迁移前备份 v1 数据 + 迁移后数量校验（用户确认的 Phase 0 调整）
 */
import type { IDBPDatabase } from 'idb';
import type { DvSchema } from '@/core/db/database';

/** 当前 v2 数据版本（meta.dataVersion） */
export const CURRENT_DATA_VERSION = 1;

/** 单类数据的数量校验记录 */
export interface CountCheck {
  /** 标签（如 'bills' / 'categories'） */
  label: string;
  /** v1 源数量 */
  source: number;
  /** v2 迁移后数量 */
  migrated: number;
  /** 是否校验通过（source === migrated，或按规则允许差异） */
  pass: boolean;
  /** 差异说明 */
  note?: string;
}

/** 单类数据的内容校验记录（如金额合计、字段映射抽查） */
export interface ContentCheck {
  /** 标签（如 'amount-total' / 'transfer-map'） */
  label: string;
  /** v1 侧结果描述 */
  source: string;
  /** v2 侧结果描述 */
  migrated: string;
  /** 是否校验通过 */
  pass: boolean;
  /** 差异说明 */
  note?: string;
}

/** 迁移结果汇总（数量 + 内容校验） */
export interface MigrationChecks {
  counts?: CountCheck[];
  contents?: ContentCheck[];
}

/** v1 数据快照（迁移前备份） */
export interface V1Backup {
  timestamp: string;
  /** v1 localStorage 原始数据（按键） */
  data: Record<string, unknown>;
}

/** 迁移上下文：向迁移函数提供 DB、备份、数量校验与诊断能力 */
export interface MigrationContext {
  db: IDBPDatabase<DvSchema>;
  /** 记录迁移日志（写入 meta / 控制台） */
  log(message: string): void;
  /**
   * 迁移前备份 v1 数据（幂等：仅首次执行）。
   * 快照写入 IndexedDB meta 存储，供回滚排查；迁移成功后不清除 v1 localStorage。
   */
  backupV1(): Promise<void>;
  /** 读取迁移前备份（诊断/回滚用） */
  getV1Backup(): Promise<V1Backup | undefined>;
  /** 标记已完成迁移的 v1 数据键（防止重复迁移；由管理器在全部成功后统一写入） */
  markV1Migrated(key: string): Promise<void>;
  isV1Migrated(key: string): Promise<boolean>;
  /** 登记一条数量校验记录（迁移步骤内调用，结果汇总进 MigrationResult） */
  addCount(check: CountCheck): void;
  /** 登记一条内容校验记录（迁移步骤内调用，结果汇总进 MigrationResult） */
  addContent(check: ContentCheck): void;
}

/** 单次迁移 */
export interface Migration {
  /** 迁移后的数据版本号（升序） */
  version: number;
  name: string;
  up(ctx: MigrationContext): Promise<void>;
}

export interface MigrationResult {
  from: number;
  to: number;
  ok: boolean;
  message: string;
  /** 数量校验汇总（迁移执行过时存在） */
  counts?: CountCheck[];
  /** 内容校验汇总（迁移执行过时存在） */
  contents?: ContentCheck[];
  /** 是否已执行迁移前备份 */
  backedUp?: boolean;
  /** 是否已完成全部迁移（数据版本已写入最新） */
  done?: boolean;
}
