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
 *
 * ── Day 22 加了什么 ──────────────────────────────────────────────────────────
 *   加了三件「改」和「删」要用的活，外加一处过滤：
 *     · findHabitById(id)        按 id 查一条（删之前先确认它在不在）
 *     · updateHabit(id, patch)   改一条（只改传进来的列）
 *     · deleteHabit(id, hard)    删一条：默认**软删除**（打标记），hard=true 才真删
 *     · listHabits / findHabitByName 都加了一句 is_deleted=is.false ——
 *       **被软删的记录从此在「读」这一层就看不见了**，上层一行都不用改。
 *   ⚠️ 这一层仍然不认识用户、不认识网页：它不知道「404 该回给谁」，
 *      只负责「把这条标记成已删」并原样把结果交回去。
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
 * 往 PostgREST 发一个「带 body 的写请求」（POST / PATCH / DELETE 共用这一段）。
 * **故意不抛异常** —— 把状态码和原文原样带回去，让调用方决定怎么翻译成给用户看的话
 * （重复提交返回 409、删除目标不存在返回 0 行，都不是「错误」，是要好好解释的正常结果）。
 * 返回 { status, text }。
 *
 * ⚠️ Day 22 把原来只认 POST 的 post() 泛化成这个 send()：三种方法除了 method 和要不要 body，
 *    其余（鉴权头、prefer、读原文）一模一样 —— 与其抄三遍，不如留一份。
 */
async function send(method, path, row, prefer) {
  const key = requireKey();
  const headers = {
    authorization: 'Bearer ' + key,
    accept: 'application/json',
  };
  const opts = { method: method, headers: headers };
  if (row !== undefined && row !== null) {
    headers['content-type'] = 'application/json';
    opts.body = JSON.stringify(row);
  }
  // 让 PostgREST 把「动过的那一行」回给我们（新增/修改/删除都省掉一次再查）
  if (prefer) headers.prefer = prefer;
  const res = await fetch(REST_BASE + path, opts);
  const text = await res.text();
  return { status: res.status, text: text };
}

/** 往表里插一行（原 post，Day 22 改成调用 send） */
async function post(path, row) {
  return send('POST', path, row, 'return=representation');
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
 *
 * ★ Day 22：只读**没被软删的**（is_deleted = false）★
 *   软删除那批记录还在表里（能找回），但从这一刻起「读」这一层就不会再看见它们了 ——
 *   上层（接口层）一个字都不用改，就实现了「删掉 = 列表里消失」。
 * @param {number|null} limit 最多几条；null = 不限制
 */
async function listHabits(limit) {
  const query =
    '/habits?select=id,name,freq_type,freq_count,created_at&is_deleted=is.false' +
    '&order=created_at.asc,id.asc' +
    (limit ? '&limit=' + limit : '');
  return get(query);
}

/**
 * 读出打卡记录（habit_records 表）。接口层拿它聚合成 doneDates 数组。
 * ★ Day 22：加了可选参数 habitId —— 只读某一个习惯的（改/删完回显 doneDates 时用）。
 *    不传 = 读全部（Day 17 起的老用法，行为没变）。
 */
async function listHabitRecords(habitId) {
  let query = '/habit_records?select=habit_id,done_date';
  if (habitId) query += '&habit_id=eq.' + encodeURIComponent(habitId);
  return get(query + '&order=done_date.desc');
}

/**
 * 有没有叫这个名字的习惯？（防重复提交的第一层：为了把话说好听）
 * 只取 id 一列、最多一条 —— 够判断，不多搬数据。
 * ★ Day 22：同样跳过软删的 —— 否则「删掉『喝水』后再建一个『喝水』」会被误判成重名。
 * 返回 { id } 那一行，或者 null。
 */
async function findHabitByName(name) {
  const rows = await get(
    '/habits?select=id&name=eq.' + encodeURIComponent(name) + '&is_deleted=is.false&limit=1'
  );
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

/* ==========================================================================
   Day 22 新增：按 id 找 / 改一条 / 删一条
   ========================================================================== */

/**
 * 按 id 查一条习惯（含 is_deleted 这一列，让接口层能分辨「不存在」和「已删」）。
 * 返回那一行，或者 null。
 *
 * ⚠️ 这里**故意不过滤 is_deleted** —— 因为「删之前先确认它在不在」这一步，
 *    需要知道「它是真的不在，还是已经被删过了」，两种情况的回话不一样。
 *    要区分「对外可见的列表」和「表里到底有没有」，这是两个问题。
 */
async function findHabitById(id) {
  const rows = await get(
    '/habits?select=id,name,freq_type,freq_count,created_at,is_deleted&id=eq.' +
      encodeURIComponent(id) +
      '&limit=1'
  );
  return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
}

/**
 * 改一条习惯（部分更新）：只把 patch 里带的列写进去。
 * id 由接口层放进路径，这里按 id 定位。
 * 返回 { status, text } —— 成功时 text 是**改完的那一行**（JSON 数组）。
 */
async function updateHabit(id, patch) {
  return send('PATCH', '/habits?id=eq.' + encodeURIComponent(id), patch, 'return=representation');
}

/**
 * 删一条习惯。
 *   hard = false（默认）→ **软删除**：只把 is_deleted 置 true，数据还在，能找回
 *   hard = true         → **真删**：真的 DELETE 掉这一行
 *      ⚠️ habit_records 上那条外键是 ON DELETE CASCADE —— 真删一个习惯，
 *         它的全部打卡记录会**一起消失**，且不可恢复。这正是「删除比新增危险」的地方。
 * 返回 { status, text }。
 */
async function deleteHabit(id, hard) {
  const where = '/habits?id=eq.' + encodeURIComponent(id);
  if (hard) return send('DELETE', where, null, 'return=representation');
  return send('PATCH', where, { is_deleted: true }, 'return=representation');
}

/** 把一条软删掉的记录找回来（is_deleted 置回 false）——「删错了还能找回」就靠它 */
async function restoreHabit(id) {
  return send('PATCH', '/habits?id=eq.' + encodeURIComponent(id), { is_deleted: false }, 'return=representation');
}

module.exports = {
  listHabits: listHabits,
  listHabitRecords: listHabitRecords,
  findHabitByName: findHabitByName,
  insertHabit: insertHabit,
  findHabitById: findHabitById,
  updateHabit: updateHabit,
  deleteHabit: deleteHabit,
  restoreHabit: restoreHabit,
};
