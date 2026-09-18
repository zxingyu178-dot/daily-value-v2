/**
 * Daily Value v2 - 正式 Release Notes（2.12.0）
 *
 * - 只写用户能理解的变化（不出现 KeepAlive / Teleport / 生命周期等开发术语）。
 * - 从正式加入本模块的版本开始记录，不补写历史小版本。
 * - 版本号与 package.json / build.gradle 保持同步（交付时一致性核对项之一）。
 *
 * 全新安装 / 升级安装判定（复用迁移系统，不另造框架）：
 * - 迁移管理器在「全新安装 → 初始化数据版本」时写入 meta[freshInstallRegistered]。
 * - 升级安装（dataVersion 已存在）不写该标记。
 * - 有该标记 = 全新安装 → 不自动弹；无该标记 = 升级安装 → 未读过当前版本则弹一次。
 */
import { openDatabase } from '@/core/db/database';
import { META_FRESH_INSTALL_KEY } from '@/core/migration/manager';
import { useSettingsStore } from '@/core/store/settings';

export interface ReleaseNoteEntry {
  version: string;
  title: string;
  items: string[];
}

export const RELEASE_NOTES: ReleaseNoteEntry[] = [
  {
    version: '2.20.0',
    title: '本次更新',
    // 2.20.0：日价成为真正的产品特色 + 图表响应式修复（P0）
    items: [
      '新增日价详情：查看每件物品「每天值多少钱」、从购买那天一路下降的日价曲线，以及已经跨过的里程碑节点',
      '统计图表修复：在不同屏幕宽度下图表都能撑满卡片，日期不再挤成一团',
      '点击日价物品进入详情，「编辑」移到了详情页右上角',
    ],
  },
  {
    version: '2.19.0',
    title: '本次更新',
    // 2.19.0：Bill Explorer + Year Review（用户可感知的主版本）
    items: [
      '新增历史账单搜索：可按商户、备注、分类或金额快速找回过去的每一笔',
      '新增年度总览：全年支出趋势、分类去向与消费足迹，可从统计一路钻取到具体账单',
      '统计页新增「月度 / 年度」切换，默认仍是月度',
    ],
  },
  {
    version: '2.18.0',
    title: '本次更新',
    // 2.18.0：Widget V2 正式视觉版本（用户可感知）；不涉及 AutoBill 新功能
    items: [
      '全新设计桌面小组件，支持主题同步与更清晰的月度收支展示',
      '桌面小组件可跟随深色/浅色主题与主题色变化',
      '金额显示更清晰：千位分隔、更长金额自动浓缩',
    ],
  },
  {
    version: '2.17.2',
    title: '本次更新',
    // 2.17.2：AutoBill 可靠性收口；微信真机样本仍未验收，不写「新增微信支持」
    items: ['优化自动记账的开关同步、重复识别与隐私保护'],
  },
  {
    version: '2.17.1',
    title: '本次更新',
    // 2.17.1 仅收口 AutoBill 开关/来源/备份可靠性；微信真机样本仍未验收，不写「新增微信支持」
    items: ['优化自动记账开关、来源设置与数据备份的可靠性'],
  },
  {
    version: '2.17.0',
    title: '本次更新',
    // 2.17.0 微信真机样本尚未在交付环境完成验收，按 §27 不写「新增微信支付识别支持」
    items: ['优化自动记账来源管理与账单同步体验'],
  },
  {
    version: '2.16.7',
    title: '本次更新',
    items: ['优化自动记账设置体验，并提升部分手机通知使用权入口的兼容性'],
  },
  {
    version: '2.16.6',
    title: '本次更新',
    items: [
      '自动记账更稳：修改账单后仍记为「来自通知」，系统返回不会再乱跳',
      '修复部分手机通知使用权限入口打不开的问题',
      '优化支付通知识别：积分、红包等营销提醒不再被误认成商户',
    ],
  },
  {
    version: '2.16.5',
    title: '本次更新',
    items: [
      '修复系统返回手势：在自动记账的设置与核对页切换后，按返回键会先回到前一个页面，不再乱跳',
      '优化通知使用权入口：点一下打开系统「通知使用权」页面',
    ],
  },
  {
    version: '2.16.4',
    title: '本次更新',
    items: [
      '自动记账页面结构更稳定：设置与账单核对在同一个页面内切换，返回路径不再混乱',
      '自动记账设置卡片可直接点开，通知使用权整行可点，一键进入系统授权',
      '系统授权返回后状态自动刷新，无需重新进入页面',
      '待确认 / 已确认 / 已忽略 列表显示数量，一眼看清有多少待核对',
    ],
  },
  {
    version: '2.16.3',
    title: '本次更新',
    items: [
      '优化自动记账入口：设置入口改为整块卡片，点击更顺畅，返回不再乱跳',
      '修复自动记账等子页面误触发主页左右滑动的问题',
      '自动记账支持查看已确认与已忽略的记录',
    ],
  },
  {
    version: '2.16.2',
    title: '本次更新',
    items: [
      '优化自动记账实时同步，支付通知识别后可更及时显示待确认账单',
      '修复自动记账页面来回切换后返回路径异常的问题',
    ],
  },
  {
    version: '2.16.1',
    title: '本次更新',
    items: [
      '自动记账正式化第一步：支付宝支付通知将生成「待确认账单」，你确认后记入账本',
      '同一笔支付的重复通知自动合并，不会重复记账',
    ],
  },
  {
    version: '2.15.1',
    title: '本次更新',
    items: [
      '完善自动记账基础能力，可授权 Daily Value 读取支付相关通知',
    ],
  },
  {
    version: '2.15.0',
    title: '本次更新',
    items: [
      '自动记账新功能上线：支付通知先生成「待确认账单」，你确认后才记入账本，绝不自动乱记',
      '记账首页可看到待确认账单数量，随时进入核对；自动读取支付通知将在后续版本接入',
    ],
  },
  {
    version: '2.14.0',
    title: '本次更新',
    items: [
      '新增完整数据备份与恢复功能，换设备或长期使用更加安心',
      '支持导出账单 CSV，可用于表格查看和进一步整理',
    ],
  },
  {
    version: '2.13.2',
    title: '本次更新',
    items: [
      '优化统计模块管理，至少保留一个常用统计模块',
      '完善自定义主题颜色编辑与预览体验',
    ],
  },
  {
    version: '2.13.1',
    title: '本次更新',
    items: [
      '完善主题效果，记账与日价主卡片现在会完整跟随主题颜色与界面风格',
    ],
  },
  {
    version: '2.13.0',
    title: '本次更新',
    items: [
      '新增多种界面风格与自定义主题颜色，可自由搭配属于你的每日价值',
      '优化统计图表交互，查看数据后更容易关闭详情提示',
    ],
  },
  {
    version: '2.12.0',
    title: '本次更新',
    items: [
      '统计页全新「我的统计模块」，以大幅图表呈现每月数据',
      '新增每日花费趋势：清晰看到本月每天花了多少',
      '新增收入 / 支出对比：每天的收入与支出并列展示',
      '新增分类支出排行：哪个分类花钱最多一眼可见',
      '新增累计消费趋势：感受本月花钱的速度',
      '原「我的统计卡片」升级为大图模块，可通过「＋ 添加」灵活开启或关闭',
    ],
  },
  {
    version: '2.11.0',
    title: '本次更新',
    items: [
      '统计页新增可选数据卡片，可按需要添加日均支出、较上月变化、最高消费日等信息',
    ],
  },
  {
    version: '2.10.10',
    title: '本次更新',
    items: [
      '优化「＋」添加按钮：切到哪个页面就对应哪个页面的添加功能，切换后立即可用',
      '修复切换记账与日价页面后，添加按钮偶尔需要点两次才生效的问题',
    ],
  },
  {
    version: '2.10.9',
    title: '本次更新',
    items: [
      '修复深色玻璃模式下弹窗背景过于透明的问题',
      '统一所有弹窗的深色玻璃效果：删除确认、周期记账、日期时间与分类选择等',
      '弹窗内容更清晰，背景内容不再干扰阅读',
    ],
  },
  {
    version: '2.10.8',
    title: '本次更新',
    items: [
      '新增账单长按删除：轻点编辑、长按删除',
      '日价项目支持长按删除或移出日价',
      '修复记账与日价新增界面串用问题',
      '新增版本更新日志：升级后自动展示一次，设置中可随时查看',
    ],
  },
];

/** 当前 App 版本（与版本文件同步；交付一致性核对项） */
export const CURRENT_VERSION = '2.20.0';

/** 最新一条 Release Notes（自动弹窗使用） */
export const LATEST_RELEASE_NOTES: ReleaseNoteEntry | undefined = RELEASE_NOTES[0];

/** 按版本取 Release Notes */
export function releaseNoteForVersion(version: string): ReleaseNoteEntry | undefined {
  return RELEASE_NOTES.find((r) => r.version === version);
}

export interface ReleaseNotesCheckInput {
  /** 当前版本 */
  currentVersion: string;
  /** settings.lastSeenReleaseNotesVersion */
  lastSeenVersion: string | undefined;
  /** 是否已完成过首次启动（Fresh Install 未完成时不自动弹） */
  firstLaunchDone: boolean;
}

/**
 * 自动展示判定（纯函数）：
 * 只有「升级安装」且「该版本笔记未被看过」才显示；全新安装不弹。
 */
export function shouldAutoShowReleaseNotes(input: ReleaseNotesCheckInput): boolean {
  if (!input.firstLaunchDone) return false; // 全新安装：不弹更新日志
  if (!releaseNoteForVersion(input.currentVersion)) return false; // 当前版本无笔记
  return input.lastSeenVersion !== input.currentVersion;
}

/**
 * 启动完成后调用（幂等、失败静默）：判定是否需要自动展示。
 * 全新安装（迁移系统写过的 freshInstallRegistered 标记）→ 不自动弹；
 * 升级安装且未读过当前版本 → 返回 true（由 App 层挂载 ReleaseNotesDialog）。
 * 注意：本函数不写 lastSeenReleaseNotesVersion —— 只有用户点击「知道了」/主动关闭才写。
 */
export async function maybeAutoShowReleaseNotes(): Promise<boolean> {
  try {
    if (await isFreshInstall()) return false;
    const settings = useSettingsStore();
    await settings.load(true);
    return shouldAutoShowReleaseNotes({
      currentVersion: CURRENT_VERSION,
      lastSeenVersion: settings.settings?.lastSeenReleaseNotesVersion,
      firstLaunchDone: true,
    });
  } catch {
    // 更新日志加载失败不能阻塞进入首页
    return false;
  }
}

/** 全新安装判定：迁移管理器初始化数据版本时写入 meta 标记；升级安装没有该标记 */
async function isFreshInstall(): Promise<boolean> {
  try {
    const db = await openDatabase();
    return Boolean(await db.get('meta', META_FRESH_INSTALL_KEY));
  } catch {
    // 读失败按升级语义处理（至多多显示一次，不阻塞启动）
    return false;
  }
}

/** 用户点击「知道了」/主动关闭自动弹窗后，记录已读版本（同版本不再自动出现） */
export async function markReleaseNotesSeen(): Promise<void> {
  try {
    const settings = useSettingsStore();
    await settings.update({ lastSeenReleaseNotesVersion: CURRENT_VERSION });
  } catch {
    // 静默失败：不影响主流程
  }
}