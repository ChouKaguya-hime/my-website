/* ==========================================================================
   习惯看板 · 主视图逻辑（Day 8｜第 2 周）
   --------------------------------------------------------------------------
   这一版的数据是「本地假数据」（mock），页面也不发任何网络请求。
   但结构是按「以后要接真接口」来搭的，全部改动都收在一个地方：

        数据层 fetchBoard()  →  渲染 renderAll()  →  状态机 setState()

   第 3 周接真实 API 时，只需要把 fetchBoard() 里的内容换成真的请求，
   渲染和状态机一行都不用动。

   必须守的硬约束（TECH_DESIGN 第 6 节 T1–T8）：
     T1 不引任何外部资源      T2 不用 ES Module（不用 import / export）
     T3 不依赖构建            T4 全部用相对路径
     T5 图标只用 CSS 画       T6 只用系统字体
     T8 不用 fetch 读本地文件（所以假数据直接写在下面，不读 json 文件）
   ========================================================================== */

/* ==================== 一、本地假数据（mock） ==================== */

/*
 * 为什么假数据不放在单独的 .json 文件里？
 * 因为 T8 禁止用 fetch 读本地文件，而且 file:// 下读文件会被浏览器跨域拦住。
 * 所以第 2 周先把数据直接写死在代码里，第 3 周由服务器提供。
 *
 * 四条习惯是故意挑的，正好覆盖三种强度情况：
 *   早睡       每天型  最近 7 天做到 3 天  → 43%
 *   喝水       每天型  最近 7 天做到 5 天  → 71%
 *   读书       每周3次 最近 7 天做到 2 次  → 67%
 *   冥想       每周2次 最近 7 天一次没做   → 「—」而不是 0%
 */
function buildMock() {
  var t = todayStr();
  return {
    habits: [
      {
        id: 'h_sleep',
        name: '早睡',
        freqType: 'daily',
        freqCount: 7,
        doneDates: [shiftDate(t, -6), shiftDate(t, -4), t]
      },
      {
        id: 'h_water',
        name: '每天喝够 8 杯水',
        freqType: 'daily',
        freqCount: 7,
        doneDates: [
          shiftDate(t, -6), shiftDate(t, -5), shiftDate(t, -3),
          shiftDate(t, -2), shiftDate(t, -1)
        ]
      },
      {
        id: 'h_read',
        name: '读书 20 分钟',
        freqType: 'weekly',
        freqCount: 3,
        doneDates: [shiftDate(t, -5), shiftDate(t, -1)]
      },
      {
        id: 'h_meditate',
        name: '冥想',
        freqType: 'weekly',
        freqCount: 2,
        doneDates: [shiftDate(t, -20)]
      }
    ],
    todos: [
      { id: 't_1', text: '把本周的账单对一遍', done: false },
      { id: 't_2', text: '预约周五的牙医', done: false },
      { id: 't_3', text: '给妈妈打个电话', done: true }
    ]
  };
}

/*
 * 「加一个示例：早睡」按钮专用的那一条数据。
 *
 * 为什么单独写一份、而不是复用上面的 buildMock()：
 * 那个按钮写的是「加一个」，那就只该多出一个 —— 4 个习惯 + 3 条待办一起倒出来，
 * 是按钮文案和实际行为对不上（Day 10 修的就是这个）。
 *
 * doneDates 故意留空：刚加进来的习惯，今天还没勾、最近 7 天也没记录，
 * 按设计原则 1，强度显示「—」而不是 0%。
 */
function buildSeedData() {
  return {
    habits: [
      {
        id: 'h_sleep',
        name: '早睡',
        freqType: 'daily',
        freqCount: 7,
        doneDates: []
      }
    ],
    todos: []
  };
}

/* ==================== 二、日期工具 ==================== */
/*
 * 为什么不直接用 new Date('2026-09-23')？
 * 那样会被当成 UTC 午夜解析，东八区下算出来差一天（Day 7 踩过的坑）。
 * 所以一律用手动构造的本地日期。
 */

var WEEK_CN = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

function fmtDate(d) {
  var y = d.getFullYear();
  var m = String(d.getMonth() + 1).padStart(2, '0');
  var day = String(d.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}

function parseDate(s) {
  var p = String(s).split('-');
  return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
}

function todayStr() {
  return fmtDate(new Date());
}

function shiftDate(s, n) {
  var d = parseDate(s);
  d.setDate(d.getDate() + n);
  return fmtDate(d);
}

function lastNDays(n) {
  var out = [];
  for (var i = n - 1; i >= 0; i--) {
    out.push(shiftDate(todayStr(), -i));
  }
  return out;
}

function humanDate(s) {
  var d = parseDate(s);
  return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + WEEK_CN[d.getDay()];
}

/* ==================== 三、本周强度 ==================== */

/*
 * 本周强度 = 最近 7 天内完成的天数 ÷ 应该完成的天数
 *   · 每天型：分母 7   · 每周 N 次型：分母 N，超过 100% 也按 100%
 *   · 最近 7 天一次都没完成 → 显示「—」而不是 0%（设计原则 1）
 * 这一段跟 app.js 是同一套算法，两个页面算出来的数必须一样。
 */
function calcStrength(habit) {
  var done = Array.isArray(habit.doneDates) ? habit.doneDates : [];
  var win = lastNDays(7);
  var hit = 0;
  for (var i = 0; i < win.length; i++) {
    if (done.indexOf(win[i]) !== -1) hit++;
  }
  if (hit === 0) return { text: '—', percent: 0 };

  var denom = habit.freqType === 'weekly'
    ? Math.max(1, Number(habit.freqCount) || 1)
    : 7;

  var pct = Math.min(100, Math.round((hit / denom) * 100));
  return { text: pct + '%', percent: pct };
}

function isDoneToday(h) {
  return Array.isArray(h.doneDates) && h.doneDates.indexOf(todayStr()) !== -1;
}

function freqText(h) {
  if (h.freqType === 'weekly') return '每周 ' + (h.freqCount || 1) + ' 次';
  return '每天';
}

/* ==================== 四、数据层 ==================== */

/*
 * 演示模式：只为了让人手动看到四种状态，外加空状态那个「加一个示例」按钮。
 * 接真实接口后，整个 demoMode 和下面的 if 分支都会删掉，
 * 换成一个真正的网络请求 —— 这就是今天想要的那个「可替换的一层」。
 */
var demoMode = 'success';

/**
 * 取看板数据。真实项目里这里是「问服务器要数据」，现在先返回本地假数据。
 * 返回 Promise 是为了跟真实网络请求的节奏一样：要等，也可能出错。
 */
function fetchBoard() {
  return new Promise(function (resolve, reject) {

    /* 演示：假装请求还没回来 —— 骨架屏就一直挂着 */
    if (demoMode === 'loading') return;

    /* 演示：用 700 毫秒模拟网络延迟，好让人看清「加载中」那一下 */
    setTimeout(function () {
      if (demoMode === 'error') {
        reject(new Error('模拟：取数据出错'));
        return;
      }
      if (demoMode === 'empty') {
        resolve({ habits: [], todos: [] });
        return;
      }
      if (demoMode === 'seed') {
        resolve(buildSeedData());
        return;
      }
      resolve(deepCopy(buildMock()));
    }, 700);
  });
}

function deepCopy(o) {
  return JSON.parse(JSON.stringify(o));
}

/* ==================== 五、状态机 ==================== */

/*
 * 一个页面就这四种状态，任何时刻只显示其中一种。
 * 之前只写了「有数据」那一种，另外三种是补上的。
 */
var STATES = ['loading', 'success', 'empty', 'error'];

var STATE_TEXT = {
  loading: '加载中',
  success: '已加载',
  empty: '暂无内容',
  error: '加载出错'
};

var currentState = 'loading';
var currentData = null;

function setState(name) {
  currentState = name;

  STATES.forEach(function (s) {
    el('state-' + s).hidden = (s !== name);
  });

  var badge = el('state-badge');
  badge.textContent = STATE_TEXT[name];
  badge.dataset.state = name;

  var btns = document.querySelectorAll('[data-demo]');
  for (var i = 0; i < btns.length; i++) {
    btns[i].classList.toggle('is-active', btns[i].dataset.demo === name);
  }
}

/* ==================== 六、渲染 ==================== */

function el(id) {
  return document.getElementById(id);
}

function findHabit(id) {
  if (!currentData) return null;
  for (var i = 0; i < currentData.habits.length; i++) {
    if (currentData.habits[i].id === id) return currentData.habits[i];
  }
  return null;
}

/** 习惯 = 卡片：一张一条，横着铺开 */
function renderHabits(habits) {
  var grid = el('habit-grid');
  grid.textContent = '';

  habits.forEach(function (h) {
    var s = calcStrength(h);
    var done = Array.isArray(h.doneDates) ? h.doneDates : [];

    var card = document.createElement('article');
    card.className = 'habit-card' + (isDoneToday(h) ? ' is-done' : '');
    card.dataset.id = h.id;
    card.dataset.strength = s.text === '—' ? 'none' : 'has';

    var top = document.createElement('div');
    top.className = 'card-top';

    var name = document.createElement('h3');
    name.className = 'card-name';
    name.textContent = h.name;

    var check = document.createElement('button');
    check.type = 'button';
    check.className = 'check';
    check.dataset.act = 'toggle-habit';
    check.setAttribute('aria-label',
      (isDoneToday(h) ? '取消完成' : '标记完成') + '：' + h.name);

    top.appendChild(name);
    top.appendChild(check);

    var freq = document.createElement('p');
    freq.className = 'card-freq';
    freq.textContent = freqText(h);

    var row = document.createElement('div');
    row.className = 'strength-row';

    var label = document.createElement('span');
    label.className = 'strength-label';
    label.textContent = '本周强度';

    var value = document.createElement('strong');
    value.className = 'strength-value';
    value.textContent = s.text;

    row.appendChild(label);
    row.appendChild(value);

    var bar = document.createElement('div');
    bar.className = 'bar';
    var fill = document.createElement('div');
    fill.className = 'bar-fill';
    fill.style.width = s.percent + '%';
    bar.appendChild(fill);

    var cells = document.createElement('div');
    cells.className = 'cells7';
    lastNDays(7).forEach(function (d) {
      var on = done.indexOf(d) !== -1;
      var c = document.createElement('i');
      c.className = 'cell' + (on ? ' on' : '');
      c.title = humanDate(d) + (on ? '：已完成' : '：没做');
      cells.appendChild(c);
    });

    card.appendChild(top);
    card.appendChild(freq);
    card.appendChild(row);
    card.appendChild(bar);
    card.appendChild(cells);
    grid.appendChild(card);
  });
}

/** 待办 = 列表：一条一行 */
function renderTodos(todos) {
  var list = el('todo-list');
  list.textContent = '';

  todos.forEach(function (t) {
    var li = document.createElement('li');
    li.className = 'todo-row' + (t.done ? ' is-done' : '');
    li.dataset.id = t.id;

    var check = document.createElement('button');
    check.type = 'button';
    check.className = 'todo-check';
    check.dataset.act = 'toggle-todo';
    check.setAttribute('aria-label', (t.done ? '取消完成' : '标记完成') + '：' + t.text);

    var text = document.createElement('span');
    text.className = 'todo-text';
    text.textContent = t.text;

    li.appendChild(check);
    li.appendChild(text);
    list.appendChild(li);
  });
}

function renderHints() {
  var habits = currentData.habits;
  var doneH = 0;
  for (var i = 0; i < habits.length; i++) {
    if (isDoneToday(habits[i])) doneH++;
  }
  el('habit-hint').textContent = habits.length + ' 个 · 今天已完成 ' + doneH + ' 个';

  var todos = currentData.todos;
  var doneT = 0;
  for (var j = 0; j < todos.length; j++) {
    if (todos[j].done) doneT++;
  }
  el('todo-hint').textContent = todos.length + ' 条 · 已完成 ' + doneT + ' 条';
}

function renderAll() {
  if (!currentData) return;
  renderHabits(currentData.habits);
  renderTodos(currentData.todos);
  renderHints();
}

/* ==================== 七、加载流程 ==================== */

function load() {
  setState('loading');

  fetchBoard().then(function (data) {
    /* 拿到了，但一条都没有 → 这才是「空状态」，不是「出错」 */
    if (!data.habits.length && !data.todos.length) {
      currentData = data;
      setState('empty');
      return;
    }
    currentData = data;
    renderAll();
    setState('success');
  }, function () {
    /* 没拿到 → 出错状态。数据一条都没丢，给个「重试」就行 */
    currentData = null;
    setState('error');
  });
}

/* ==================== 八、交互 ==================== */

/*
 * 演示版：勾选只改内存里的数据，然后重画一遍，刷新页面就恢复原样。
 * 真实版本里，这里改完要写回服务器，成功了才重画 —— 就是 app.js 里的 commit()。
 */
function toggleHabitToday(id) {
  var h = findHabit(id);
  if (!h) return;
  if (!Array.isArray(h.doneDates)) h.doneDates = [];
  var t = todayStr();
  var i = h.doneDates.indexOf(t);
  if (i === -1) h.doneDates.push(t);
  else h.doneDates.splice(i, 1);
  renderAll();
}

function toggleTodo(id) {
  if (!currentData) return;
  for (var i = 0; i < currentData.todos.length; i++) {
    if (currentData.todos[i].id === id) {
      currentData.todos[i].done = !currentData.todos[i].done;
      break;
    }
  }
  renderAll();
}

el('habit-grid').addEventListener('click', function (ev) {
  var btn = ev.target.closest('[data-act="toggle-habit"]');
  if (!btn) return;
  var card = btn.closest('.habit-card');
  if (!card) return;
  toggleHabitToday(card.dataset.id);
});

el('todo-list').addEventListener('click', function (ev) {
  var btn = ev.target.closest('[data-act="toggle-todo"]');
  if (!btn) return;
  var row = btn.closest('.todo-row');
  if (!row) return;
  toggleTodo(row.dataset.id);
});

/* 空状态：加一条示例习惯 —— 只加「早睡」一条，待办一条都不加 */
el('btn-seed').addEventListener('click', function () {
  demoMode = 'seed';
  load();
});

/* 出错状态：重试一次 */
el('btn-retry').addEventListener('click', function () {
  demoMode = 'success';
  load();
});

/* 底部演示条：手动切四种状态 */
(function bindDevbar() {
  var btns = document.querySelectorAll('[data-demo]');
  for (var i = 0; i < btns.length; i++) {
    btns[i].addEventListener('click', function () {
      demoMode = this.dataset.demo;
      load();
    });
  }
})();

/* ==================== 启动 ==================== */

el('today-date').textContent = humanDate(todayStr());
load();
