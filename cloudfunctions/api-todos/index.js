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
 */

const ENV_ID = process.env.TCB_ENV || process.env.SCF_NAMESPACE || 'unknown';
const PG_API_KEY = process.env.PG_API_KEY || '';

const SERVICE = 'habit-board-api';
const FUNC_NAME = 'api-todos';
const CONTRACT_VERSION = 'v1.1';

const REST_BASE = 'https://' + ENV_ID + '.api.tcloudbasegateway.com/v1/rdb/rest';

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

async function restGet(pathAndQuery) {
  if (!PG_API_KEY) {
    throw new Error('云函数没配环境变量 PG_API_KEY（数据库连接用的服务端密钥）');
  }
  const res = await fetch(REST_BASE + pathAndQuery, {
    headers: {
      authorization: 'Bearer ' + PG_API_KEY,
      accept: 'application/json',
    },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error('数据库返回 ' + res.status + '：' + String(text).slice(0, 300));
  }
  return JSON.parse(text);
}

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
  const method = String((event && (event.httpMethod || event.http_method)) || 'GET').toUpperCase();

  if (method === 'OPTIONS') return reply(204, null);
  if (method !== 'GET') return fail(405, 'method_not_allowed', '这个接口只接受 GET');

  try {
    const q = query(event);
    const date = parseDate(q.date);
    const limit = parseLimit(q.limit);

    let path = '/todos?select=id,text,todo_date,done&order=todo_date.desc,id.asc';
    if (date) path += '&todo_date=eq.' + date;
    if (limit) path += '&limit=' + limit;

    const rows = await restGet(path);

    const data = rows.map(function (t) {
      return {
        id: t.id,
        text: t.text,
        date: t.todo_date, // 改名：库里 todo_date → 前端要的 date
        done: t.done,
      };
    });

    return reply(200, {
      ok: true,
      service: SERVICE,
      function: FUNC_NAME,
      version: CONTRACT_VERSION,
      envId: ENV_ID,
      count: data.length,
      date: date, // null 表示「没有按日期筛，返回的是全部」
      generatedAt: new Date().toISOString(),
      data: data,
    });
  } catch (e) {
    return fail(500, 'server_error', '读取待办失败：' + ((e && e.message) || String(e)));
  }
};
