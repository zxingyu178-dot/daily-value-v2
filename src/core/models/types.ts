/**
 * Daily Value v2 - 核心数据模型
 * 设计基线（v2.1 规范 docs/DATA_MODEL_V2.md）：
 * - Bill 是唯一核心消费数据，所有消费（手动/周期/导入）最终进入 Bill
 * - DailyValue 是 Bill 的扩展对象（enabled/mode/startDate），不单独维护第二套数据
 * - 日价为动态计算模型：currentDailyValue = amount / elapsedDays(startDate, 今天)，
 *   不持久化固定摊销天数（与 v1 实际逻辑一致，每天随已使用天数自动重算）
 * - ledgerImpact 明确账单的账务作用域：normal 进入账单/统计；daily-value-only
 *   仅在日价模块展示，不进入账单时间线/月度支出/统计，避免污染用户原有现金流
 * - 所有模块从 Bill 派生
 */

/** 记账类型 */
export type BillType = 'expense' | 'income';

/** 币种符号（显示用；金额一律以 CNY 存储） */
export type Currency = '¥' | '$' | '€' | '£' | '₩' | '฿' | '₹' | '₽' | 'NT$' | 'HK$';

/** 账单账务作用域（决定是否进入账单/统计） */
export type LedgerImpact = 'normal' | 'daily-value-only';

/**
 * 日价模式（v2.1 规范 DailyValue.mode）。
 * 'elapsed'：按购买日起至今已使用天数动态摊销（v1 实际口径）。
 */
export type DailyValueMode = 'elapsed';

/**
 * 日价扩展对象（Bill 的嵌套属性，非独立数据实体）。
 * 日价 = amount / elapsedDays（动态计算，见 src/core/models/daily-value.ts）。
 * 注意：不持久化 durationDays/elapsedDays 等固定摊销参数，天数随时间动态变化。
 */
export interface DailyValue {
  /** 是否参与日价计算 */
  enabled: boolean;
  /** 日价模式（默认 'elapsed'，当前仅此一种） */
  mode?: DailyValueMode;
  /** 日价起算日期 yyyy-MM-dd（本地业务日期；迁移自 v1 purchaseDate） */
  startDate: string;
}

/**
 * 账单（唯一核心消费数据）。
 * 金额单位：CNY（人民币元），显示时按 Settings.currency 换算。
 */
export interface Bill {
  /** 唯一 id */
  id: string;
  /** 类型：支出 / 收入 */
  type: BillType;
  /** 金额（CNY） */
  amount: number;
  /** 分类 id（关联 Category） */
  categoryId: string;
  /** 分类快照 emoji（冗余，避免联表） */
  categoryEmoji: string;
  /** 分类快照名称（冗余，避免联表） */
  categoryName: string;
  /**
   * 用户可见名称（Phase 3 前置修正：DailyValue 名称语义预留）。
   * 日价物品迁移时用本字段保存物品名称（如"MacBook"），categoryName 只保存真实分类名，
   * 不再长期借用 categoryName 存物品名。普通账单可省略（展示用 categoryName）。
   * 旧数据（Phase 2 已迁移、categoryName 曾存物品名）向前兼容：读取时用 title ?? categoryName。
   */
  title?: string;
  /** 备注 */
  note: string;
  /** 业务日期 yyyy-MM-dd（本地时区） */
  date: string;
  /** 时间戳（ms） */
  timestamp: number;
  /** 来源：手动 / 周期 / 导入 / 通知（自动记账确认生成） */
  source: 'manual' | 'recurring' | 'import' | 'notification';
  /** 来源周期规则 id（source === 'recurring' 时） */
  recurringRuleId?: string;

  /**
   * 账务作用域（Phase 2 新增）：
   * - 'normal'：普通账单，进入账单时间线/月度支出/统计
   * - 'daily-value-only'：仅日价物品（v1 独立日价记录迁移而来），只在日价模块展示，
   *   不进入账单/统计，不改变用户原有现金流
   */
  ledgerImpact: LedgerImpact;

  /* ---- v1 兼容字段（迁移保留，UI 暂不展示） ---- */
  /** v1 转账方向兼容：'out' 转出 / 'in' 转入（仅迁移数据保留，UI 不展示） */
  transferDirection?: 'out' | 'in';

  /* ---- 日价扩展对象（v2.1 规范） ---- */
  /** 日价扩展；未启用日价的普通账单为 undefined */
  dailyValue?: DailyValue;
}

/** 分类 */
export interface Category {
  id: string;
  name: string;
  emoji: string;
  /** 是否系统内置（内置不可删除） */
  builtin: boolean;
  sort: number;
  /**
   * 图标类型（2.9.5 分类图标系统新增，向后兼容）：
   * - 'builtin'：内置图标库（iconValue 存 BUILTIN_ICONS 的 id）
   * - 'emoji'：自定义 emoji（旧数据/手输 emoji）
   * 未设置时按纯 emoji 渲染；emoji 字段始终同步保留，保证既有渲染路径（cat.emoji）不变。
   */
  iconType?: 'emoji' | 'builtin';
  /** 图标值：builtin 时为内置图标 id；emoji 时为 emoji 字符 */
  iconValue?: string;
}

/** 周期记账规则（生成 Bill 的来源，不属于迁移数据） */
export type RecurringFrequency = 'daily' | 'weekly' | 'monthly' | 'yearly';

export interface RecurringRule {
  id: string;
  enabled: boolean;
  type: BillType;
  amount: number;
  categoryId: string;
  categoryEmoji: string;
  categoryName: string;
  note: string;
  frequency: RecurringFrequency;
  /** 间隔（频率单位，默认 1） */
  interval: number;
  /**
   * 周期内触发的日/星期：
   * - monthly：当月第几天（1-31，超出目标月天数自动落到当天最后一天）
   * - weekly：星期（JS getDay() 语义，0=周日 ~ 6=周六）
   * - yearly：当月第几天（配合 month；1-31，超出目标月天数自动落到当天最后一天）
   * - daily：无意义（忽略）
   */
  day: number;
  /** yearly 时使用的月份（1-12）；缺省用 startDate 的月份 */
  month?: number;
  /** 开始日期 yyyy-MM-dd（首个 occurrence 锚点） */
  startDate: string;
  /** 每次 occurrence 的时间 HH:mm（本地时间） */
  time: string;
  /**
   * 计划生效边界（ms，本地时间戳）。新建规则为空（允许按 startDate 正常历史 catch-up）；
   * 用户**编辑**已有规则（改 time/星期/每月日/frequency/startDate 等）时置为 Date.now()。
   * 生成时只把发生在「该边界之后」的时间点作为新 occurrence 补生成，
   * 边界之前一律不再回填，保证「编辑只影响未来」；历史已生成 Bill 永不修改/删除。
   * 注意：不直接复用 updatedAt（generator 推进游标也会更新 updatedAt），因此用独立字段。
   */
  scheduleEffectiveAt?: number;
  /** 最后生成日期 yyyy-MM-dd（辅助避免重复生成的游标） */
  lastGeneratedDate?: string;
  /** 下一次 occurrence 日期 yyyy-MM-dd（生成后更新；展示用） */
  nextOccurrence?: string;
  createdAt: number;
  /** 最近更新时间（ms） */
  updatedAt?: number;
}

/**
 * 正式壁纸配置（Phase 6 v2 Cropper 新壁纸系统）。
 * 与主题分离独立持久化，保存的是最终构图图片 + 视觉参数。不迁移 v1 壁纸，不进入 Bill 数据。
 *
 * 「应用」时保存的已是最终构图图片（按设备屏幕比例输出、最长边约 2560、JPEG）。
 * 运行时不再重新解释「原图该移动多少/缩放多少」，因此正式字段收敛为 image/blur/overlay。
 *
 * 旧字段 fit/positionX/positionY/scale 逐步废弃：
 * 新链路写入时不再包含；读取旧数据时仍兼容（appStore 读取时给旧字段默认值）。
 */
export interface WallpaperConfig {
  /** 图片资源（最终构图 DataURL 或 URL）；未设置则无壁纸（使用主题纯色背景） */
  image?: string;
  /** 模糊强度 0-20（px） */
  blur: number;
  /** 明暗遮罩不透明度 0-1（保证文字与卡片可读） */
  overlay: number;
  // ---- 以下为旧字段，逐步废弃（新增写不理会，读取旧数据时兼容） ----
  /** 【废弃】基础缩放：cover 覆盖 / contain 完整 / center 居中 */
  fit?: 'cover' | 'contain' | 'center';
  /** 【废弃】水平位置百分比 0-100 */
  positionX?: number;
  /** 【废弃】垂直位置百分比 0-100 */
  positionY?: number;
  /** 【废弃】缩放倍率 0.5-3 */
  scale?: number;
}

/**
 * 我的统计模块 id（2.12.0 Statistics Dashboard）。
 * 第一版固定 4 个大图模块；显示顺序固定按 STATISTICS_MODULES 目录顺序，不支持拖拽排序。
 */
export type StatisticsModuleId =
  | 'daily-expense-trend'
  | 'income-expense-compare'
  | 'category-ranking'
  | 'cumulative-expense';

/** 应用设置（不属于迁移数据） */
export interface Settings {
  /** 显示币种（存储仍为 CNY） */
  currency: Currency;
  /** 主题：auto 跟随系统 / 固定明暗 */
  theme: 'auto' | 'light' | 'dark';
  /** 主题颜色（Phase 6 Theme；2.13.0 起支持 'custom' 自定义主色） */
  themeColor: import('@/theme/tokens').ThemeColorId;
  /** 界面风格（Theme V2，2.13.0）：classic/soft/minimal/glass；缺省 = classic（旧用户升级不改变视觉） */
  themeStyle?: import('@/theme/tokens').ThemeStyleId;
  /** 自定义主题主色（themeColor === 'custom' 时有效，合法格式 #RRGGBB） */
  customThemeColor?: string;
  /** 玻璃强调色（2.10.4 Visual Polish，独立于 theme/themeColor；缺省 = off 完全现状）。
      2.13.0 起迁移到 ThemeStyle + 主题颜色，本字段仅兼容保留，新设置 UI 不再提供。 */
  themeGlass?: import('@/theme/tokens').GlassStyleId;
  /** 默认排序 */
  sort: string;
  /** 壁纸配置（Phase 6 Wallpaper；未启用为 undefined） */
  wallpaper?: WallpaperConfig;
  /** 已看过的最近一次版本更新日志版本（2.10.8 Release Notes；undefined = 从未看过） */
  lastSeenReleaseNotesVersion?: string;
  /** 我的统计模块（2.12.0；缺省 = 全部开启，可在管理 Sheet 关闭） */
  statisticsModules?: StatisticsModuleId[];

  /* ---- 自动记账（2.15.0 Gate A；缺省关闭，用户显式开启） ---- */
  /** 自动记账总开关（通知监听 + 待确认审批流）。false/缺省 = 完全关闭。 */
  autoBillEnabled?: boolean;
  /** 参与识别的应用白名单（缺省 = 支付宝 + 微信支付）；可在自动记账设置页调整。 */
  autoBillAllowedApps?: string[];
}

/* ---- 自动记账候选（2.15.0 Gate A；2.16.1 Gate C 扩展 confidence/source） ---- */

/** 自动记账候选状态 */
export type AutoBillCandidateStatus = 'WAIT_CONFIRM' | 'CONFIRMED' | 'IGNORED';

/** 解析来源枚举（路由到对应 Parser；用枚举而非 if 支付宝/if 微信） */
export type AutoBillSource = 'alipay' | 'wechat' | 'bank';

/** 解析可信度 */
export type AutoBillConfidence = 'HIGH' | 'MEDIUM' | 'LOW';

/**
 * 待确认账单候选：支付通知 → 解析 → 落库为候选，用户确认后才生成正式 Bill。
 * 禁止收到通知直接写正式账单。
 */
export interface AutoBillCandidate {
  id: string;
  /** 来源应用（如「支付宝」/「微信支付」） */
  sourceApp: string;
  /** 2.16.1：解析来源枚举（registry 路由用；缺省由 sourceApp 推断） */
  source?: AutoBillSource;
  /** 原始通知文本 */
  rawText: string;
  /** 商户/收款方名称（解析结果；无法解析时为来源应用名） */
  merchant: string;
  /** 金额（CNY，纯数字） */
  amount: number;
  /** 支出 / 收入 */
  type: BillType;
  /** 推荐分类 id（解析/未来规则推荐；确认时使用，可修改） */
  suggestCategoryId?: string;
  /** 2.16.1：解析可信度（HIGH/MEDIUM/LOW；未解析为 undefined） */
  confidence?: AutoBillConfidence;
  /** 交易发生时间（ms；缺省 = 通知到达时间） */
  transactionTime: number;
  /** 状态 */
  status: AutoBillCandidateStatus;
  /** 2.16.6：确认后生成的正式 Bill id（已确认列表将来可点击直达账单） */
  confirmedBillId?: string;
  /** 去重指纹（sourceApp+amount+merchant+时间窗口+rawText） */
  notificationHash: string;
  /** 创建时间（ms） */
  createdAt: number;
}
