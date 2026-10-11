/*
 * Day 24 · 截图动作：在页面上新建一个习惯 → 刷新 → 看它还在不在
 *
 * 用法: node cdp_click.js <端口> add-reload
 *
 * 这是「修复前 / 修复后」两张截图共用的**同一个动作** —— 图里长什么样，只取决于
 * 跑的是哪一版代码：
 *   · 修复前（写回库没接）：刷新之后它没了
 *   · 修复后（写回库接上）：刷新之后它还在
 * 所以两张图的地址栏可以完全一样（同一个 URL、同一个端口），只有页面内容不同 —— 前后对照才成立。
 *
 * 为什么不在这里顺手把新建的那条删掉：截图要拍到它，删了就没证据了。
 * 清理交给 cleanup.js（跑完图之后单独执行）。
 */
const { chromium } = require('playwright-core');

const PORT = process.argv[2] || '9333';
const ACTION = process.argv[3] || 'none';
const NAME = process.env.DAY24_NAME || 'Day24｜新建即入库';

const consoleMsgs = [];
const pageErrors = [];

(async () => {
  if (ACTION !== 'add-reload') {
    console.log('DAY24 只认 add-reload，收到的是: ' + ACTION);
    process.exit(0);
  }

  const browser = await chromium.connectOverCDP('http://127.0.0.1:' + PORT);
  const ctx = browser.contexts()[0];
  let page = ctx.pages().find((p) => { try { return p.url().includes('index.html'); } catch (e) { return false; } });
  if (!page) page = ctx.pages()[0];
  console.log('DAY24_PAGE = ' + page.url());

  page.on('console', (m) => consoleMsgs.push({ t: m.type(), x: m.text() }));
  page.on('pageerror', (e) => pageErrors.push(String(e && e.message || e)));

  /* 干净起点：把本机那份清掉，保证"看到的就是云端那一份" */
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(4000);

  const snap = (nm) => page.evaluate((n) => ({
    习惯数: state.habits.length,
    有这一条: state.habits.some((h) => h.name === n),
    卡片数: document.querySelectorAll('.habit-card').length,
    卡片名: Array.from(document.querySelectorAll('.habit-card .card-name')).map((x) => x.textContent),
    数据来源: (document.getElementById('data-source') || {}).textContent || ''
  }), nm || NAME);

  const before = await snap();
  console.log('DAY24_BEFORE    = ' + JSON.stringify({ 习惯数: before.习惯数, 数据来源: before.数据来源 }));

  /* 走真实 UI 新建一个习惯 —— 和用户手动点的一模一样 */
  await page.click('#btn-new-habit');
  await page.fill('#habit-name', NAME);
  await page.click('#habit-save');
  await page.waitForTimeout(2600);          /* 留够时间让写请求发出去 */

  const mid = await snap();
  console.log('DAY24_JUSTADDED = ' + JSON.stringify({ 习惯数: mid.习惯数, 有这一条: mid.有这一条 }));

  /* 刷新 —— 这一步就是「分水岭」 */
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(4500);

  const after = await snap();
  console.log('DAY24_AFTER     = ' + JSON.stringify(after, null, 1));
  console.log('DAY24_VERDICT   = ' + (after.有这一条
    ? '刷新后还在 → 写回库成功'
    : '刷新后没了 → 没回库（Bug 复现）'));
  const errs = consoleMsgs.filter((m) => m.t === 'error');
  console.log('DAY24_CONSOLE_ERROR = ' + errs.length);
  errs.forEach((m) => console.log('  ! ' + m.x));
  console.log('DAY24_PAGE_ERROR = ' + pageErrors.length);
  pageErrors.forEach((m) => console.log('  !! ' + m));

  process.exit(0);
})().catch((e) => { console.error('DAY24_FATAL ' + (e && e.stack || e)); process.exit(1); });
