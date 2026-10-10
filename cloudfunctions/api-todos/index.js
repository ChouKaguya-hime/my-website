'use strict';

/**
 * api-todos —— 读接口：GET /api/todos（Day 17）
 *
 * 它做什么
 *   把 CloudBase PostgreSQL 里 todos 表的数据，按 api-contract.md 第 4 节的约定返回。
 *
 * 和 api-habits 一样，这里也有一处「对不上」要翻译：
 *   库里列名是 todo_date，而前端（app.js / dashboard.js 一直用的那份数据）字段叫 date。
 *   → 接口层负责改名，前端一行都不用动。
 *
 * 支持的查询参数（今天顺手加的「余力加练」，也是 §3.3 的简单筛选）
 *   ?date=YYYY-MM-DD   只要这一天的待办（不传 = 全部）
 *   ?limit=N           最多返回 N 条（1..200）
 *
 * 连接方式、跨域、错误形状都和 api-habits 一致，见那个文件顶部的注释。
 *
 * ── Day 19：拆出数据访问层 ─────────────────────────────────────────────────────
 *   原来「拼查询地址 + 发请求 + 读密钥」就写在下面（restGet + REST_BASE + PG_API_KEY）。
 *   今天整段搬进了**同目录的 db.js**。本文件往后只跟数据层说业务问句：
 *     db.listTodos({ date, limit })  ← 要哪天的、要几条
 *   判据：**改完以后，本文件里搜不到 fetch、搜不到表名、搜不到 /rest。**
 */

const ENV_ID = process.env.TCB_ENV || process.env.SCF_NAMESPACE || 'unknown';

const SERVICE = 'habit-board-api';
const FUNC_NAME = 'api-todos';
// ⚠️ Day 19 只重构了内部实现，**接口契约一个字没动** —— 所以版本号不升，还是 v1.1。
const CONTRACT_VERSION = 'v1.1';

/**
 * ★ Day 23：三类错误提示统一（① 400 参数错 ② 404 找不到 ③ 500 服务端错）——
 * 这条规矩和 api-habits 用的是**同一套口径**：给用户看的 `message` 一律中文人话；
 * 原始报错（数据库原文 / 异常信息）只进**服务端日志**，不放响应体。
 *   改前：'读取待办失败：' + e.message   ← 用户看到一长串英文 / 内部报错
 *   改后：MSG.serverRead                 ← 一句中文，还说明了「不是你操作的问题」
 */
const MSG = {
  serverRead: '服务器暂时出了点问题，读取没成功，请过一会儿再试（不是你操作的问题）',
};

/**
 * ★ Day 23（余力加练）：一条请求日志 —— 时间 / 函数 / 方法 / 路径 / 结果 / 耗时。
 * 为什么要它：500 的响应体已经只说人话，原始报错只能靠这条日志找回（配 requestId 搜）。
 * 日志本身绝不能影响接口：出任何问题都吞掉。
 */
function logRequest(entry) {
  try {
    console.log(
      JSON.stringify(
        Object.assign(
          {
            at: new Date().toISOString(),
            service: SERVICE,
            function: FUNC_NAME,
            version: CONTRACT_VERSION,
          },
          entry
        )
      )
    );
  } catch (e) {
    /* 打不出日志也不能让接口挂掉 */
  }
}

// ★ 数据访问层（Day 19 从本文件拆出去的）：查数据库的活全在 db.js 里。
const db = require('./db');

const LIMIT_MIN = 1;
const LIMIT_MAX = 200;

function reply(statusCode, payload) {
  return {
    statusCode,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, OPTIONS',
      'access-control-allow-headers': 'content-type',
      'access-control-max-age': '86400',
    },
    body: payload === null ? '' : JSON.stringify(payload),
  };
}

function fail(statusCode, error, message) {
  return reply(statusCode, {
    ok: false,
    service: SERVICE,
    function: FUNC_NAME,
    version: CONTRACT_VERSION,
    error: error,
    message: message,
  });
}

/* ★ Day 19：原来这里躺着 restGet（问 PostgREST 要一段数据），
   连同 REST_BASE、PG_API_KEY 一起搬到了同目录的 db.js。
   本文件往后不再直接跟数据库说话 —— 要数据就找 db。 */

function parseLimit(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  const i = Math.floor(n);
  if (i < LIMIT_MIN) return LIMIT_MIN;
  if (i > LIMIT_MAX) return LIMIT_MAX;
  return i;
}

/** 只放行 YYYY-MM-DD 且是真实存在的日期；不合法就当没传（宁可返回全部，也不要 500） */
function parseDate(raw) {
  if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const d = new Date(raw + 'T00:00:00Z');
  if (Number.isNaN(d.getTime())) return null;
  if (d.toISOString().slice(0, 10) !== raw) return null;
  return raw;
}

function query(event) {
  return (event && (event.queryStringParameters || event.queryString)) || {};
}

exports.main = async (event, context) => {
  const t0 = Date.now();
  const method = String((event && (event.httpMethod || event.http_method)) || 'GET').toUpperCase();
  const path = (event && (event.path || event.rawPath)) || '';

  /** ★ Day 23（余力加练）：每条出口都留一行日志（打日志 + 返回，一次搞定） */
  function done(res, extra) {
    logRequest(
      Object.assign(
        {
          method: method,
          path: path,
          status: res.statusCode,
          ms: Date.now() - t0,
        },
        extra || {}
      )
    );
    return res;
  }

  if (method === 'OPTIONS') return done(reply(204, null), { outcome: 'preflight' });
  if (method !== 'GET') {
    return done(fail(405, 'method_not_allowed', '这个接口只接受 GET'), { outcome: 'method_not_allowed' });
  }

  try {
    const q = query(event);
    const date = parseDate(q.date);
    const limit = parseLimit(q.limit);

    // ★ Day 19：查询地址原来在这里一行行拼；现在只对数据层说「要哪天的、要几条」
    const rows = await db.listTodos({ date: date, limit: limit });

    const data = rows.map(function (t) {
      return {
        id: t.id,
        text: t.text,
        date: t.todo_date, // 改名：库里 todo_date → 前端要的 date
        done: t.done,
      };
    });

    return done(
      reply(200, {
        ok: true,
        service: SERVICE,
        function: FUNC_NAME,
        version: CONTRACT_VERSION,
        envId: ENV_ID,
        count: data.length,
        date: date, // null 表示「没有按日期筛，返回的是全部」
        generatedAt: new Date().toISOString(),
        data: data,
      }),
      { outcome: 'read_ok', count: data.length }
    );
  } catch (e) {
    // ★ Day 23：只说人话 —— 原始报错进日志（done 的 extra.error），不进响应体
    return done(fail(500, 'server_error', MSG.serverRead), {
      outcome: 'read_failed',
      error: (e && e.message) || String(e),
    });
  }
};
