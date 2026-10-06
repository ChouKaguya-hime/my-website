'use strict';

/**
 * db.js —— 数据访问层（Day 19 从 index.js 里拆出来的）
 *
 * ── 「查数据库」这段代码从哪移到了哪 ──────────────────────────────────────────
 *   拆之前：它写在 cloudfunctions/api-habits/index.js 里，和 HTTP 的活混在一起
 *           （读密钥、拼查询地址、发请求、解析结果，散了五十多行，中间夹着状态码和跨域头）。
 *   拆之后：全部搬进**本文件**。现在 index.js 里**搜不到 fetch、搜不到表名、搜不到 /rest**。
 *
 * ── 这一层管什么 ──────────────────────────────────────────────────────────────
 *   只管「数据怎么进出数据库」：
 *     · 表叫什么、列叫什么
 *     · 「要查什么」怎么拼成数据库听得懂的一串地址
 *     · 请求怎么发、结果怎么读回来
 *
 * ── 这一层**不管**什么（都不属于它的职责）──────────────────────────────────────
 *   · HTTP 状态码 / 跨域头 / 请求方法 —— 那是**接口层**（index.js）的事
 *   · 「重名不许再存」这种业务规矩 —— 那是**业务规则**的事
 *   · 给用户看的中文提示 —— 那是**接口层**翻译出来的
 *   一句话：这一层**不认识用户，也不认识网页**，只认识库。
 *
 * ── 为什么值得这么拆 ──────────────────────────────────────────────────────────
 *   以后要换数据库（PostgREST → 别的），或者某个查询要改（多加一列、换个排序），
 *   **只动这个文件**，接口层的路由、校验、报错文案一行都不用碰。
 *
 * ── 连接方式 ──────────────────────────────────────────────────────────────────
 *   CloudBase PG 的 HTTP API（PostgREST）。密钥从**环境变量 PG_API_KEY** 读，
 *   不进代码、不进 Git。为什么走这条路（体验版下直连走不通）见 api-contract.md 第 3.6 节。
 */

// ---------- 连接信息（只在这里读一次）----------
const ENV_ID = process.env.TCB_ENV || process.env.SCF_NAMESPACE || 'unknown';
const PG_API_KEY = process.env.PG_API_KEY || '';

// CloudBase PG 的 HTTP API（PostgREST）入口
const REST_BASE = 'https://' + ENV_ID + '.api.tcloudbasegateway.com/v1/rdb/rest';

/** 每次请求前确认密钥在；没有就直接抛（这属于部署配错了，不该悄悄放过） */
function requireKey() {
  if (!PG_API_KEY) {
    throw new Error('云函数没配环境变量 PG_API_KEY（数据库连接用的服务端密钥）');
  }
  return PG_API_KEY;
}

/* ==========================================================================
   内部零件：这两个函数才是「本来的那五十多行」——
   它们以前叫 restGet / restPost，住在 index.js 里，现在搬到了这里。
   注意它们**不返回 HTTP 状态码给用户看**，状态码是接口层的事。
   ========================================================================== */

/**
 * 问 PostgREST 要一段数据；非 2xx 就把原文带出来，方便排查。
 * 查不到东西不是错（返回空数组），所以这里只把「真出错」当异常抛。
 */
async function get(pathAndQuery) {
  const key = requireKey();
  const res = await fetch(REST_BASE + pathAndQuery, {
    headers: {
      authorization: 'Bearer ' + key,
      accept: 'application/json',
    },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error('数据库返回 ' + res.status + '：' + String(text).slice(0, 300));
  }
  return JSON.parse(text);
}

/**
 * 往表里插一行。
 * **故意不抛异常** —— 把状态码和原文原样带回去，让调用方决定怎么翻译成给用户看的话
 * （重复提交会返回 409，那不是一个「错误」，是一个要好好解释的正常结果）。
 * 返回 { status, text }。
 */
async function post(path, row) {
  const key = requireKey();
  const res = await fetch(REST_BASE + path, {
    method: 'POST',
    headers: {
      authorization: 'Bearer ' + key,
      'content-type': 'application/json',
      accept: 'application/json',
      // 让 PostgREST 把插进去的那一行回给我们（省掉一次再查）
      prefer: 'return=representation',
    },
    body: JSON.stringify(row),
  });
  const text = await res.text();
  return { status: res.status, text: text };
}

/* ==========================================================================
   对外出口：全是「业务问句」，不是「HTTP 动作」——
   上层的 index.js 只会说「给我习惯列表」「有没有叫这个名字的」，
   不会说「给我 /habits?select=...」。这就是这一层的边界。
   ========================================================================== */

/**
 * 读出习惯列表（habits 表）。
 * 返回的是**库里的原样行**（列名还是 snake_case）——
 * 改名和聚合是接口层的事（那属于「把库的形状翻译成契约的形状」）。
 * @param {number|null} limit 最多几条；null = 不限制
 */
async function listHabits(limit) {
  const query =
    '/habits?select=id,name,freq_type,freq_count,created_at&order=created_at.asc,id.asc' +
    (limit ? '&limit=' + limit : '');
  return get(query);
}

/** 读出全部打卡记录（habit_records 表）。接口层拿它聚合成 doneDates 数组。 */
async function listHabitRecords() {
  return get('/habit_records?select=habit_id,done_date&order=done_date.desc');
}

/**
 * 有没有叫这个名字的习惯？（防重复提交的第一层：为了把话说好听）
 * 只取 id 一列、最多一条 —— 够判断，不多搬数据。
 * 返回 { id } 那一行，或者 null。
 */
async function findHabitByName(name) {
  const rows = await get('/habits?select=id&name=eq.' + encodeURIComponent(name) + '&limit=1');
  return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
}

/**
 * 插入一个习惯。
 * 入参已经是**库里的列名**（snake_case）—— 由接口层翻译好再交过来。
 * 返回 { status, text }，由接口层判断「成功 / 重名 / 别的错」。
 */
async function insertHabit(row) {
  return post('/habits', row);
}

module.exports = {
  listHabits: listHabits,
  listHabitRecords: listHabitRecords,
  findHabitByName: findHabitByName,
  insertHabit: insertHabit,
};
