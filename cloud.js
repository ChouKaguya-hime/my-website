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
