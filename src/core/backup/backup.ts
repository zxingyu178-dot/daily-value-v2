/**
 * Daily Value v2 - 完整备份核心（2.14.0）
 *
 * 备份定位：用户业务数据的安全拷贝（可带走、可恢复）。
 * - 正式格式：DailyValueBackupV1（JSON UTF-8，无 ZIP 压缩）
 * - schemaVersion 独立于 appVersion：未来版本升级仍可读取 V1（migrateBackupIfNeeded 钩子）
 * - 绝不含 meta / 运行时状态（migration version、fresh-install 标记、$$presetDeleted 等由当前 App 自己管理）
 * - 壁纸第一版只备份设置（blur/overlay/是否有图），不备份图片本体（体积评估见交付说明）
 * - 错误信息分级：格式错误 / 版本不支持 / JSON 损坏 / 数据校验失败 → 页面映射为友好文案
 */
import type { Bill, Category, RecurringRule, Settings } from '@/core/models/types';

/** 备份文件格式标识 */
export const BACKUP_FORMAT = 'daily-value-backup';
/** 当前备份 Schema 版本（与 appVersion 独立） */
export const BACKUP_SCHEMA_VERSION = 1;

/** 备份包含的壁纸设置（第一版不含图片本体） */
export interface BackupWallpaperMeta {
  /** 是否应用了壁纸（有图片） */
  hasImage: boolean;
  blur: number;
  overlay: number;
}

/** 备份数据载荷（仅用户业务数据 + 用户设置） */
export interface BackupData {
  bills: Bill[];
  categories: Category[];
  recurringRules: RecurringRule[];
  /** 用户设置白名单字段（不含 lastSeenReleaseNotesVersion 等运行时状态） */
  settings: Record<string, unknown>;
  wallpaper?: BackupWallpaperMeta;
}

/** 正式备份结构（DailyValueBackupV1） */
export interface DailyValueBackup {
  format: typeof BACKUP_FORMAT;
  schemaVersion: typeof BACKUP_SCHEMA_VERSION;
  appVersion: string;
  /** ISO 时间戳 */
  exportedAt: string;
  data: BackupData;
}

/** 备份校验错误类型（页面映射为友好文案，绝不把 JSON.parse 原文给用户） */
export type BackupErrorKind =
  | 'bad-json'
  | 'format-missing'
  | 'format-wrong'
  | 'schema-missing'
  | 'schema-unsupported'
  | 'data-invalid';

export type BackupValidation =
  | { ok: true; backup: DailyValueBackup }
  | { ok: false; error: BackupErrorKind };

export type RestoreResult =
  | { ok: true }
  | { ok: false; error: BackupErrorKind };

/**
 * 校验备份内容（纯函数，可在任何环境运行）。
 * - JSON 解析交给调用方（FileReader/原生桥已保证字符串），本函数只负责结构校验。
 */
export function validateBackup(raw: unknown): BackupValidation {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ok: false, error: 'data-invalid' };
  const b = raw as Record<string, unknown>;

  if (typeof b.format !== 'string' || b.format === '') return { ok: false, error: 'format-missing' };
  if (b.format !== BACKUP_FORMAT) return { ok: false, error: 'format-wrong' };

  if (typeof b.schemaVersion !== 'number') return { ok: false, error: 'schema-missing' };
  if (b.schemaVersion > BACKUP_SCHEMA_VERSION) return { ok: false, error: 'schema-unsupported' };
  if (b.schemaVersion < 1) return { ok: false, error: 'schema-unsupported' };

  const data = b.data;
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return { ok: false, error: 'data-invalid' };
  const d = data as Record<string, unknown>;
  for (const key of ['bills', 'categories', 'recurringRules', 'settings']) {
    if (key !== 'settings' && !Array.isArray(d[key])) return { ok: false, error: 'data-invalid' };
  }
  if (typeof d.settings !== 'object' || d.settings === null || Array.isArray(d.settings)) {
    return { ok: false, error: 'data-invalid' };
  }

  return { ok: true, backup: b as unknown as DailyValueBackup };
}

/**
 * 备份 Schema 迁移钩子（V1 当前是首版）。
 * 未来新增 Schema 时在此追加 V2→V1 的降级/升级映射，保证老文件仍可读取。
 * 当前直接返回原对象（V1 无迁移）。
 */
export function migrateBackupIfNeeded(backup: DailyValueBackup): DailyValueBackup {
  return backup;
}

/* ------------------------------------------------------------------ *
 * 用户设置白名单（导出/恢复共用）
 * ------------------------------------------------------------------ */

/** 需要随备份带走的用户设置键（业务偏好；排除 lastSeenReleaseNotesVersion 等运行时状态） */
const USER_SETTING_KEYS: Array<keyof Settings> = [
  'currency',
  'theme',
  'themeColor',
  'themeStyle',
  'customThemeColor',
  'themeGlass',
  'sort',
  'statisticsModules',
  'autoBillEnabled',
  'autoBillAllowedApps',
  'autoBillEnabledSources', // 2.17.1：新来源设置（来源 id 数组）正式进入备份/恢复体系
];

/**
 * 从完整 Settings 中取出备份用的用户设置白名单（不含 wallpapear 图片本体，
 * 图片单独以 BackupWallpaperMeta 描述）。
 */
export function pickBackupSettings(s: Settings | undefined): Record<string, unknown> {
  if (!s) return {};
  const out: Record<string, unknown> = {};
  for (const k of USER_SETTING_KEYS) {
    const v = (s as unknown as Record<string, unknown>)[k];
    if (v !== undefined) out[k as string] = v;
  }
  return out;
}

/** 提取壁纸设置元数据（不含图片数据本体） */
export function pickBackupWallpaper(s: Settings | undefined): BackupWallpaperMeta | undefined {
  if (!s?.wallpaper) return undefined;
  return {
    hasImage: Boolean(s.wallpaper.image),
    blur: s.wallpaper.blur ?? 0,
    overlay: s.wallpaper.overlay ?? 0,
  };
}

/**
 * 把备份的 settings 白名单合并回当前 Settings 行（幂等，可安全叠加）。
 * 只覆盖白名单键；运行时状态（lastSeenReleaseNotesVersion 等）保持当前值。
 * wallpaper 参数由调用方单独处理（当前版本只恢复 blur/overlay，图片本体不恢复）。
 *
 * 2.17.1（BACKUP-AUTOBILL-03）：旧备份兼容。备份中只有旧字段 autoBillAllowedApps、
 * 而没有新字段 autoBillEnabledSources 时，必须把当前设备残留的 autoBillEnabledSources
 * 一同清除（delete），使恢复后来源解析正确回落到旧字段迁移——否则当前设备已有的新字段
 * 会被「备份无此键 → 保留现值」逻辑残留下来，覆盖旧备份中的来源偏好。
 */
export function mergeBackupSettings(current: Settings, backupSettings: Record<string, unknown>): Settings {
  const next: Settings = { ...current };
  for (const k of USER_SETTING_KEYS) {
    const v = backupSettings[k as string];
    if (v !== undefined) (next as unknown as Record<string, unknown>)[k as string] = v;
  }
  // BACKUP-AUTOBILL-03：旧备份只有 autoBillAllowedApps 时，清除新字段使其回落旧逻辑。
  const hasLegacy = backupSettings['autoBillAllowedApps'] !== undefined;
  const hasNew = backupSettings['autoBillEnabledSources'] !== undefined;
  if (hasLegacy && !hasNew) {
    delete (next as unknown as Record<string, unknown>)['autoBillEnabledSources'];
  }
  return next;
}

/** 恢复失败/文件错误 → 用户友好文案（绝不暴露 JSON.parse/DOMException/transaction 等内部细节） */
export function backupErrorMessage(kind: BackupErrorKind): string {
  switch (kind) {
    case 'bad-json':
    case 'format-missing':
    case 'format-wrong':
    case 'data-invalid':
      return '无法读取这个备份文件';
    case 'schema-missing':
    case 'schema-unsupported':
      return '该备份版本暂不支持';
    default:
      return '无法读取这个备份文件';
  }
}

/** 生成建议备份文件名：DailyValue_yyyy-MM-dd_HHmm.dvbackup */
export function defaultBackupFileName(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const y = now.getFullYear();
  const m = pad(now.getMonth() + 1);
  const d = pad(now.getDate());
  const hh = pad(now.getHours());
  const mm = pad(now.getMinutes());
  return `DailyValue_${y}-${m}-${d}_${hh}${mm}.dvbackup`;
}

/** 生成建议 CSV 文件名：DailyValue_Bills_yyyy-MM-dd_HHmm.csv */
export function defaultCsvFileName(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const y = now.getFullYear();
  const m = pad(now.getMonth() + 1);
  const d = pad(now.getDate());
  const hh = pad(now.getHours());
  const mm = pad(now.getMinutes());
  return `DailyValue_Bills_${y}-${m}-${d}_${hh}${mm}.csv`;
}