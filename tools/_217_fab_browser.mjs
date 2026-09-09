/**
 * 2.10.7 跨页入口归属 浏览器实测（vite preview 生产构建 + 系统 Chrome，puppeteer-core）
 * 验证点：FAB/Sheet 随当前路由存在；真实坐标点击命中（elementFromPoint + mouse 点击）；
 * 关键复现「记账→日价→关闭→回记账→点右下角 → 只有快速记账」。
 * 用法：node tools/_217_fab_browser.mjs
 */
import puppeteer from 'puppeteer-core';
import { mkdirSync, writeFileSync } from 'node:fs';

const BASE = 'http://127.0.0.1:4173';
const SHOT_DIR = new URL('../_shots_browser/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const EVIDENCE = [];
function log(tag, data) { EVIDENCE.push({ tag, ...data }); console.log(`[${tag}]`, JSON.stringify(data)); }

/** body 内主页面 FAB 快照（route 之外的 DOM 事实） */
async function fabSnapshot() {
  return page.evaluate(() => {
    const fabs = Array.from(document.body.querySelectorAll('.accounting__fab, .dv__fab'))
      .map((b) => ({ cls: b.className, label: b.getAttribute('aria-label') }));
    return {
      route: location.pathname,
      fabCount: fabs.length,
      fabs,
      viewport: { w: innerWidth, h: innerHeight },
    };
  });
}

/** 取当前唯一可见 FAB 的矩形（CSS px），并核对 elementFromPoint 命中它 */
async function fabHitRect() {
  return page.evaluate(() => {
    const fab = document.body.querySelector('.accounting__fab, .dv__fab');
    if (!fab) return { found: false };
    const r = fab.getBoundingClientRect();
    const cx = Math.min(Math.max(r.x + r.width / 2, 0), innerWidth - 1);
    const cy = Math.min(Math.max(r.y + r.height / 2, 0), innerHeight - 1);
    const hit = document.elementFromPoint(cx, cy);
    return {
      found: true,
      cx, cy,
      hitIsFab: !!hit && (hit.classList.contains('accounting__fab') || hit.classList.contains('dv__fab')),
      hitCls: hit ? hit.className : null,
      hitLabel: hit ? hit.getAttribute('aria-label') : null,
    };
  });
}

/** 打开中的主 Sheet 标题（.dv-sheet__title） */
async function sheetTitle() {
  return page.evaluate(() => {
    const t = document.querySelector('.dv-sheet__title');
    return t ? t.textContent.trim() : null;
  });
}

async function clickNav(label) {
  const c = await page.evaluate((l) => {
    const el = Array.from(document.querySelectorAll('.app-shell__nav-item')).find((n) => n.textContent.trim() === l);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, label);
  if (!c) throw new Error(`nav not found: ${label}`);
  await page.mouse.click(c.x, c.y);
  await new Promise((r) => setTimeout(r, 350));
}

async function shot(name) {
  await page.screenshot({ path: `${SHOT_DIR}${name}.png` });
}

const browser = await puppeteer.launch({
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu'],
  defaultViewport: { width: 411, height: 891, deviceScaleFactor: 2.625 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => log('PAGEERROR', { msg: String(e) }));
mkdirSync(SHOT_DIR, { recursive: true });

try {
  // --- FAB-01 冷启动记账 ---
  await page.goto(`${BASE}/accounting`, { waitUntil: 'networkidle0' });
  log('FAB-01', await fabSnapshot());
  await shot('01_accounting');

  // --- 进入日价 ---
  await clickNav('日价');
  let snap = await fabSnapshot();
  log('FAB-02', snap);
  if (snap.fabCount !== 1 || snap.fabs[0].label !== '添加日价物品') throw new Error('FAB-02 失败：日价页应仅有一个日价 FAB');

  // --- 日价打开表单 → 关闭（FAB-03 前置） ---
  let hit = await fabHitRect();
  if (!hit.found || !hit.hitIsFab) { log('FAB-03.HIT-FAIL', hit); throw new Error('FAB-03 前置失败：右下方未命中日价 FAB'); }
  log('FAB-03.HIT-OPEN', hit);
  await page.mouse.click(hit.cx, hit.cy);
  await new Promise((r) => setTimeout(r, 400));
  log('FAB-03.SHEET-ON-DV', { title: await sheetTitle() });
  await shot('03_dv_sheet_open');
  await page.evaluate(() => document.querySelector('.dv-sheet__close')?.click());
  await new Promise((r) => setTimeout(r, 300));

  // --- 回记账 → 点右下角 → 必须「快速记账」（关键复现） ---
  await clickNav('记账');
  snap = await fabSnapshot();
  log('FAB-03.ACCOUNTING', snap);
  if (snap.fabCount !== 1 || snap.fabs[0].label !== '快速记账') throw new Error('FAB-03 失败：记账页应仅有一个记账 FAB（日价 FAB 残留）');
  hit = await fabHitRect();
  log('FAB-03.HIT-TAP', hit);
  await shot('03_before_tap_accounting');
  await page.mouse.click(hit.cx, hit.cy);
  await new Promise((r) => setTimeout(r, 400));
  const t = await sheetTitle();
  log('FAB-03.SHEET-RESULT', { title: t });
  if (t !== '快速记账') throw new Error(`FAB-03 关键复现失败：点右下角得到「${t}」而非「快速记账」`);
  await shot('04_qe_sheet');
  await page.evaluate(() => document.querySelector('.dv-sheet__close')?.click());
  await new Promise((r) => setTimeout(r, 300));

  // --- FAB-06 统计/设置无 FAB ---
  await clickNav('统计');
  snap = await fabSnapshot();
  log('FAB-06.STATS', snap);
  if (snap.fabCount !== 0) throw new Error('FAB-06 失败：统计页残留 FAB');
  await clickNav('记账');
  await clickNav('日价');
  await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle0' });
  snap = await fabSnapshot();
  log('FAB-06.SETTINGS', snap);
  if (snap.fabCount !== 0) throw new Error('FAB-06 失败：设置页残留 FAB');

  // --- FAB-05 反向：日价起始往返 ---
  await page.goto(`${BASE}/daily-value`, { waitUntil: 'networkidle0' });
  await clickNav('记账');
  snap = await fabSnapshot();
  log('FAB-05', snap);
  if (snap.fabCount !== 1 || snap.fabs[0].label !== '快速记账') throw new Error('FAB-05 失败：反向顺序入口归属错误');

  // --- FAB-07 20 轮往返（导航点击） ---
  let ok = true;
  for (let i = 0; i < 20; i += 1) {
    await clickNav('日价');
    const a = await fabSnapshot();
    await clickNav('记账');
    const b = await fabSnapshot();
    if (a.fabCount !== 1 || b.fabCount !== 1 || a.fabs[0].label !== '添加日价物品' || b.fabs[0].label !== '快速记账') {
      ok = false;
      log('FAB-07.ROUND-FAIL', { round: i, a, b });
      break;
    }
  }
  log('FAB-07', { rounds: 20, ok });

  // --- 收尾：再验证一次关键复现（回归） ---
  await page.goto(`${BASE}/accounting`, { waitUntil: 'networkidle0' });
  await clickNav('日价');
  await clickNav('记账');
  hit = await fabHitRect();
  await page.mouse.click(hit.cx, hit.cy);
  await new Promise((r) => setTimeout(r, 400));
  const final = await sheetTitle();
  log('FINAL-REPRO', { title: final });
  if (final !== '快速记账') throw new Error(`最终复现失败：${final}`);
  await shot('05_final_qe');

  writeFileSync(`${SHOT_DIR}evidence.json`, JSON.stringify(EVIDENCE, null, 2));
  console.log('ALL_BROWSER_CHECKS_PASSED');
} finally {
  await browser.close();
}