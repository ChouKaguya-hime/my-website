'use strict';

/**
 * api-habits —— 读接口：GET /api/habits（Day 17）
 *
 * 它做什么
 *   把 CloudBase PostgreSQL 里 habits 表 + habit_records 表的数据，
 *   按 api-contract.md 第 4 节的约定，整理成一份 JSON 返回给前端。
 *
 * 为什么写成一个「翻译层」，而不是直接把库里的行丢出去
 *   因为库里的形状和前端要的形状**有两处对不上**（这就是 Day 17 清单上那个问题）：
 *     1. 命名对不上：库里是 snake_case（freq_type / created_at），契约第 4.2 节要 camelCase（freqType / createdAt）
 *     2. 形状对不上：库里「哪天完成」是 habit_records 里的一行行记录，
 *        而前端要的是一个数组 habit.doneDates = ['2026-10-04', ...]
 *   所以这个函数干的活就是：改名 + 把多行聚合成数组。前端拿到的，和它一直用的本地数据同形状。
 *
 * 为什么不用 CloudBase SDK 直连数据库
 *   CloudBase PG 有三条路：小程序 SDK / HTTP API(PostgREST) / PostgreSQL 协议直连。
 *   实测（Day 17）：体验版环境下「直连」走不通；HTTP API 这条路最稳，
 *   而且用 Node 自带的能力就够了 —— 这个函数零依赖。
 *   详见 api-contract.md 第 3.6 节。
 *
 * 连接方式：HTTP API + 环境变量里的服务端 API Key
 *   PG_API_KEY 写在云函数的「环境变量」里，不进代码、不进 Git。
 */

const ENV_ID = process.env.TCB_ENV || process.env.SCF_NAMESPACE || 'unknown';
const PG_API_KEY = process.env.PG_API_KEY || '';

const SERVICE = 'habit-board-api';
const FUNC_NAME = 'api-habits';
const CONTRACT_VERSION = 'v1.1';

// CloudBase PG 的 HTTP API（PostgREST）入口
const REST_BASE = 'https://' + ENV_ID + '.api.tcloudbasegateway.com/v1/rdb/rest';

// 返回条数上限：防着有人拿 ?limit=999999 来打
const LIMIT_MIN = 1;
const LIMIT_MAX = 200;

/**
 * 统一出口：状态码 / 响应头 / JSON 体
 *
 * 跨域（CORS）从今天（Day 17）开始配 —— 因为今天起页面要 fetch 这个接口了。
 * 页面地址是 xxx.tcloudbaseapp.com，接口地址是 xxx.app.tcloudbase.com，
 * 两个域名不同源，不配跨域浏览器会直接拦掉请求。
 */
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

/** 问 PostgREST 要一段数据；非 2xx 就把原文带出来，方便排查 */
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

/** 只接受 1..200 的整数；没传就返回 null（表示「不限制」） */
function parseLimit(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  const i = Math.floor(n);
  if (i < LIMIT_MIN) return LIMIT_MIN;
  if (i > LIMIT_MAX) return LIMIT_MAX;
  return i;
}

/** 从 event 里取查询参数（HTTP 访问服务会放在 queryStringParameters） */
function query(event) {
  return (event && (event.queryStringParameters || event.queryString)) || {};
}

exports.main = async (event, context) => {
  const method = String((event && (event.httpMethod || event.http_method)) || 'GET').toUpperCase();

  // 预检请求（跨域带自定义头时会先发 OPTIONS）——不需要 body
  if (method === 'OPTIONS') return reply(204, null);
  if (method !== 'GET') return fail(405, 'method_not_allowed', '这个接口只接受 GET');

  try {
    const limit = parseLimit(query(event).limit);

    const habitQuery =
      '/habits?select=id,name,freq_type,freq_count,created_at&order=created_at.asc,id.asc' +
      (limit ? '&limit=' + limit : '');
    const recordQuery = '/habit_records?select=habit_id,done_date&order=done_date.desc';

    const habits = await restGet(habitQuery);
    const records = await restGet(recordQuery);

    // 把「一行一次打卡」聚合成前端要的 doneDates 数组（形状对不上的那一处）
    const datesByHabit = {};
    for (const r of records) {
      if (!datesByHabit[r.habit_id]) datesByHabit[r.habit_id] = [];
      datesByHabit[r.habit_id].push(r.done_date);
    }

    // 改名（命名对不上的那一处）
    const data = habits.map(function (h) {
      return {
        id: h.id,
        name: h.name,
        freqType: h.freq_type,
        freqCount: h.freq_count,
        createdAt: h.created_at,
        doneDates: datesByHabit[h.id] || [],
      };
    });

    return reply(200, {
      ok: true,
      service: SERVICE,
      function: FUNC_NAME,
      version: CONTRACT_VERSION,
      envId: ENV_ID,
      count: data.length,
      generatedAt: new Date().toISOString(),
      data: data,
    });
  } catch (e) {
    return fail(500, 'server_error', '读取习惯失败：' + ((e && e.message) || String(e)));
  }
};
