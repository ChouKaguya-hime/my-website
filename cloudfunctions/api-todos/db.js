'use strict';

/**
 * db.js —— 数据访问层（Day 19 从 index.js 里拆出来的）
 *
 * 和 api-habits/db.js 是同一个角色，只是管的是 todos 表。
 *
 * ── 「查数据库」这段代码从哪移到了哪 ──────────────────────────────────────────
 *   拆之前：写在 cloudfunctions/api-todos/index.js 里（拼查询地址 + 发请求 + 读密钥）。
 *   拆之后：搬进**本文件**。index.js 里再搜不到 fetch、搜不到表名、搜不到 /rest。
 *
 * ── 这一层的边界（和 habits 那份完全一样）─────────────────────────────────────
 *   管：表/列叫什么、查询怎么拼、请求怎么发、结果怎么读回来。
 *   不管：HTTP 状态码、跨域头、参数合不合法、给用户看的中文提示 —— 都是接口层的事。
 *
 * ── 关于「两个云函数各有一份 db.js」────────────────────────────────────────────
 *   这是**云函数的打包规则**逼出来的：CloudBase 部署时按函数目录各自打包，
 *   api-todos 打进去的只有它自己目录里的文件，读不到 api-habits 目录里的东西。
 *   ⚠️ 所以两份 db.js 里那段「连接 + 发请求」目前是**一样的代码** —— 这是个已知的取舍：
 *     换来的是「不用构建步骤、部署就能用」。
 *   等函数多起来（第 4 周以后）再上「共享源文件 + 部署前同步」也不迟，
 *   今天按下这条：**先把层拆干净，不顺手改部署方式**。
 */

// ---------- 连接信息（只在这里读一次）----------
const ENV_ID = process.env.TCB_ENV || process.env.SCF_NAMESPACE || 'unknown';
const PG_API_KEY = process.env.PG_API_KEY || '';

const REST_BASE = 'https://' + ENV_ID + '.api.tcloudbasegateway.com/v1/rdb/rest';

/** 每次请求前确认密钥在；没有就直接抛（配置错了不该悄悄放过） */
function requireKey() {
  if (!PG_API_KEY) {
    throw new Error('云函数没配环境变量 PG_API_KEY（数据库连接用的服务端密钥）');
  }
  return PG_API_KEY;
}

/**
 * 问 PostgREST 要一段数据；非 2xx 就把原文带出来，方便排查。
 * （原 index.js 里的 restGet，原样搬过来。）
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
 * 读出待办列表（todos 表）。
 * @param {object} filters = { date: 'YYYY-MM-DD'|null, limit: number|null }
 *   date  只要这一天的（null = 全部）
 *   limit 最多几条（null = 不限制）
 * 返回库里的原样行（列名 snake_case，含 todo_date）—— 改名是接口层的事。
 */
async function listTodos(filters) {
  const f = filters || {};
  let query = '/todos?select=id,text,todo_date,done&order=todo_date.desc,id.asc';
  if (f.date) query += '&todo_date=eq.' + f.date;
  if (f.limit) query += '&limit=' + f.limit;
  return get(query);
}

module.exports = {
  listTodos: listTodos,
};
