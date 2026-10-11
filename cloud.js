/* ==========================================================================
   cloud.js —— 前端「读云端」的接入层（Day 17 新增）
   --------------------------------------------------------------------------
   为什么单独一个文件：
     api-contract.md 第 6 节定过一条规矩 ——「接口地址和读法只出现在一个地方」。
     以后地址变了、接口改了字段，只动这一个文件，页面逻辑一行都不用碰。

   今天（Day 17）它只做一件事：**把「读」这一步接上真库**。
     · 页面打开时先去问 /api/habits 和 /api/todos
     · 问到了 → 用库里的数据重画页面，右上角标「云端数据库」
     · 问不到（断网 / 接口挂了 / 还没部署）→ 页面照旧用本机那份，不报错、不白屏
     ⚠️ 今天**还没接「写」**（新增/勾选/删除仍写在本机，Day 18 接）——
        所以本机改动在当前这次打开里有效，刷新后会被云端那份覆盖。这是刻意的，不是 bug。

   守项目硬约束：T1 不引外部资源（这是本地文件）、T2 不用 ES Module（用 IIFE + var）。
   --------------------------------------------------------------------------
   Day 20 加练：多记一样东西 —— **「这份数据是几点从云端读回来的」**（CLOUD.loadedAt）。
   它只回答一个问题：「我现在看到的数，新鲜吗？」页面上的「检查台」（状态自查那一屏）
   把它显示出来；读不到云端时它老实显示「—」，不编一个时间。
   ========================================================================== */
(function (global) {
  'use strict';

  /* 接口地址只有这一处。环境 ID 不是密钥（密钥在云函数的环境变量里，前端拿不到）。 */
  var BASE = 'https://habit-board-d0gum6nqu512acc29-1499798330.ap-shanghai.app.tcloudbase.com';

  var API = {
    habits: BASE + '/api/habits',
    todos: BASE + '/api/todos'
  };

  /* 单次请求最多等多久。超时就当「云端没读到」，回落到本机数据 —— 宁可页面照常能用 */
  var TIMEOUT_MS = 8000;

  /** 带超时的 GET；任何异常都返回 null（调用方只关心「拿到没拿到」） */
  function getJson(url) {
    var ctrl = (typeof AbortController === 'function') ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, TIMEOUT_MS);

    return fetch(url, { signal: ctrl ? ctrl.signal : undefined })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (json) {
        clearTimeout(timer);
        /* 契约第 4.3 节：成功与否只认 ok 这个字段，不靠 HTTP 状态码猜 */
        if (!json || json.ok !== true || !Array.isArray(json.data)) return null;
        return json.data;
      })
      .catch(function () {
        clearTimeout(timer);
        return null;
      });
  }

  /**
   * 一次把两样都读回来。
   * 返回值：Promise<null | {habits, todos, at}>
   *   null  = 没读到（调用方继续用本机数据）
   *   对象  = 读到了
   */
  function load() {
    return Promise.all([getJson(API.habits), getJson(API.todos)]).then(function (r) {
      var habits = r[0], todos = r[1];
      if (!habits || !todos) return null;
      return { habits: habits, todos: todos, at: new Date().toISOString() };
    });
  }

  /**
   * ★ Day 24 新增：带超时的**写**请求（POST / PATCH / DELETE）。
   *
   * 为什么要有它：Day 17 只把「读」接上了，页面上的新建 / 改 / 删一直只写浏览器本机 ——
   * 而页面一打开，云端那份又会把本机覆盖掉，于是「在页面上做的改动，刷新就白做」。
   * 今天把「写」补上，服务端那几个口（§3.8 / §3.11 / §3.12）从 Day 18 / Day 22 就备着。
   *
   * 返回值统一成一个形状，调用方不用管 HTTP 那套：
   *   { ok: boolean, status: number, data: object|null, message: string, netError?: string }
   *   · ok      —— **只看响应体里的 ok 字段**（契约 §4.3），不靠状态码猜
   *   · message —— 服务端给的人话（Day 23 起一律中文），失败时直接能拿去给用户看
   *   · netError—— 请求根本没发出去（断网 / 被拦）时的原因
   */
  function sendJson(method, url, body) {
    var ctrl = (typeof AbortController === 'function') ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, TIMEOUT_MS);

    var opt = { method: method, signal: ctrl ? ctrl.signal : undefined };
    if (body !== undefined && body !== null) {
      opt.headers = { 'content-type': 'application/json; charset=utf-8' };
      opt.body = JSON.stringify(body);
    }

    return fetch(url, opt)
      .then(function (res) {
        clearTimeout(timer);
        return res.json()
          .then(function (json) {
            return {
              ok: !!(json && json.ok === true),
              status: res.status,
              data: (json && json.data) || null,
              message: (json && json.message) || '',
              error: (json && json.error) || ''
            };
          })
          .catch(function () {
            /* 回应不是 JSON（网关的中间页、HTML 错误页）—— 一样当失败，但不崩 */
            return { ok: false, status: res.status, data: null, message: '回应不是 JSON（HTTP ' + res.status + '）' };
          });
      })
      .catch(function (e) {
        clearTimeout(timer);
        return { ok: false, status: 0, data: null, message: '', netError: String((e && e.message) || e) };
      });
  }

  /** 右上角那个小标：告诉看页面的人「你现在看到的这份数据是从哪来的」 */
  function paintSource(source) {
    var el = document.getElementById('data-source');
    if (!el) return;
    if (source === 'cloud') {
      el.textContent = '云端数据库';
      el.className = 'data-source data-source-cloud';
      el.title = '这份数据来自 CloudBase PostgreSQL，通过 /api/habits 和 /api/todos 读出来（Day 17）';
      el.hidden = false;
    } else {
      el.textContent = '本机数据';
      el.className = 'data-source';
      el.title = '没读到云端接口，这一份来自浏览器本地存储';
      el.hidden = false;
    }
  }

  /**
   * Day 20 加练：把「最近一次成功从云端读回来」的时刻写成看得懂的一句。
   * 为什么自己拼字符串、不用 toLocaleString：后者的格式随浏览器语言设置变，
   * 不同机器上截出来的图长得不一样；验收要的是稳定可读的 'YYYY-MM-DD HH:MM:SS'。
   */
  function loadedAtText() {
    if (!CLOUD.loadedAt) return '';
    var d = new Date(CLOUD.loadedAt);
    if (isNaN(d.getTime())) return '';
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
      + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  }

  var CLOUD = {
    api: API,

    /* 页面上现在显示的这份数据来自哪 —— 'local' / 'cloud'。排查和自动化检查都靠它 */
    source: 'local',
    error: null,

    /* ★ Day 20 加练：最近一次成功从云端读回来的时刻（ISO 字符串）。null = 这次没读到 */
    loadedAt: null,

    /* 上面那个时刻的「给人看」版本；没读到就是空串 */
    loadedAtText: loadedAtText,

    load: load,

    /* ★ Day 24：三个「写」方法。接口地址和用法只在这个文件里出现（契约 §6 那条规矩）——
       以后地址变了、字段改了，只动这里，app.js / dashboard.js 一行都不用碰。 */

    /**
     * 新建习惯。传 {name, freqType, freqCount}。
     * **故意不传 id**：契约 §3.8 推荐让服务端生成 —— 两个客户端才不会撞上同一个 id。
     * 成功时 res.data 就是新建好的那条（形状和列表里的元素完全一样），调用方拿它替换本机那条。
     */
    createHabit: function (h) {
      return sendJson('POST', API.habits, {
        name: h.name,
        freqType: h.freqType,
        freqCount: h.freqCount
      });
    },

    /**
     * 改一条习惯。patch 里只放要改的字段。
     * ⚠️ 白名单只有 name / freqType / freqCount —— 契约 §3.11：
     *    `doneDates`（完成记录）不在里面，所以「勾选完成」写不回去（今天的「不做清单」里记着）。
     */
    updateHabit: function (id, patch) {
      return sendJson('PATCH', API.habits + '/' + encodeURIComponent(id), patch);
    },

    /** 删一条习惯。服务端默认走**软删**（能找回，契约 §3.12）—— 前端不需要区别对待 */
    removeHabit: function (id) {
      return sendJson('DELETE', API.habits + '/' + encodeURIComponent(id));
    },

    /**
     * 读到云端数据就替换进页面状态并重画。
     * opts = { state: 页面的状态对象, save: 落盘函数, rerender: 重画函数 }
     * 返回 Promise<true|false>（读到没读到）。
     */
    sync: function (opts) {
      return load().then(function (data) {
        if (!data) {
          CLOUD.source = 'local';
          CLOUD.error = 'cloud_unavailable';
          paintSource('local');
          return false;
        }
        opts.state.habits = data.habits;
        opts.state.todos = data.todos;
        CLOUD.source = 'cloud';
        CLOUD.error = null;
        CLOUD.loadedAt = data.at;          // ★ Day 20 加练：记下这一份是刚读回来的
        try { opts.save(); } catch (e) { /* 存不进去不影响此刻显示 */ }
        opts.rerender();
        paintSource('cloud');
        return true;
      });
    }
  };

  global.HabitBoardCloud = CLOUD;
})(window);
