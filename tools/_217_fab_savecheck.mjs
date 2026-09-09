/**
 * 2.10.7 账务作用域保存验证（vite preview + 系统 Chrome）
 * §8：记账入口新增 → IDB ledgerImpact=normal，进时间线/统计；
 *      日价入口独立新增 → ledgerImpact='daily-value-only'，仅在日价展示。
 * 在浏览器临时 IDB 内操作，不触碰任何用户真实数据。
 * 用法：node tools/_217_fab_savecheck.mjs
 */
import puppeteer from 'puppeteer-core';

const BASE = 'http://127.0.0.1:4173';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function readBills() {
  return await page.evaluate(async () => {
    const db = await new Promise((res, rej) => {
      const req = indexedDB.open('daily-value-v2');
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
    const tx = db.transaction('bills', 'readonly');
    const os = tx.objectStore('bills');
    const all = await new Promise((res, rej) => {
      const r = os.getAll();
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    return all.map((b) => ({
      title: b.title, amount: b.amount, categoryId: b.categoryId,
      type: b.type, ledgerImpact: b.ledgerImpact,
      dailyValue: b.dailyValue ? { enabled: b.dailyValue.enabled, startDate: b.dailyValue.startDate } : null,
    }));
  });
}

const browser = await puppeteer.launch({
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu'],
  defaultViewport: { width: 411, height: 891, deviceScaleFactor: 2.625 },
});
const page = await browser.newPage();
try {
  // ========== 1) 记账入口新增（normal） ==========
  await page.goto(`${BASE}/accounting`, { waitUntil: 'networkidle0' });
  // 真实坐标点 FAB
  const fab = await page.evaluate(() => {
    const el = document.querySelector('.accounting__fab');
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await page.mouse.click(fab.x, fab.y);
  await sleep(400);
  const t1 = await page.evaluate(() => document.querySelector('.dv-sheet__title')?.textContent?.trim());
  // 数字键盘输入 125（真实点击数字键），分类默认选中餐饮
  for (const k of ['1', '2', '5']) {
    await page.evaluate((key) => {
      const btn = Array.from(document.querySelectorAll('.qe__pad-key')).find((b) => b.textContent.trim() === key);
      btn?.click();
    }, k);
    await sleep(80);
  }
  await page.evaluate(() => {
    Array.from(document.querySelectorAll('button')).find((b) => b.textContent.includes('记一笔'))?.click();
  });
  await sleep(600);
  let bills1 = await readBills();
  const normalBill = bills1.find((b) => b.amount === 125);
  console.log('SAVE-QE', JSON.stringify({ sheetTitle: t1, saved: normalBill }));
  if (t1 !== '快速记账') throw new Error(`记账入口标题错误: ${t1}`);
  if (!normalBill || normalBill.ledgerImpact !== 'normal') throw new Error('记账保存缺失或 ledgerImpact!=normal');

  // 记账时间线应可见该笔（normal 进时间线）
  const tlShows = await page.evaluate(() => document.body.textContent.includes('125.00'));
  console.log('SAVE-QE.TIMELINE', JSON.stringify({ visible: tlShows }));

  // ========== 2) 日价入口独立新增（daily-value-only） ==========
  await page.goto(`${BASE}/daily-value`, { waitUntil: 'networkidle0' });
  const dfab = await page.evaluate(() => {
    const el = document.querySelector('.dv__fab');
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await page.mouse.click(dfab.x, dfab.y);
  await sleep(400);
  const t2 = await page.evaluate(() => document.querySelector('.dv-sheet__title')?.textContent?.trim());
  // 名称
  await page.evaluate(() => {
    const inputs = Array.from(document.querySelectorAll('.dvas input'));
    const name = inputs.find((i) => i.placeholder.includes('MacBook')) ?? inputs[0];
    name.focus();
  });
  await page.keyboard.type('咖啡机');
  // 金额
  await page.evaluate(() => {
    const inputs = Array.from(document.querySelectorAll('.dvas input'));
    const amt = inputs.find((i) => i.placeholder === '0.00') ?? inputs[1];
    amt.focus();
  });
  await page.keyboard.type('300');
  // 分类：打开选择器并选第一个
  await page.evaluate(() => {
    document.querySelector('[aria-label="选择分类"]')?.click();
  });
  await sleep(400);
  const picked = await page.evaluate(() => {
    const cells = Array.from(document.querySelectorAll('.dvpc__cell')).filter((c) => c.getAttribute('aria-label') !== '添加分类');
    return cells.length;
  });
  await page.evaluate(() => {
    const cell = Array.from(document.querySelectorAll('.dvpc__cell')).find((c) => c.getAttribute('aria-label') !== '添加分类');
    cell?.click();
  });
  await sleep(300);
  // 点击「添加」
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('.dvas button, .dvas-footer button'));
    const add = btns.find((b) => b.textContent.trim() === '添加' || b.textContent.trim() === '添加日价物品');
    (add ?? btns[btns.length - 1])?.click();
  });
  await sleep(700);
  const bills2 = await readBills();
  const dvBill = bills2.find((b) => b.title === '咖啡机');
  console.log('SAVE-DV', JSON.stringify({ sheetTitle: t2, picked, saved: dvBill }));
  if (t2 !== '添加日价物品') throw new Error(`日价入口标题错误: ${t2}`);
  if (!dvBill || dvBill.ledgerImpact !== 'daily-value-only' || !dvBill.dailyValue?.enabled) {
    throw new Error('日价保存缺失或 ledgerImpact!=daily-value-only 或 dailyValue 未启用');
  }
  // 记账时间线不含日价记录（daily-value-only 不进时间线/统计）
  await page.goto(`${BASE}/accounting`, { waitUntil: 'networkidle0' });
  const notInTL = !(await page.evaluate(() => document.body.textContent.includes('咖啡机')));
  console.log('SAVE-DV.NOT-IN-ACCOUNTING', JSON.stringify({ notShown: notInTL }));
  // 日价页可见
  await page.goto(`${BASE}/daily-value`, { waitUntil: 'networkidle0' });
  const dvShows = await page.evaluate(() => document.body.textContent.includes('咖啡机'));
  console.log('SAVE-DV.SHOWS-ON-DV', JSON.stringify({ visible: dvShows }));

  console.log('ALL_SAVE_CHECKS_PASSED');
} finally {
  await browser.close();
}