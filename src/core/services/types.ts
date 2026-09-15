/**
 * Daily Value v2 - 数据层接口（service 契约）
 *
 * 架构约束（rules/Trae_Development_Rules.md）：
 * - 页面禁止直接操作 localStorage / IndexedDB
 * - 必须通过 service/store 层访问数据
 * - 本文件定义所有数据访问接口；Phase 1「Core Layer」落地 IndexedDB 实现
 */
import type { Bill, Category, RecurringRule, Settings, AutoBillCandidate, AutoBillCandidateStatus } from '@/core/models/types';
import type { DailyValueBackup } from '@/core/backup/backup';

/** 底层存储抽象（键值） */
export interface IStorageService {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T): Promise<void>;
  remove(key: string): Promise<void>;
  clear(): Promise<void>;
}

/** 账单仓库（唯一核心消费数据） */
export interface IBillService {
  list(): Promise<Bill[]>;
  listByMonth(ym: string): Promise<Bill[]>;
  get(id: string): Promise<Bill | undefined>;
  /** 可传入确定性 id（周期记账幂等用）；缺省自动生成 */
  add(bill: Omit<Bill, 'id'> & { id?: string }): Promise<Bill>;
  update(id: string, patch: Partial<Bill>): Promise<void>;
  remove(id: string): Promise<void>;
}

/** 分类仓库 */
export interface ICategoryService {
  list(): Promise<Category[]>;
  get(id: string): Promise<Category | undefined>;
  add(category: Omit<Category, 'id'>): Promise<Category>;
  update(id: string, patch: Partial<Category>): Promise<void>;
  remove(id: string): Promise<void>;
}

/** 周期规则仓库（生成 Bill 的来源，v2.0 暂不开放业务，仅保留接口） */
export interface IRecurringRuleService {
  list(): Promise<RecurringRule[]>;
  get(id: string): Promise<RecurringRule | undefined>;
  add(rule: Omit<RecurringRule, 'id' | 'createdAt'>): Promise<RecurringRule>;
  update(id: string, patch: Partial<RecurringRule>): Promise<void>;
  remove(id: string): Promise<void>;
}

/** 设置仓库 */
export interface ISettingsService {
  get(): Promise<Settings>;
  update(patch: Partial<Settings>): Promise<Settings>;
}

/* ------------------------------------------------------------------ *
 * 备份/恢复（2.14.0）：用户业务数据的安全拷贝与整库替换
 * ------------------------------------------------------------------ */

/** 恢复前安全快照（内存/临时；供失败回滚） */
export interface BackupSnapshot {
  bills: Bill[];
  categories: Category[];
  recurringRules: RecurringRule[];
  /** 当前 settings 行 value（含 meta 混合字段，原样保留用于回滚） */
  settingsValue: Record<string, unknown> | undefined;
}

/**
 * 备份服务契约：
 * - exportData：收集全部业务数据 + 用户设置白名单（不含 meta/运行时状态/壁纸大图）
 * - createSnapshot：恢复前建立安全快照
 * - restoreFrom：校验 → 事务性整库替换 → 引用完整性修复；失败自动回滚到快照
 * - exportCsv：账单 CSV 文本（含 BOM）
 */
export interface IBackupService {
  exportData(appVersion: string, now?: Date): Promise<DailyValueBackup>;
  createSnapshot(): Promise<BackupSnapshot>;
  restoreFrom(raw: unknown): Promise<void>;
  exportCsv(): Promise<string>;
}

/* ------------------------------------------------------------------ *
 * 自动记账（2.15.0 Gate A）：通知 → 候选 → 用户确认 → Bill
 * ------------------------------------------------------------------ */

/** 传入系统的通知（模拟输入 / 原生通知桥统一入口） */
export interface IncomingNotification {
  /** 来源应用（如「支付宝」「微信支付」） */
  sourceApp: string;
  /** 原始通知文本 */
  rawText: string;
  /** 通知到达时间（ms） */
  postedAt: number;
  /** 2.16.1/2.16.2 Gate C：SyncService 解析结果注入（完整传递，避免二次猜测） */
  parsed?: {
    source?: import('@/core/models/types').AutoBillSource;
    confidence?: import('@/core/models/types').AutoBillConfidence;
    suggestCategoryId?: string;
    /** 显式指定支出/收入（绕过启发式方向判断） */
    type?: import('@/core/models/types').BillType;
    /** 2.16.2：解析得到的正式金额（有则优先，不再对 rawText 重新猜） */
    amount?: number;
    /** 2.16.2：解析得到的正式商户（有则优先） */
    merchant?: string;
  };
}

/** 通知消费结果 */
export interface AutobillIngestResult {
  /** 是否本次新建了候选（false = 去重命中或无法解析） */
  created: boolean;
  /** 是否去重命中（同一笔支付重复推送） */
  duplicate: boolean;
  /** 命中/新建的候选 id */
  candidateId?: string;
}

/** 自动记账服务契约：候选生命周期 + 去重 + 确认生成正式 Bill */
export interface IAutoBillService {
  /** 消费一条支付通知：解析 → 去重 → 生成待确认候选（绝不直接写正式账单） */
  ingest(input: IncomingNotification): Promise<AutobillIngestResult>;
  /** 列出候选（缺省 = 待确认，按创建时间倒序） */
  listCandidates(status?: AutoBillCandidateStatus): Promise<AutoBillCandidate[]>;
  /** 待确认候选数量（首页入口/设置页/启动提醒使用） */
  countWaitConfirm(): Promise<number>;
  getCandidate(id: string): Promise<AutoBillCandidate | undefined>;
  /** 确认：生成正式 Bill（source=notification）并删除候选 */
  confirm(id: string): Promise<Bill>;
  /** 忽略：置为 IGNORED（保留记录供后续分析，不进入账本） */
  ignore(id: string): Promise<void>;
  /** 去重查询：指纹是否存在（防重复候选） */
  existsHash(hash: string): Promise<boolean>;
}

/** 统一服务入口：业务侧只依赖本接口获取各 service */
export interface IServiceRegistry {
  bills: IBillService;
  categories: ICategoryService;
  recurringRules: IRecurringRuleService;
  settings: ISettingsService;
  backup: IBackupService;
  autoBill: IAutoBillService;
}
