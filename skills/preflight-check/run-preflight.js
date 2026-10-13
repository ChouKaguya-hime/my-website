#!/usr/bin/env node
/**
 * preflight-check · 发布前检查（可执行脚本）
 * ---------------------------------------------------------------
 * 这是 SKILL.md 里 A/B/C 三块检查项的逐条断言。零依赖，只用 Node 内置
 * 模块（fs / path / child_process / 全局 fetch），不需要开浏览器。
 *
 * 跑法（在项目根目录下）：
 *   "C:\Users\LM\.workbuddy\binaries\node\versions\22.22.2\node.exe" skills\preflight-check\run-preflight.js
 *
 * 退出码：0 = 全过；1 = 有 FAIL；2 = 脚本自身出错（比如找不到项目文件）。
 * 结果同时写一份 last-run.json 到脚本同目录，供留档。
 *
 * 环境变量（都可选）：
 *   PREFLIGHT_GIT   git 可执行文件路径，默认 "git"（PATH 里那份）
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const HERE = __dirname;
const PROJECT = path.resolve(HERE, '..', '..'); // .../my-website
const GIT = process.env.PREFLIGHT_GIT || 'git';

// ---- 项目相关常量（本项目专用的几处硬编码，跟 filter-check 里写死 localhost:8000 同理）----
const STATIC_URL = 'https://habit-board-d0gum6nqu512acc29-1499798330.tcloudbaseapp.com';
const API_URL = 'https://habit-board-d0gum6nqu512acc29-1499798330.ap-shanghai.app.tcloudbase.com';
const EXPECT_SERVICE = 'habit-board-api';
// 要跟公网比「是不是最新」的前端文件（本地源码 → 公网同名文件，比字节数）
const FRONTEND_FILES = ['index.html', 'app.js', 'cloud.js', 'style.css', 'theme.css', 'dashboard.html', 'dashboard.js'];

const results = [];
function record(board, id, name, ok, extra) {
  results.push({ board, id, name, ok: !!ok, extra: extra === undefined ? '' : String(extra) });
  const tag = ok ? 'PASS' : 'FAIL';
  console.log(`[${tag}] ${id}  ${name}${extra ? '  —  ' + extra : ''}`);
}

// ---------- 小工具 ----------

function readIfExists(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch (e) { return null; }
}

function gitLines(args) {
  const out = execFileSync(GIT, args, { cwd: PROJECT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return out.split('\u0000').filter(Boolean);
}

function parseEnv(text) {
  const map = {};
  for (const raw of (text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const k = line.slice(0, eq).trim();
    let v = line.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    map[k] = v;
  }
  return map;
}

const SENSITIVE_KEY = /(KEY|SECRET|TOKEN|PASSWORD|PASSWD|PWD|DSN|CREDENTIAL)/i;
const TEXT_EXT = new Set(['.js', '.mjs', '.cjs', '.json', '.md', '.html', '.htm', '.css', '.txt', '.yml', '.yaml', '.xml', '.env', '.sh', '.ps1', '.py', '.ts']);

// 本技能自身目录。它是「检查器」——文档和脚本里**必然**写着这些要查的特征字样本身
// （比如下面 roleRe 那条标记、SKILL.md 里对它的说明）。若让它参与「特征字样」比对，
// 就会永远自我命中，那是一条假的 FAIL。所以 A2 里三条「特征字样」比对
// （私钥头 / service_role 标记 / 疑似 JWT）**跳过这个目录**。
// ⚠️ 但最要紧的「.env 真值比对」**不跳过**，仍全量扫 —— 真把密钥值写进这里照样抓得到。
// （这条排除的理由按 SKILL.md「判定硬规矩 2」的要求，也写进了 SKILL.md。）
const SELF_DIR = 'skills/preflight-check/';

// ★ Day 27 补：同一个坑的**第二次出现** —— 「特征字样」比对**同时跳过「证据/文档」目录**。
// 为什么：Day 26 我把「A2 为什么会误报自己」这件事原样写进了验收报告和部署日志，
// 那一写，就把 `"role":"service_role"` 这个**规则字样**带进了 acceptance/ 下的文件；
// Day 26 提交之后 A2 立刻在这两个**验收文档**上命中 —— 和第一次误报技能目录是同一个坑，
// 只是换了个地方（从「技能目录」换成了「验收文档」）。
// acceptance/ 和 user-test/ 是给人看的证据、不是发布物、也不进公网，讨论规则时必然出现规则字样。
// ⚠️ 同 SELF_DIR：最要紧的「.env 真值比对」**依旧不跳过**，仍全量扫。
const DOC_DIRS = ['acceptance/', 'user-test/'];

// ---------- 板块 A · 密钥别泄漏 ----------

function boardA() {
  const envText = readIfExists(path.join(PROJECT, '.env')) || '';
  const envMap = parseEnv(envText);

  let tracked;
  try {
    tracked = gitLines(['ls-files', '-z']);
  } catch (e) {
    record('A', 'A1', '能读到 Git 跟踪清单', false, 'git ls-files 失败：' + e.message);
    return;
  }

  // A1：敏感文件本身没被跟踪
  const risky = /(^|\/)(\.env(\.|$)|[^/]+\.(key|pem|p12|pfx))$/i;
  const leakNames = tracked.filter((f) => risky.test(f));
  record(
    'A', 'A1', '敏感文件没被 Git 跟踪（.env / *.key / *.pem / *.p12 / *.pfx）',
    leakNames.length === 0,
    leakNames.length === 0 ? `跟踪清单 ${tracked.length} 个文件，无敏感文件` : '被跟踪：' + leakNames.join(', ')
  );

  // A2：跟踪的文本文件里没有硬编码密钥
  const sensitivePairs = Object.entries(envMap).filter(
    ([k, v]) => SENSITIVE_KEY.test(k) && String(v).length >= 12
  );
  const jwtRe = /eyJ[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}/g;
  const privRe = /-----BEGIN [A-Z ]*PRIVATE KEY-----/;
  const roleRe = /"role"\s*:\s*"service_role"/;

  const hits = [];
  for (const rel of tracked) {
    const ext = path.extname(rel).toLowerCase();
    const base = path.basename(rel);
    if (!TEXT_EXT.has(ext) && !/(^|\/)\.env/i.test(base) && ext !== '') continue;
    const abs = path.join(PROJECT, rel);
    let content;
    try {
      const st = fs.statSync(abs);
      if (st.size > 4 * 1024 * 1024) continue; // 超大文件跳过
      content = fs.readFileSync(abs, 'utf8');
    } catch (e) { continue; }
    if (content.indexOf('\u0000') >= 0) continue; // 二进制

    for (const [k, v] of sensitivePairs) {
      if (content.includes(String(v))) hits.push({ file: rel, why: `含 .env 里 ${k} 的值` });
    }
    // 三条「特征字样」比对：技能自身目录 + 证据/文档目录 跳过（见上面两处说明，避免自我命中）
    const relPosix = rel.replace(/\\/g, '/');
    const isSelf = relPosix.startsWith(SELF_DIR);
    const isDoc = DOC_DIRS.some((d) => relPosix.startsWith(d));
    if (!isSelf && !isDoc) {
      if (privRe.test(content)) hits.push({ file: rel, why: '含私钥头 BEGIN PRIVATE KEY' });
      if (roleRe.test(content)) hits.push({ file: rel, why: '含 "role":"service_role" 服务端密钥标记' });
      const jwts = content.match(jwtRe);
      if (jwts) hits.push({ file: rel, why: `含疑似 JWT（${jwts[0].slice(0, 12)}…）` });
    }
  }

  const uniq = [];
  const seen = new Set();
  for (const h of hits) {
    const key = h.file + '|' + h.why;
    if (!seen.has(key)) { seen.add(key); uniq.push(h); }
  }

  record(
    'A', 'A2', '被跟踪的文件里没有硬编码密钥',
    uniq.length === 0,
    uniq.length === 0
      ? `扫描 ${tracked.length} 个跟踪文件（比对 .env 里 ${sensitivePairs.length} 个敏感值 + 密钥特征），干净`
      : uniq.map((h) => `${h.file} ← ${h.why}`).join('；')
  );
}

// ---------- 板块 B · 公网能打开且是最新 ----------

async function get(url, asText) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 25000);
  try {
    const res = await fetch(url, { signal: ctrl.signal, redirect: 'follow' });
    const body = asText ? await res.text() : Buffer.from(await res.arrayBuffer());
    return { ok: true, status: res.status, body };
  } catch (e) {
    return { ok: false, error: e.message };
  } finally {
    clearTimeout(timer);
  }
}

async function boardB() {
  // B1：公网首页
  const home = await get(STATIC_URL + '/', true);
  record(
    'B', 'B1', '公网首页能打开（静态站返回 200）',
    home.ok && home.status === 200,
    home.ok ? `HTTP ${home.status}  ${STATIC_URL}/` : `取不到：${home.error}`
  );

  // B2：公网接口可达且是这份环境
  const envMap = parseEnv(readIfExists(path.join(PROJECT, '.env')) || '');
  const expectEnv = envMap.ENV_ID || '';
  const health = await get(API_URL + '/api-health', true);
  let h = null;
  try { h = JSON.parse(health.body); } catch (e) { h = null; }
  const b2ok = health.ok && health.status === 200 && h && h.service === EXPECT_SERVICE && (!expectEnv || h.envId === expectEnv);
  record(
    'B', 'B2', '公网接口可达且是对的这份（/api-health）',
    b2ok,
    health.ok
      ? `HTTP ${health.status}  service=${h && h.service}  envId=${h && h.envId}${expectEnv && h && h.envId === expectEnv ? '（与 .env 一致）' : expectEnv ? `（.env 期望 ${expectEnv}）` : ''}`
      : `取不到：${health.error}`
  );

  // B3：公网那份是最新（拿公网文件跟本地源码逐个比字节）
  const mism = [];
  for (const f of FRONTEND_FILES) {
    const local = path.join(PROJECT, f);
    if (!fs.existsSync(local)) continue;
    const localSize = fs.statSync(local).size;
    const pub = await get(STATIC_URL + '/' + f, false);
    if (!pub.ok || pub.status !== 200) { mism.push(`${f}: 公网 HTTP ${pub.ok ? pub.status : '取不到'}`); continue; }
    if (pub.body.length !== localSize) mism.push(`${f}: 本地 ${localSize} 字节 ≠ 公网 ${pub.body.length} 字节`);
  }
  record(
    'B', 'B3', '公网那份是最新（本地改了没重发就抓）',
    mism.length === 0,
    mism.length === 0 ? `比了 ${FRONTEND_FILES.length} 个文件，逐个字节数一致` : mism.join('；')
  );
}

// ---------- 板块 C · 发布配置自洽 ----------

function boardC() {
  // C1：.gitignore 挡住了该挡的
  const need = ['.env', 'dist'];
  const notIgnored = [];
  for (const n of need) {
    try {
      execFileSync(GIT, ['check-ignore', '-q', n], { cwd: PROJECT, stdio: 'ignore' });
    } catch (e) {
      notIgnored.push(n);
    }
  }
  record(
    'C', 'C1', '.gitignore 挡住了该挡的（.env、dist/）',
    notIgnored.length === 0,
    notIgnored.length === 0 ? '实测 .env 与 dist/ 均被忽略（git check-ignore 通过）' : '没被忽略：' + notIgnored.join(', ')
  );

  // C2：路由契约（api-contract.md 的「路由表」）与部署配置（cloudbaserc.json gateway.routes）互相覆盖
  //
  // 只从契约里那几行**路由表**取（形如 "| GET /api/habits | ... |"），
  // 不去正文里瞎抓 —— 否则会把示例 id（h_xxx）、curl 例子里的地址全当成路由（第一版就这么错的）。
  // 比较时把 `/api/health` 与 `/api-health` 这种「斜杠 vs 连字符」的写法差异归一化掉，
  // 因为那属于命名风格、不是漏挂了路由；真正要抓的是「某条路由只在一边存在」。
  const contract = readIfExists(path.join(PROJECT, 'api-contract.md'));
  const rc = readIfExists(path.join(PROJECT, 'cloudbaserc.json'));
  let routes = [];
  let cfgErr = '';
  try { routes = (JSON.parse(rc).gateway.routes || []).map((r) => r.path); } catch (e) { cfgErr = e.message; }

  const norm = (p) =>
    String(p)
      .replace(/\/(<[^>]+>|\{[^}]+\}|:[A-Za-z0-9_]+).*$/, '') // /api/habits/<id> → /api/habits
      .replace(/[^A-Za-z0-9]/g, '')
      .toLowerCase();

  const contractPaths = [];
  if (contract) {
    const re = /^\|\s*[^A-Za-z]*(GET|POST|PATCH|DELETE|PUT)\s+(\/api[^\s|*`]*)/gim;
    let m;
    const seen = new Set();
    while ((m = re.exec(contract))) {
      const base = m[2]
        .replace(/[.,;:）)】\]]+$/, '')
        .replace(/(<[^>]+>|\{[^}]+\}|:[A-Za-z0-9_]+).*$/, '')
        .replace(/\/+$/, '');
      if (!seen.has(base)) { seen.add(base); contractPaths.push(base); }
    }
  }

  const cfgSet = new Set(routes.map(norm));
  const conSet = new Set(contractPaths.map(norm));
  const missingInConfig = contractPaths.filter((p) => !cfgSet.has(norm(p)));
  const missingInContract = routes.filter((p) => !conSet.has(norm(p)));
  const ok = !cfgErr && contractPaths.length > 0 && routes.length > 0 && missingInConfig.length === 0 && missingInContract.length === 0;
  record(
    'C', 'C2', '路由契约与部署配置一致（api-contract.md 路由表 ↔ cloudbaserc.json）',
    ok,
    cfgErr
      ? '读 cloudbaserc.json 失败：' + cfgErr
      : ok
        ? `契约 ${contractPaths.length} 条 [${contractPaths.join(', ')}] ↔ 部署配置 ${routes.length} 条 [${routes.join(', ')}]，对得上`
        : `契约里但配置里没有：[${missingInConfig.join(', ')}]；配置里但契约里没有：[${missingInContract.join(', ')}]`
  );
}

// ---------- 主流程 ----------

(async function main() {
  console.log('===================================================');
  console.log(' 发布前检查 preflight-check');
  console.log(' 项目：' + PROJECT);
  console.log(' 静态站：' + STATIC_URL);
  console.log(' 接口：' + API_URL);
  console.log(' 时间：' + new Date().toISOString());
  console.log('===================================================');
  console.log('');

  console.log('— 板块 A · 密钥别泄漏 —');
  boardA();
  console.log('');
  console.log('— 板块 B · 公网能打开且是最新 —');
  await boardB();
  console.log('');
  console.log('— 板块 C · 发布配置自洽 —');
  boardC();

  const failed = results.filter((r) => !r.ok);
  console.log('');
  console.log('===================================================');
  console.log(` 合计 ${results.length} 项：PASS ${results.length - failed.length} / FAIL ${failed.length}`);
  if (failed.length) {
    console.log('---------------------------------------------------');
    console.log(' 未通过明细：');
    for (const f of failed) console.log(`  ✗ ${f.id}  ${f.name}  ——  ${f.extra}`);
  }
  console.log('===================================================');

  const out = {
    when: new Date().toISOString(),
    project: PROJECT,
    staticUrl: STATIC_URL,
    apiUrl: API_URL,
    total: results.length,
    passed: results.length - failed.length,
    failed: failed.length,
    failedItems: failed.map((f) => f.id),
    results,
  };
  try {
    fs.writeFileSync(path.join(HERE, 'last-run.json'), JSON.stringify(out, null, 2));
  } catch (e) {
    console.error('（写 last-run.json 失败：' + e.message + '）');
  }

  process.exit(failed.length ? 1 : 0);
})().catch((e) => {
  console.error('脚本自身出错：', e);
  process.exit(2);
});
