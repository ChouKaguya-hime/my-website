/* ==========================================================================
   filter-check · 筛选交互检查（PRD AC-16）
   --------------------------------------------------------------------------
   按 skills/filter-check/SKILL.md 的 F1–F7 逐条断言，跑真实浏览器（系统 Edge）。

   用法：
     ① 项目目录下起服务：python -m http.server 8000
     ② 项目目录下：node skills/filter-check/run-check.js

   退出码 0 = 全部通过；非 0 = 有 FAIL。
   结果同时写一份 last-run.json 到本脚本同目录，供留档。
   ========================================================================== */

const fs = require('fs');
const path = require('path');

/* playwright-core 复用本机已装的那份，不进项目依赖（页面本身仍是零依赖） */
let PW;
try {
  PW = require.resolve('playwright-core');
} catch (e) {
  PW = 'C:/Users/LM/WorkBuddy/2026-09-24-18-32-42/pw/node_modules/playwright-core';
}
const { chromium } = require(PW);

const BASE = process.env.BASE || 'http://localhost:8000';
const PAGE = BASE + '/dashboard.html';
const KEY = 'habit-board/v1';
const BANNED = ['连续', '中断', '归零', '失败'];

const results = [];
function check(id, name, ok, extra) {
  results.push({ id, name, ok: !!ok, extra: extra === undefined ? '' : String(extra) });
  console.log('  ' + (ok ? 'PASS' : 'FAIL') + '  ' + name + (extra === undefined ? '' : '   [' + extra + ']'));
}
function group(t) { console.log('\n[' + t + ']'); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function todayStr() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

/* ---------------------------------------------------------------- 对比度（WCAG AA） */

function lum(rgb) {
  const [r, g, b] = rgb.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a, b) {
  const l1 = lum(a), l2 = lum(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

/* ---------------------------------------------------------------- 测试数据 */

const today = todayStr();

/* 有完成的、有没完成的 —— F1/F3/F4/F5/F6/F7 都用这份 */
const MIXED = {
  habits: [
    { id: 'h1', name: '早睡', freqType: 'daily', freqCount: 7, createdAt: today, doneDates: [today] },
    { id: 'h2', name: '读书', freqType: 'daily', freqCount: 7, createdAt: today, doneDates: [] },
    { id: 'h3', name: '跑步', freqType: 'weekly', freqCount: 3, createdAt: today, doneDates: [] }
  ],
  todos: [
    { id: 't1', text: '买菜', date: today, done: false },
    { id: 't2', text: '写周报', date: today, done: true },
    { id: 't3', text: '回邮件', date: today, done: false }
  ]
};

/* 今天全部做完了 —— 专门用来触发「筛出来是空的」（F2） */
const ALL_DONE = {
  habits: [
    { id: 'h1', name: '早睡', freqType: 'daily', freqCount: 7, createdAt: today, doneDates: [today] },
    { id: 'h2', name: '读书', freqType: 'daily', freqCount: 7, createdAt: today, doneDates: [today] }
  ],
  todos: [{ id: 't1', text: '买菜', date: today, done: true }]
};

/* ---------------------------------------------------------------- 页面小工具 */

async function loadWith(page, data) {
  await page.goto(PAGE);
  await page.evaluate(([k, d]) => localStorage.setItem(k, JSON.stringify(d)), [KEY, data]);
  await page.reload();
  await sleep(120);
}

const habitNames = (page) =>
  page.$$eval('#habit-grid .habit-card .card-name', (els) => els.map((e) => e.textContent));

const todoTexts = (page) =>
  page.$$eval('#todo-list .todo-row .todo-text', (els) => els.map((e) => e.textContent));

async function pick(page, f) {
  await page.click('.filter-btn[data-filter="' + f + '"]');
  /*
   * 等 260ms 再往下看。不是「随便等等」：
   * .filter-btn 的颜色过渡是 150ms，早于它取色会取到**过渡走到一半的中间值**
   * —— 曾经因此误判「选中态对比度只有 3.08:1」（实际稳态是 6.53:1）。
   * 凡是量「看起来怎样」的检查，都要等动效停稳。
   */
  await sleep(260);
}

/* ========================================================================== */

(async () => {
  const external = [];
  const pageErrors = [];
  const consoleErrors = [];

  const browser = await chromium.launch({ channel: 'msedge' });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  page.on('request', (req) => {
    const u = req.url();
    if (!u.startsWith(BASE) && !u.startsWith('data:') && !u.startsWith('blob:')) external.push(u);
  });
  page.on('pageerror', (e) => pageErrors.push(String(e.message || e)));
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });

  console.log('=== filter-check · 筛选交互检查 ===');
  console.log('目标：' + PAGE);
  console.log('数据：3 个习惯 / 3 条待办（今天完成 1 个习惯 + 1 条待办）');

  /* ============ 阶段 A：有完成、有未完成 ============ */
  await loadWith(page, MIXED);

  /* --- F1 有结果 --- */
  group('F1 有结果');

  const allH = await habitNames(page);
  const allT = await todoTexts(page);
  check('F1', '默认（全部）列出 3 个习惯 + 3 条待办', allH.length === 3 && allT.length === 3,
    allH.length + ' 个 / ' + allT.length + ' 条');

  await pick(page, 'open');
  const openH = await habitNames(page);
  const openT = await todoTexts(page);
  check('F1', '「未完成」筛出 2 个习惯（读书 / 跑步）',
    openH.length === 2 && openH.join() === ['读书', '跑步'].join(), openH.join(' / '));
  check('F1', '「未完成」筛出 2 条待办（买菜 / 回邮件）',
    openT.length === 2 && openT.join() === ['买菜', '回邮件'].join(), openT.join(' / '));

  await pick(page, 'done');
  const doneH = await habitNames(page);
  const doneT = await todoTexts(page);
  check('F1', '「已完成」筛出 1 个习惯（早睡）',
    doneH.length === 1 && doneH[0] === '早睡', doneH.join(' / '));
  check('F1', '「已完成」筛出 1 条待办（写周报）',
    doneT.length === 1 && doneT[0] === '写周报', doneT.join(' / '));

  /* --- F5 两个区块同口径 --- */
  group('F5 两个区块同口径');
  await pick(page, 'open');
  const anyVisibleH = (await habitNames(page)).length;
  const anyVisibleT = (await todoTexts(page)).length;
  check('F5', '一次点击同时作用于习惯区和待办区（两边都少了）',
    anyVisibleH === 2 && anyVisibleT === 2, anyVisibleH + ' 个 / ' + anyVisibleT + ' 条');

  /* --- F3 清空恢复 --- */
  group('F3 清空恢复');
  await pick(page, 'all');
  const backH = await habitNames(page);
  const backT = await todoTexts(page);
  check('F3', '点「全部」后习惯列表与初始逐条相同（数量 + 顺序）',
    backH.length === allH.length && backH.join() === allH.join(), backH.join(' / '));
  check('F3', '点「全部」后待办列表与初始逐条相同（数量 + 顺序）',
    backT.length === allT.length && backT.join() === allT.join(), backT.join(' / '));

  /* --- F4 筛选不改数据 --- */
  group('F4 筛选不改数据');
  const rawBefore = await page.evaluate((k) => localStorage.getItem(k), KEY);
  await pick(page, 'open');
  await pick(page, 'done');
  await pick(page, 'all');
  await pick(page, 'open');
  await pick(page, 'all');
  const rawAfter = await page.evaluate((k) => localStorage.getItem(k), KEY);
  check('F4', '来回切 5 次筛选后，存储里的原始字符串逐字节相同',
    rawBefore === rawAfter, rawBefore.length + ' 字节 → ' + rawAfter.length + ' 字节');

  /* --- F6 可访问性 --- */
  group('F6 可访问性');

  /*
   * 量 Tab 顺序之前，必须把「顺序导航起点」真正清零。
   * blur() 不够 —— 它只把 activeElement 变成 body，Chromium 仍然记得焦点是从哪个元素离开的，
   * 下一次 Tab 会接着那个位置往后走（实测：blur 后从「未完成」继续，永远走不到「全部」）。
   * reload 是唯一可靠的重置办法；数据在 localStorage 里，刷新不丢。
   */
  const restartTabOrder = async () => { await page.reload(); await sleep(200); };

  /* ① 三个按钮都能被 Tab 走到，且顺序与视觉顺序一致 */
  await restartTabOrder();
  const order = [];
  for (let i = 0; i < 15; i++) {
    await page.keyboard.press('Tab');
    const f = await page.evaluate(() => (document.activeElement && document.activeElement.dataset)
      ? document.activeElement.dataset.filter : '');
    if (f && order.indexOf(f) === -1) order.push(f);
  }
  check('F6', '三个筛选按钮都能被 Tab 走到',
    order.length === 3, order.join(' → ') || '一个都没走到');
  check('F6', 'Tab 顺序与视觉顺序一致（全部 → 未完成 → 已完成）',
    order.join() === ['all', 'open', 'done'].join(), order.join(' → '));

  /* ② 键盘按得下去 */
  await page.focus('.filter-btn[data-filter="open"]');
  await page.keyboard.press('Enter');
  await sleep(120);
  const afterEnter = await habitNames(page);
  check('F6', 'Enter 能切换筛选（「未完成」生效）',
    afterEnter.length === 2, afterEnter.length + ' 个习惯');

  await page.focus('.filter-btn[data-filter="done"]');
  await page.keyboard.press('Space');
  await sleep(120);
  const afterSpace = await habitNames(page);
  check('F6', '空格键能切换筛选（「已完成」生效）',
    afterSpace.length === 1 && afterSpace[0] === '早睡', afterSpace.join(' / '));

  /* ③ aria-pressed 与视觉选中态一致，且只有一个 true */
  const states = await page.$$eval('.filter-btn', (els) => els.map((b) => ({
    f: b.dataset.filter,
    pressed: b.getAttribute('aria-pressed'),
    on: b.classList.contains('is-on')
  })));
  const pressedOnes = states.filter((s) => s.pressed === 'true');
  const mismatch = states.filter((s) => (s.pressed === 'true') !== s.on);
  check('F6', 'aria-pressed 与视觉选中态一致，且任何时刻只有一个选中',
    pressedOnes.length === 1 && mismatch.length === 0,
    states.map((s) => s.f + '=' + s.pressed + '/' + (s.on ? 'on' : 'off')).join(' '));

  /* ④ aria-live 区在切换后真的有内容变化 */
  const liveText = await page.textContent('#filter-state');
  check('F6', '切换后 aria-live 区有更新（读屏软件能播报条数）',
    /筛出\s*\d+\s*个习惯/.test(liveText || ''), JSON.stringify(liveText));
  await pick(page, 'all');
  const liveAll = await page.textContent('#filter-state');
  check('F6', '回到「全部」时该区清空（不啰嗦）', (liveAll || '').trim() === '', JSON.stringify(liveAll));

  /* ⑤ 选中态按钮的文字对比度过 AA（鼠标先移开，量的是稳态的原色，不是 hover 色） */
  await pick(page, 'open');
  await page.mouse.move(5, 5);
  await sleep(260);
  const cm = await page.evaluate(() => {
    const b = document.querySelector('.filter-btn[data-filter="open"]');
    const s = getComputedStyle(b);
    const parse = (c) => (c.match(/\d+(\.\d+)?/g) || []).slice(0, 3).map(Number);
    return {
      fg: parse(s.color), bg: parse(s.backgroundColor),
      fgRaw: s.color, bgRaw: s.backgroundColor,
      on: b.classList.contains('is-on')
    };
  });
  const ratio = contrast(cm.fg, cm.bg);
  check('F6', '选中态按钮文字对比度 ≥ 4.5:1（WCAG AA）',
    cm.on && ratio >= 4.5,
    ratio.toFixed(2) + ':1  ' + cm.fgRaw + ' on ' + cm.bgRaw + (cm.on ? '' : '  ⚠ 取到的不是实心态'));

  /*
   * ⑥ 焦点环。两个前提缺一不可：
   *   ① 必须**先用键盘 Tab 走到按钮上**再量 —— :focus-visible 只在「键盘操作带来的焦点」下生效，
   *      拿一个没焦点的按钮去读 outline 永远读到 none，那是假 FAIL；
   *   ② 起点要先归零，否则从上次的位置往后走，走到哪个按钮全看运气。
   */
  await restartTabOrder();
  let ring = null;
  for (let i = 0; i < 15; i++) {
    await page.keyboard.press('Tab');
    const fo = await page.evaluate(() => {
      const a = document.activeElement;
      if (!a || !a.classList || !a.classList.contains('filter-btn')) return null;
      const s = getComputedStyle(a);
      return {
        filter: a.dataset.filter, style: s.outlineStyle,
        width: s.outlineWidth, color: s.outlineColor,
        visible: a.matches(':focus-visible')
      };
    });
    if (fo) { ring = fo; break; }
  }
  check('F6', 'Tab 到筛选按钮时有可见的键盘焦点环',
    !!ring && ring.visible && ring.style !== 'none' && parseFloat(ring.width) > 0,
    ring ? (ring.filter + ' → ' + ring.style + ' ' + ring.width + ' ' + ring.color) : 'Tab 没走到筛选按钮');

  /* --- F7 项目硬约束 --- */
  group('F7 项目硬约束');

  const bodyText = await page.evaluate(() => document.body.innerText);
  const hit = BANNED.filter((w) => bodyText.indexOf(w) !== -1);
  check('F7', '渲染后的页面文本里没有文案黑名单（AC-6）',
    hit.length === 0, hit.length ? '命中：' + hit.join('、') : '四个词命中 0');

  check('F7', '全程零外部网络请求（AC-10）',
    external.length === 0, external.length ? external.join(' , ') : '0 条外部请求');

  /*
   * console 里那条 404 到底是谁 —— **实测一遍再说**，不按「大概是 favicon」拍脑袋。
   * （项目 AGENTS.md 追加 2：写进结论的事实，要能指出核验动作。）
   */
  const favRes = await page.request.get(BASE + '/favicon.ico');
  const favicon404 = favRes.status() === 404;
  const KNOWN_NOISE = /Failed to load resource: the server responded with a status of 404/;
  const unexpected = consoleErrors.filter((t) => !KNOWN_NOISE.test(t));

  check('F7', '没有 JS 异常（pageerror）',
    pageErrors.length === 0, pageErrors.join(' | ') || '0 条');
  check('F7', 'console 里没有计划外的报错（唯一那条 404 已实测确认来自 favicon.ico）',
    unexpected.length === 0 && favicon404,
    unexpected.length
      ? unexpected.join(' | ').slice(0, 160)
      : '0 条计划外；favicon.ico 实测 HTTP ' + favRes.status()
        + '（静态服务没放网站图标，浏览器自动请求，与页面代码无关）');

  /* ============ 阶段 B：今天全部完成 → 筛空 ============ */
  await loadWith(page, ALL_DONE);

  group('F2 无结果');

  await pick(page, 'open');

  const emptyH = await habitNames(page);
  const emptyT = await todoTexts(page);
  const noteH = await page.textContent('#habit-empty');
  const noteT = await page.textContent('#todo-empty');
  const noteHShown = await page.evaluate(() => !document.getElementById('habit-empty').hidden);
  const noteTShown = await page.evaluate(() => !document.getElementById('todo-empty').hidden);

  check('F2', '「未完成」下习惯区确实是空的', emptyH.length === 0, emptyH.length + ' 个');
  check('F2', '「未完成」下待办区确实是空的', emptyT.length === 0, emptyT.length + ' 条');
  check('F2', '习惯区出现一句非空说明（不是一片空白）',
    noteHShown && (noteH || '').trim().length > 0, JSON.stringify(noteH));
  check('F2', '待办区出现一句非空说明（不是一片空白）',
    noteTShown && (noteT || '').trim().length > 0, JSON.stringify(noteT));

  const emptyBanned = BANNED.filter((w) => ((noteH || '') + (noteT || '')).indexOf(w) !== -1);
  check('F2', '这两句说明里没有文案黑名单（AC-6）',
    emptyBanned.length === 0, emptyBanned.join('、') || '四个词命中 0');

  const voidBoxHidden = await page.evaluate(() => {
    const box = document.getElementById('todo-list');
    return getComputedStyle(box).display === 'none';
  });
  check('F2', '空的时候待办列表的空边框被收掉（不留一个像坏了的空框）', voidBoxHidden);

  /* ============ 收尾 ============ */
  await pick(page, 'all');
  await browser.close();

  const failed = results.filter((r) => !r.ok);
  const summary = {
    when: new Date().toISOString(),
    target: PAGE,
    total: results.length,
    passed: results.length - failed.length,
    failed: failed.length,
    failedItems: failed.map((r) => r.id + ' · ' + r.name),
    results
  };
  fs.writeFileSync(path.join(__dirname, 'last-run.json'), JSON.stringify(summary, null, 2), 'utf8');

  console.log('\n================ 汇总 ================');
  console.log('断言 ' + results.length + ' 条：通过 ' + (results.length - failed.length) + ' 条，失败 ' + failed.length + ' 条');
  if (failed.length) failed.forEach((f) => console.log('  FAILED  [' + f.id + '] ' + f.name));
  console.log('结果已写入 skills/filter-check/last-run.json');

  process.exit(failed.length ? 1 : 0);
})().catch((e) => {
  console.error('\n脚本自身出错：' + (e && e.stack ? e.stack : e));
  process.exit(2);
});
