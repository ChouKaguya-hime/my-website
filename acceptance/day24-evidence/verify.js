/*
 * Day 24 · 修复后验证（端到端，走真实 UI + 真实云端）
 * 用法: node verify.js <端口> <页面URL>
 *
 * 一条龙：新建 → 刷新 → 编辑 → 刷新 → 删除 → 刷新，每步都把 F12 的 Network / Console 分段打出来。
 * 收尾保证：不管中途出什么岔子，都尽力把验证用的那条习惯删干净（不留垃圾数据）。
 */
const { chromium } = require('playwright-core');

const PORT = process.argv[2] || '9343';
const TARGET = process.argv[3];
const BASE = 'https://habit-board-d0gum6nqu512acc29-1499798330.ap-shanghai.app.tcloudbase.com';

const N1 = '__Day24验证__';
const N2 = '__Day24验证_改过名__';

const reqs = [], resps = [], consoleMsgs = [], pageErrors = [], failed = [];
const marks = [];

function cut(name) {
  marks.push({ name, req: reqs.length, resp: resps.length, con: consoleMsgs.length, err: pageErrors.length, fail: failed.length });
}

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

  const state = () => page.evaluate(({ n1, n2 }) => ({
    习惯数: state.habits.length,
    有N1: state.habits.some((h) => h.name === n1),
    有N2: state.habits.some((h) => h.name === n2),
    卡片数: document.querySelectorAll('.habit-card').length,
    页面上有N1: document.body.innerText.includes(n1),
    页面上有N2: document.body.innerText.includes(n2),
    数据来源: (document.getElementById('data-source') || {}).textContent || ''
  }), { n1: N1, n2: N2 });

  // 干净起点
  await page.goto(TARGET, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  await page.evaluate(() => localStorage.clear());
  reqs.length = resps.length = consoleMsgs.length = pageErrors.length = failed.length = 0;

  // ---------- 步骤 0：加载 ----------
  await page.goto(TARGET, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(4500);
  cut('步骤0 干净加载');
  console.log('  → ' + JSON.stringify(await state()));

  // ---------- 步骤 1：新建一个习惯（走真实 UI）----------
  await page.click('#btn-new-habit');
  await page.fill('#habit-name', N1);
  await page.click('#habit-save');
  await page.waitForTimeout(2500);
  cut('步骤1 新建习惯「' + N1 + '」');
  console.log('  → ' + JSON.stringify(await state()));

  // ---------- 步骤 2：刷新，看还在不在 ----------
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(4500);
  cut('步骤2 刷新');
  const s2 = await state();
  console.log('  → ' + JSON.stringify(s2));
  console.log('  ★ 刷新后还在吗 = ' + (s2.有N1 ? '在（写回库成功）' : '没了（还是没回库）'));

  // ---------- 步骤 3：编辑它（走真实 UI：点名字 → 编辑）----------
  await page.click('.habit-card:has-text("' + N1 + '") .card-name').catch(() => {});
  await page.click('#detail-edit').catch(() => {});
  await page.fill('#habit-name', N2);
  await page.click('#habit-save');
  await page.waitForTimeout(2500);
  cut('步骤3 编辑成「' + N2 + '」');
  console.log('  → ' + JSON.stringify(await state()));

  // ---------- 步骤 4：刷新，看新名字在不在 ----------
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(4500);
  cut('步骤4 刷新');
  const s4 = await state();
  console.log('  → ' + JSON.stringify(s4));
  console.log('  ★ 改的名字保持住了吗 = ' + (s4.有N2 ? '保持住了（PATCH 成功）' : '丢了（PATCH 没生效）'));

  // ---------- 步骤 5：删掉它 ----------
  await page.click('.habit-card:has-text("' + N2 + '") .card-name').catch(() => {});
  await page.click('#detail-delete').catch(() => {});
  await page.click('#confirm-ok').catch(() => {});
  await page.waitForTimeout(2500);
  cut('步骤5 删除');
  console.log('  → ' + JSON.stringify(await state()));

  // ---------- 步骤 6：刷新，看是不是真没了 ----------
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(4500);
  cut('步骤6 刷新');
  const s6 = await state();
  console.log('  → ' + JSON.stringify(s6));
  console.log('  ★ 删掉的没复活吗 = ' + (!s6.有N2 ? '没复活（DELETE 成功）' : '又回来了（DELETE 没生效）'));

  // ---------- 兜底清理：库里若还留着就删掉 ----------
  const left = await page.evaluate(async ({ base, n1, n2 }) => {
    const r = await fetch(base + '/api/habits');
    const j = await r.json();
    const junk = (j.data || []).filter((h) => h.name === n1 || h.name === n2);
    for (const h of junk) {
      await fetch(base + '/api/habits/' + encodeURIComponent(h.id), { method: 'DELETE' });
    }
    return junk.map((h) => h.id + ' ' + h.name);
  }, { base: BASE, n1: N1, n2: N2 });
  console.log('');
  console.log('兜底清理（库里本来还剩的验证数据）= ' + JSON.stringify(left));

  // ---------- 分段打印 F12 ----------
  console.log('');
  for (let i = 0; i < marks.length; i++) {
    const a = marks[i];
    const b = marks[i + 1] || { req: reqs.length, resp: resps.length, con: consoleMsgs.length, err: pageErrors.length, fail: failed.length };
    console.log('================ ' + a.name + ' ================');
    const rq = reqs.slice(a.req, b.req), rs = resps.slice(a.resp, b.resp);
    const cn = consoleMsgs.slice(a.con, b.con), er = pageErrors.slice(a.err, b.err), fa = failed.slice(a.fail, b.fail);
    const writes = rq.filter((r) => ['POST', 'PATCH', 'PUT', 'DELETE'].includes(r.m));
    console.log('  [Network] 写请求 ' + writes.length + ' 条：');
    writes.forEach((r) => console.log('    ' + r.m + ' ' + r.u));
    const wr = rs.filter((r) => r.u.includes('/api/'));
    console.log('  [Network] 接口回应 ' + wr.length + ' 条：');
    wr.forEach((r) => console.log('    ' + String(r.s).padEnd(4) + ' ' + r.u.replace(BASE, '<BASE>')));
    if (fa.length) { console.log('  [Network] 失败 ' + fa.length + ' 条：'); fa.forEach((f) => console.log('    x ' + f.u + '  ' + f.e)); }
    const ce = cn.filter((c) => c.t === 'error' || c.t === 'warning');
    console.log('  [Console] error/warn ' + ce.length + ' 条：');
    ce.forEach((c) => console.log('    [' + c.t + '] ' + c.x));
    console.log('  [异常] ' + er.length + ' 条：' + (er.length ? '' : '无'));
    er.forEach((e) => console.log('    !! ' + e));
    console.log('');
  }

  const allWrites = reqs.filter((r) => ['POST', 'PATCH', 'PUT', 'DELETE'].includes(r.m) && r.u.includes('/api/'));
  console.log('SUMMARY ' + JSON.stringify({
    写请求: allWrites.map((r) => r.m + ' ' + (r.u.split('/api/')[1] || '')),
    写请求回应: resps.filter((r) => r.u.includes('/api/') && r.u !== BASE + '/api/habits' && r.u !== BASE + '/api/todos').map((r) => r.s + ' ' + (r.u.split('/api/')[1] || '')),
    consoleError: consoleMsgs.filter((c) => c.t === 'error').length,
    consoleWarn: consoleMsgs.filter((c) => c.t === 'warning').length,
    pageError: pageErrors.length,
    failed: failed.length,
    最终库里残留验证数据: left.length
  }));
  process.exit(0);
})().catch((e) => { console.error('FATAL ' + (e && e.stack || e)); process.exit(1); });
