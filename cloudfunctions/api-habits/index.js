'use strict';

/**
 * api-habits —— 习惯接口：读 GET（Day 17）+ 写 POST（Day 18）
 *
 * 它做什么
 *   GET  /api/habits   把 habits + habit_records 读出来，整理成契约要的形状返回
 *   POST /api/habits   新建一个习惯，写进 habits 表，把新建好的那一条原样返回
 *
 * ── 为什么读和写挤在同一个函数里 ───────────────────────────────────────────────
 *   接口契约第 4.1 节定的规矩：「地址里不写动词，动作交给 HTTP 方法」。
 *   所以读和写是**同一个地址** /api/habits，靠 GET / POST 区分 ——
 *   地址只有一个，就只能挂在一个云函数上。
 *
 * ── 为什么写成一个「翻译层」，而不是直接把库里的行丢出去 ────────────────────────
 *   因为库里的形状和前端要的形状有两处对不上（Day 17 清单上那个问题）：
 *     1. 命名对不上：库里 snake_case（freq_type / created_at），契约 4.2 节要 camelCase
 *     2. 形状对不上：库里「哪天完成」是 habit_records 里一行行记录，前端要 doneDates 数组
 *   这个函数干的活就是改名 + 聚合。前端拿到的，和它一直用的本地数据同形状。
 *
 * ── 今天（Day 18）新加的：写入时防的两种东西 ────────────────────────────────────
 *   ★ 防重复提交：同一个名字的习惯只能有一条 ★
 *       「双击保存」和「网络重试」会发出两次一模一样的请求。这里挡它有两层：
 *         第一层（好话）：插入前先查一眼重名 → 409 + 「已经有一个叫「X」的习惯了」
 *         第二层（兜底）：数据库上的唯一索引 ux_habits_name —— 两个请求同时到达时，
 *                        第一层的「先查后插」会双双漏过，最后由数据库拒掉第二条。
 *                        这一层才是真的防住了；第一层只负责把话说好听。
 *       为什么两层都要：只有第一层 → 并发下漏；只有第二层 → 前端只能收到一句数据库报错。
 *   ★ 防错误输入：缺 name / 名字是空白 / 类型或次数不合法 → 400 + 中文说清哪一项不对
 *
 * ── Day 19：这个文件变矮了（拆出数据访问层）────────────────────────────────────
 *   以前「查数据库」的代码（读密钥、拼查询地址、发请求、解析结果）就写在本文件里，
 *   和 HTTP 的活混在一起 —— 一个文件里同时有「怎么回 HTTP」和「怎么问数据库」两件事。
 *   今天把那一整段搬进了**同目录的 db.js**（数据访问层）。
 *     拆之前：本文件里躺着一组 restGet / restPost / REST_BASE / PG_API_KEY，外加两条查询地址
 *     拆之后：那些都在 db.js；本文件只调用 db.listHabits() / db.findHabitByName() / db.insertHabit()
 *   判据很简单：**改完以后，本文件里搜不到 fetch、搜不到表名、搜不到 /rest。**
 *   为什么值得：以后换数据库、或某个查询要改，只动 db.js ——
 *   这边的路由、校验、报错文案一行都不用碰。
 *
 * ── 为什么不用 CloudBase SDK 直连数据库 ────────────────────────────────────────
 *   CloudBase PG 有三条路：小程序 SDK / HTTP API(PostgREST) / PostgreSQL 协议直连。
 *   实测（Day 17）：体验版环境下「直连」走不通；HTTP API 这条路最稳，
 *   而且用 Node 自带的能力就够了 —— 这个函数零依赖。详见 api-contract.md 第 3.6 节。
 *
 * 连接方式：HTTP API（PostgREST）+ 环境变量里的服务端 API Key
 *   这段连接细节现在住在 db.js 顶部；PG_API_KEY 写在云函数的「环境变量」里，不进代码、不进 Git。
 */

const ENV_ID = process.env.TCB_ENV || process.env.SCF_NAMESPACE || 'unknown';

const SERVICE = 'habit-board-api';
const FUNC_NAME = 'api-habits';
// ⚠️ Day 19 只重构了内部实现，**接口契约一个字没动** —— 所以版本号不升，还是 v1.2。
const CONTRACT_VERSION = 'v1.2'; // Day 18：本函数新增了 POST，契约从 v1.1 升到 v1.2

// ★ 数据访问层（Day 19 从本文件拆出去的）：查数据库的活全在 db.js 里。
const db = require('./db');

// 返回条数上限：防着有人拿 ?limit=999999 来打
const LIMIT_MIN = 1;
const LIMIT_MAX = 200;

// 习惯名称最长多少字（一个汉字算 1 个字符）
const NAME_MAX = 50;

/**
 * 统一出口：状态码 / 响应头 / JSON 体
 *
 * 跨域（CORS）Day 17 起配 —— 页面在 xxx.tcloudbaseapp.com、接口在 xxx.app.tcloudbase.com，
 * 两个域名不同源，不配浏览器会直接拦掉请求。
 * ⚠️ Day 18 加了写接口，allow-methods 必须带上 POST，否则浏览器会在预检那一步就拦下来。
 */
function reply(statusCode, payload, extraHeaders) {
  const headers = {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-max-age': '86400',
  };
  if (extraHeaders) {
    for (const k in extraHeaders) headers[k] = extraHeaders[k];
  }
  return {
    statusCode,
    headers,
    body: payload === null ? '' : JSON.stringify(payload),
  };
}

function fail(statusCode, error, message, extraHeaders) {
  return reply(
    statusCode,
    {
      ok: false,
      service: SERVICE,
      function: FUNC_NAME,
      version: CONTRACT_VERSION,
      error: error,
      message: message,
    },
    extraHeaders
  );
}

/* ★ Day 19：原来这里躺着 restGet / restPost 两个函数（问数据库要一段数据 / 往表里插一行）。
   它们连同 REST_BASE、PG_API_KEY 一起，搬到了同目录的 db.js。
   本文件往后不再直接跟数据库说话 —— 要数据就找 db。 */

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

/**
 * 把请求体（字符串）解析成对象。
 * 返回 { kind: 'empty' | 'bad_json' | 'ok', value }
 *   —— 分开「没带 body」和「body 不是合法 JSON」，因为给用户看的话不一样。
 */
function parseBody(event) {
  const raw = event && event.body;
  if (raw === undefined || raw === null || raw === '') return { kind: 'empty', value: null };

  // 已经是对象了（某些调用方式会替我们解析好）——直接用
  if (typeof raw === 'object') return { kind: 'ok', value: raw };

  let text = raw;
  if (event.isBase64Encoded) {
    text = Buffer.from(String(raw), 'base64').toString('utf8');
  }
  if (typeof text !== 'string' || !text.trim()) return { kind: 'empty', value: null };

  try {
    return { kind: 'ok', value: JSON.parse(text) };
  } catch (e) {
    return { kind: 'bad_json', value: null };
  }
}

/** 库里的行 → 契约要的形状（命名翻译 + doneDates 补空数组） */
function rowToHabit(r) {
  return {
    id: r.id,
    name: r.name,
    freqType: r.freq_type,
    freqCount: r.freq_count,
    createdAt: r.created_at,
    doneDates: [],
  };
}

/** 服务端生成习惯 id：h_ + 时间戳36进制 + 随机串（和前端 newId('h') 同格式） */
function newHabitId() {
  return 'h_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

/**
 * 校验 + 归一化 POST 进来的习惯。
 * 返回 { ok: true, value } 或 { ok: false, message }（message 一律中文，直接能给用户看）
 */
function validateHabitInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, message: '请求体要是一个 JSON 对象，例如 {"name":"每天喝 8 杯水"}' };
  }

  // ---- name：唯一的必填项 ----
  if (input.name === undefined || input.name === null) {
    return { ok: false, message: '缺少必填字段 name（习惯名称）' };
  }
  if (typeof input.name !== 'string') {
    return { ok: false, message: 'name 要是字符串（习惯名称），现在收到的是 ' + typeof input.name };
  }
  const name = input.name.trim();
  if (!name) {
    return { ok: false, message: '习惯名称不能是空的' };
  }
  if (name.length > NAME_MAX) {
    return { ok: false, message: '习惯名称太长了（最多 ' + NAME_MAX + ' 个字，现在 ' + name.length + ' 个）' };
  }

  // ---- freqType：可选，默认 daily ----
  let freqType = 'daily';
  const rawType = input.freqType;
  if (rawType !== undefined && rawType !== null && rawType !== '') {
    if (rawType !== 'daily' && rawType !== 'weekly') {
      return { ok: false, message: 'freqType 只能是 daily（每天）或 weekly（每周 N 次），现在收到的是「' + rawType + '」' };
    }
    freqType = rawType;
  }

  // ---- freqCount：可选，1..7；daily 一律存 7（和表结构、前端默认值一致）----
  let freqCount = 7;
  const rawCount = input.freqCount;
  if (rawCount !== undefined && rawCount !== null && rawCount !== '') {
    const n = Number(rawCount);
    if (!Number.isInteger(n) || n < 1 || n > 7) {
      return { ok: false, message: 'freqCount 只能是 1 到 7 的整数，现在收到的是「' + rawCount + '」' };
    }
    freqCount = n;
  }
  if (freqType === 'daily') freqCount = 7;

  // ---- id：可选；不传就由服务端生成（免得两个客户端撞上同一个 id）----
  let id = null;
  const rawId = input.id;
  if (rawId !== undefined && rawId !== null && rawId !== '') {
    if (typeof rawId !== 'string' || !/^h_[A-Za-z0-9_-]{1,48}$/.test(rawId)) {
      return { ok: false, message: 'id 格式不对：要以 h_ 开头，后面只放字母、数字、下划线或连字符（总共不超过 51 个字符）' };
    }
    id = rawId;
  }
  if (!id) id = newHabitId();

  return { ok: true, value: { id: id, name: name, freqType: freqType, freqCount: freqCount } };
}

/** 契约第 4.2 节：日期只有年月日，不接受「2026-2-3」这种写法 */
function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * 余力加练：一条服务端日志。
 * 每次请求只打一行 JSON —— 以后线上出问题，拿 requestId 去函数日志里搜这一行，
 * 就能知道「谁、什么时候、用什么方法、打了哪个接口、结果是什么、花了多久」。
 * 日志本身绝对不能影响接口：出任何问题都吞掉。
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

/** 从 event / context 里尽力捞一个请求编号（捞不到就给 null，不编假数据） */
function pickRequestId(event, context) {
  return (
    (context && (context.request_id || context.requestId)) ||
    (event && event.requestContext && (event.requestContext.requestId || event.requestContext.request_id)) ||
    (event && event.headers && (event.headers['x-request-id'] || event.headers['X-Request-Id'])) ||
    null
  );
}

exports.main = async (event, context) => {
  const t0 = Date.now();
  const method = String((event && (event.httpMethod || event.http_method)) || 'GET').toUpperCase();
  const requestId = pickRequestId(event, context);

  /** 打日志 + 返回，一次搞定，保证每条出口都留下痕迹 */
  function done(res, extra) {
    logRequest(
      Object.assign(
        {
          requestId: requestId,
          method: method,
          status: res.statusCode,
          ms: Date.now() - t0,
        },
        extra || {}
      )
    );
    return res;
  }

  // 预检请求（跨域带 content-type 时会先发 OPTIONS）—— 不需要 body
  if (method === 'OPTIONS') return done(reply(204, null), { outcome: 'preflight' });

  if (method === 'GET') {
    try {
      const limit = parseLimit(query(event).limit);

      // ★ Day 19：两条查询原来写成两串地址、交给 restGet；现在只对数据层说「要什么」
      const habits = await db.listHabits(limit);
      const records = await db.listHabitRecords();

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

      return done(
        reply(200, {
          ok: true,
          service: SERVICE,
          function: FUNC_NAME,
          version: CONTRACT_VERSION,
          envId: ENV_ID,
          count: data.length,
          generatedAt: new Date().toISOString(),
          data: data,
        }),
        { outcome: 'read_ok', count: data.length }
      );
    } catch (e) {
      return done(fail(500, 'server_error', '读取习惯失败：' + ((e && e.message) || String(e))), {
        outcome: 'read_failed',
        error: (e && e.message) || String(e),
      });
    }
  }

  if (method === 'POST') {
    // ---------- 第 1 步：请求体本身读得出来吗 ----------
    const body = parseBody(event);
    if (body.kind === 'empty') {
      return done(
        fail(400, 'bad_request', '请求体是空的：需要一段 JSON，例如 {"name":"每天喝 8 杯水"}'),
        { outcome: 'bad_request', reason: 'empty_body' }
      );
    }
    if (body.kind === 'bad_json') {
      return done(
        fail(400, 'bad_request', '请求体不是合法的 JSON（大概率是引号或逗号写错了）'),
        { outcome: 'bad_request', reason: 'bad_json' }
      );
    }

    // ---------- 第 2 步：内容对不对（防错误输入）----------
    const checked = validateHabitInput(body.value);
    if (!checked.ok) {
      return done(fail(400, 'bad_request', checked.message), {
        outcome: 'bad_request',
        reason: 'invalid_field',
        message: checked.message,
      });
    }
    const habit = checked.value;

    // ---------- 第 3 步：先查一眼重名（防重复提交的第一层：为了说人话）----------
    try {
      const dup = await db.findHabitByName(habit.name);
      if (dup) {
        return done(
          fail(409, 'conflict', '已经有一个叫「' + habit.name + '」的习惯了，不用再加一遍', {
            allow: 'GET, POST, OPTIONS',
          }),
          { outcome: 'duplicate', layer: 'precheck', name: habit.name }
        );
      }
    } catch (e) {
      // 查重这一步本身失败（比如数据库抽风）不该静默放过 —— 交给下面的插入去兜
      // （数据库上的唯一索引还在，真重了照样插不进去）
    }

    // ---------- 第 4 步：插进去 ----------
    try {
      const res = await db.insertHabit({
        id: habit.id,
        name: habit.name,
        freq_type: habit.freqType,
        freq_count: habit.freqCount,
        created_at: todayStr(),
      });

      const isConflict = res.status === 409 || /23505/.test(res.text);

      // 第二层兜底：并发下两个请求双双过了查重，这里由数据库的唯一索引拒掉第二条
      if (isConflict) {
        const isNameConflict = /ux_habits_name/.test(res.text);
        const message = isNameConflict
          ? '已经有一个叫「' + habit.name + '」的习惯了，不用再加一遍'
          : '这个 id 已经被占用了（「' + habit.id + '」），换一个再试';
        return done(fail(409, 'conflict', message, { allow: 'GET, POST, OPTIONS' }), {
          outcome: 'duplicate',
          layer: 'db_unique',
          name: habit.name,
        });
      }

      if (res.status < 200 || res.status >= 300) {
        return done(
          fail(500, 'server_error', '写入习惯失败：数据库返回 ' + res.status + '：' + String(res.text).slice(0, 300)),
          { outcome: 'write_failed', error: String(res.text).slice(0, 200) }
        );
      }

      // PostgREST 用 return=representation 会把插进去的那一行回给我们；
      // 万一它没回（配置不同），就用我们刚才提交的那份当结果，字段一个不少。
      let created = null;
      try {
        const parsed = JSON.parse(res.text);
        if (Array.isArray(parsed) && parsed.length > 0) created = parsed[0];
      } catch (e) {
        /* 解析不出来就走下面的兜底 */
      }
      const data = created
        ? rowToHabit(created)
        : {
            id: habit.id,
            name: habit.name,
            freqType: habit.freqType,
            freqCount: habit.freqCount,
            createdAt: todayStr(),
            doneDates: [],
          };

      return done(
        reply(201, {
          ok: true,
          service: SERVICE,
          function: FUNC_NAME,
          version: CONTRACT_VERSION,
          envId: ENV_ID,
          generatedAt: new Date().toISOString(),
          data: data,
        }),
        { outcome: 'created', id: data.id, name: data.name }
      );
    } catch (e) {
      return done(
        fail(500, 'server_error', '写入习惯失败：' + ((e && e.message) || String(e))),
        { outcome: 'write_failed', error: (e && e.message) || String(e) }
      );
    }
  }

  // 其余方法（PATCH / DELETE / PUT ...）今天还没做 ——
  // PATCH（改）和 DELETE（删）排在第 4 周，不是忘了。
  return done(
    fail(405, 'method_not_allowed', '这个接口只接受 GET（读）和 POST（新建）', {
      allow: 'GET, POST, OPTIONS',
    }),
    { outcome: 'method_not_allowed' }
  );
};
