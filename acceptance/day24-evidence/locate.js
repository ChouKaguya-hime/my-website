/*
 * Day 24 · 定位探针（只读性质，不改任何线上数据）
 * 用法: node locate.js <端口> <页面URL>
 *
 * 三个实验，全都在页面上下文里发请求 —— 这样报错才会真的出现在 F12 Console 里：
 *   A. POST /api/todos          → 看「加待办」这条路在服务端到底通不通
 *   B. PATCH /api/habits/<id>   → 带 doneDates（**值 = 当前值，绝不会改数据**），看服务端收不收
 *   C. GET  /api/habits         → 对照组：读是好的
 */
const { chromium } = require('playwright-core');

const PORT = process.argv[2] || '9342';
const TARGET = process.argv[3];
const BASE = 'https://habit-board-d0gum6nqu512acc29-1499798330.ap-shanghai.app.tcloudbase.com';

const consoleMsgs = [], pageErrors = [], failed = [], reqs = [], resps = [];

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:' + PORT);
  const ctx = browser.contexts()[0];
  let page = ctx.pages().find((p) => { try { return p.url().includes(new URL(TARGET).host); } catch (e) { return false; } });
  if (!page) page = ctx.pages()[0];
  console.log('选中页面 = ' + page.url());

  page.on('console', (m) => consoleMsgs.push({ t: m.type(), x: m.text() }));
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  page.on('requestfailed', (r) => failed.push({ u: r.url(), e: (r.failure() || {}).errorText }));

  await page.goto(TARGET, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(3000);
  consoleMsgs.length = pageErrors.length = failed.length = 0;

  // ---------- C（对照组）：先把当前数据读出来，B 要拿它当"原值"----------
  const raw = await page.evaluate(async (base) => {
    const r = await fetch(base + '/api/habits');
    const j = await r.json();
    return { status: r.status, count: j.count, first: j.data && j.data[0] };
  }, BASE);
  console.log('');
  console.log('【C 对照组】GET /api/habits → HTTP ' + raw.status + '，count=' + raw.count);
  console.log('  第一条 = ' + JSON.stringify(raw.first));
  await page.waitForTimeout(800);

  // ---------- A：POST /api/todos（期望：服务端不支持写）----------
  const aMark = { c: consoleMsgs.length, f: failed.length, r: resps.length };
  const a = await page.evaluate(async (base) => {
    try {
      const r = await fetch(base + '/api/todos', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'Day24 定位探针（不该被写进去）' })
      });
      let body = '';
      try { body = JSON.stringify(await r.json()); } catch (e) { body = '(不是 JSON)'; }
      return { 到达服务端: true, status: r.status, body: body.slice(0, 240) };
    } catch (e) {
      return { 到达服务端: false, 被浏览器拦下: String(e && e.message || e) };
    }
  }, BASE);
  console.log('');
  console.log('【A 实验】POST /api/todos →');
  console.log('  ' + JSON.stringify(a, null, 1));
  await page.waitForTimeout(1200);
  console.log('  这一步 Console 新增：');
  consoleMsgs.slice(aMark.c).forEach((m) => console.log('    [' + m.t + '] ' + m.x));

  // ---------- B：PATCH /api/habits/<id>，带 doneDates（值 = 原值，不改数据）----------
  const bMark = { c: consoleMsgs.length };
  const b = await page.evaluate(async ({ base, id, doneDates }) => {
    const r = await fetch(base + '/api/habits/' + encodeURIComponent(id), {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ doneDates: doneDates })   // 故意带一个"当前值"，即便被接受也不变
    });
    let body = '';
    try { body = JSON.stringify(await r.json()); } catch (e) { body = '(不是 JSON)'; }
    return { status: r.status, body: body.slice(0, 300) };
  }, { base: BASE, id: raw.first.id, doneDates: raw.first.doneDates });
  console.log('');
  console.log('【B 实验】PATCH /api/habits/' + raw.first.id + '  body={"doneDates": <原值>} →');
  console.log('  ' + JSON.stringify(b, null, 1));
  await page.waitForTimeout(1200);

  // ---------- B2：同一地址，带一个白名单内的字段（安全：改成原名，值不变）----------
  const b2 = await page.evaluate(async ({ base, id, name }) => {
    const r = await fetch(base + '/api/habits/' + encodeURIComponent(id), {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: name })             // 原名，等于没改
    });
    let body = '';
    try { body = JSON.stringify(await r.json()); } catch (e) { body = '(不是 JSON)'; }
    return { status: r.status, ok: (JSON.parse(body) || {}).ok, body: body.slice(0, 200) };
  }, { base: BASE, id: raw.first.id, name: raw.first.name });
  console.log('');
  console.log('【B2 对照】PATCH 同一地址，body={"name": 原名} → HTTP ' + b2.status + ' ok=' + b2.ok);
  await page.waitForTimeout(800);

  // ---------- 打印 F12 三栏 ----------
  console.log('');
  console.log('================ F12 · Console ================');
  consoleMsgs.forEach((m) => console.log('  [' + m.t + '] ' + m.x));
  console.log('================ F12 · 未捕获异常 ================');
  pageErrors.forEach((e) => console.log('  !! ' + e));
  console.log('================ F12 · 失败请求 ================');
  failed.forEach((f) => console.log('  x ' + f.u + '  ' + f.e));
  console.log('');
  console.log('SUMMARY ' + JSON.stringify({
    A_到达服务端: a.到达服务端, A_status: a.status || null, A_被拦: a.被浏览器拦下 || null,
    B_status: b.status, B2_status: b2.status,
    consoleError: consoleMsgs.filter((m) => m.t === 'error').length,
    failed: failed.length
  }));
  process.exit(0);
})().catch((e) => { console.error('FATAL ' + (e && e.stack || e)); process.exit(1); });
