/*
 * Day 24 · 完整用户路径实录（真实云端，不拦请求）
 * 用法: node trace.js <端口> <页面URL>
 *
 * 目的：把 F12 的 Console / Network 两栏，按「操作步骤」分段打印成文字。
 * 要回答的三个问题：
 *   ① 页面打开时，数据是从哪来的（本机 / 云端）？
 *   ② 在页面上加待办 / 勾习惯，**有没有发出写请求**？
 *   ③ 刷新之后，刚才加的东西还在不在？
 */
const { chromium } = require('playwright-core');

const PORT = process.argv[2] || '9341';
const TARGET = process.argv[3];

const reqs = [], resps = [], consoleMsgs = [], pageErrors = [], failed = [];
let step = '(加载前)';
const marks = [];

function cut(name) {
  marks.push({ name, req: reqs.length, resp: resps.length, con: consoleMsgs.length, err: pageErrors.length, fail: failed.length });
  step = name;
}
function since(i, arr) { return arr.slice(m ? arr : 0); }
let m = 0;

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:' + PORT);
  const ctx = browser.contexts()[0];
  let page = ctx.pages().find((p) => { try { return p.url().includes(new URL(TARGET).host); } catch (e) { return false; } });
  if (!page) page = ctx.pages()[0];
  console.log('选中页面 = ' + page.url());

  page.on('request', (r) => reqs.push({ m: r.method(), u: r.url(), t: r.resourceType() }));
  page.on('response', (r) => resps.push({ s: r.status(), u: r.url() }));
  page.on('requestfailed', (r) => failed.push({ u: r.url(), e: (r.failure() || {}).errorText }));
  page.on('console', (x) => consoleMsgs.push({ t: x.type(), x: x.text() }));
  page.on('pageerror', (e) => pageErrors.push(String(e)));

  // 干净起点
  await page.goto(TARGET, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  await page.evaluate(() => localStorage.clear());
  reqs.length = resps.length = consoleMsgs.length = pageErrors.length = failed.length = 0;

  // ---------- 步骤 1：干净加载 ----------
  await page.goto(TARGET, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(4500);
  cut('步骤1 干净加载');
  const st1 = await page.evaluate(() => ({
    source: window.HabitBoardCloud ? HabitBoardCloud.source : '(没有 cloud.js)',
    error: window.HabitBoardCloud ? HabitBoardCloud.error : null,
    habits: state.habits.length,
    todos: state.todos.length,
    cards: document.querySelectorAll('.habit-card').length,
    dataSource: (document.getElementById('data-source') || {}).textContent || '(空)',
    ls: (localStorage.getItem('habit-board/v1') || '').length
  }));
  console.log('  → ' + JSON.stringify(st1));

  // ---------- 步骤 2：在页面上加一条待办（走真实 UI）----------
  await page.fill('#todo-input', '买牛奶');
  await page.click('#todo-add');
  await page.waitForTimeout(800);
  cut('步骤2 加一条待办');
  const st2 = await page.evaluate(() => ({
    todos: state.todos.map((t) => t.text),
    条数: state.todos.length,
    页面上有这条: document.body.innerText.includes('买牛奶')
  }));
  console.log('  → ' + JSON.stringify(st2));

  // ---------- 步骤 3：勾选第一个习惯（兼容两种界面：卡片式 .habit-card / 旧行式 .habit-row）----------
  await page.click('.habit-card .check, .habit-row .habit-check', { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(800);
  cut('步骤3 勾选一个习惯');
  const st3 = await page.evaluate(() => ({
    第一个习惯: state.habits[0] ? state.habits[0].name : null,
    doneDates: state.habits[0] ? state.habits[0].doneDates : [],
    今天勾上了: state.habits[0] ? state.habits[0].doneDates.indexOf(todayStr()) !== -1 : null
  }));
  console.log('  → ' + JSON.stringify(st3));

  // ---------- 步骤 4：刷新 ----------
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(4500);
  cut('步骤4 刷新页面');
  const st4 = await page.evaluate(() => ({
    source: window.HabitBoardCloud ? HabitBoardCloud.source : null,
    todos: state.todos.map((t) => t.text),
    条数: state.todos.length,
    '买牛奶还在吗': document.body.innerText.includes('买牛奶'),
    第一个习惯今天勾上了吗: state.habits[0] ? state.habits[0].doneDates.indexOf(todayStr()) !== -1 : null
  }));
  console.log('  → ' + JSON.stringify(st4));

  await page.waitForTimeout(500);

  // ---------- 分段打印 F12 的三栏 ----------
  console.log('');
  for (let i = 0; i < marks.length; i++) {
    const a = marks[i];
    const b = marks[i + 1] || { req: reqs.length, resp: resps.length, con: consoleMsgs.length, err: pageErrors.length, fail: failed.length };
    console.log('================ ' + a.name + ' ================');
    const rq = reqs.slice(a.req, b.req), rs = resps.slice(a.resp, b.resp);
    const cn = consoleMsgs.slice(a.con, b.con), er = pageErrors.slice(a.err, b.err), fa = failed.slice(a.fail, b.fail);
    console.log('  [Network] 请求 ' + rq.length + ' 条：');
    rq.forEach((r) => console.log('    ' + r.m + ' ' + r.t.padEnd(10) + ' ' + r.u));
    console.log('  [Network] 回应 ' + rs.length + ' 条：');
    rs.forEach((r) => console.log('    ' + String(r.s).padEnd(4) + ' ' + r.u));
    if (fa.length) { console.log('  [Network] 失败 ' + fa.length + ' 条：'); fa.forEach((f) => console.log('    x ' + f.u + '  ' + f.e)); }
    console.log('  [Console] ' + cn.length + ' 条：');
    cn.forEach((c) => console.log('    [' + c.t + '] ' + c.x));
    console.log('  [异常] ' + er.length + ' 条：');
    er.forEach((e) => console.log('    !! ' + e));
    console.log('');
  }

  console.log('SUMMARY ' + JSON.stringify({
    写请求条数: reqs.filter((r) => r.t === 'fetch' || r.t === 'xhr').length,
    写请求详情: reqs.filter((r) => ['POST', 'PATCH', 'PUT', 'DELETE'].includes(r.m)).map((r) => r.m + ' ' + r.u),
    consoleError: consoleMsgs.filter((c) => c.t === 'error').length,
    pageError: pageErrors.length,
    failed: failed.length
  }));
  process.exit(0);
})().catch((e) => { console.error('FATAL ' + (e && e.stack || e)); process.exit(1); });
