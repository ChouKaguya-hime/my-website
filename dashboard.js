/* ==========================================================================
   习惯看板 · 主视图逻辑（Day 13｜第 2 周）
   --------------------------------------------------------------------------
   ⭐ Day 13 这一版：把这一页变成**装着三个视图的外壳**，视图之间靠地址栏的 # 切换。
        #/board        看板（默认）—— 今天的习惯 + 今天的待办，同屏
        #/habit/<id>   习惯详情（二级）—— 某个习惯最近 28 天的记录，带面包屑 + 返回
        #/states       状态自查（验收用）—— 四种状态并排看一遍；接真实接口后连同入口删掉
      为什么选 hash 路由，而不是路由库 / History API / 纯隐藏显示：
      见本文件末尾「十四、视图路由（Day 13）」那一段的注释。

   （Day 12）这一版把 Day 8 的「本地假数据」换成了**真实的浏览器本地存储**。

   ⭐ 最关键的一件事：它和今日页（app.js）读写的是
      **同一个存储键 + 同一套字段**（PRD 第 6.1 节）。
      在今日页加的习惯和待办，刷新这个页面就能看到；反过来也一样。
      两个视图，一份数据 —— 这是本次改动的全部意义。

   结构（Day 8 搭的那三层原样保留，只把最底下取数据的地方换掉了）：

       存储层 loadData / saveData  →  渲染 render*()  →  状态机 setViewState()
       视图路由 parseRoute / renderRoute（Day 13）在中间插了一层「先决定看哪一屏」

   必须守的硬约束（TECH_DESIGN 第 6 节 T1–T8）：
     T1 不引任何外部资源      T2 不用 ES Module（不用 import / export）
     T3 不依赖构建            T4 全部用相对路径
     T5 图标只用 CSS / 文字   T6 只用系统字体
     T7 每次数据改动后立刻写回存储，然后重画页面
     T8 不用 fetch 读本地文件（读的是 localStorage，不读 json 文件）

   v1.2 追加：页面顶部多了一组「全部 / 未完成 / 已完成」的筛选（PRD F5 / AC-16）。
   它只决定「屏幕上显示哪几条」，**不动数据** —— 存储里永远还是完整的那一份，
   所以筛着筛着去勾选、去新增，都不会把东西改丢。
   ========================================================================== */

/* ==================== 一、存储层 ==================== */

/*
 * ⚠️ 这个字符串必须和 app.js 里的 STORAGE_KEY 一字不差。
 * 两个页面各写各的键，就会变成「两套数据」——在看板加的习惯，今日页看不见。
 * 要动它，两个文件必须一起动。
 */
var STORAGE_KEY = 'habit-board/v1';

var state = { habits: [], todos: [] };

/**
 * 从本地存储读出数据。
 *
 * 三种结果要分清，不能都当成「空」：
 *   对象  → 读到了（也可能确实还没有任何数据）
 *   null  → **读不出来**（存储被禁用 / 内容坏了）
 *
 * 「读不出来」如果说成「你还没加过东西」，会让人以为记录丢了 —— 那是更坏的结果。
 */
function loadData() {
  try {
    var raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { habits: [], todos: [], growth: null };

    var obj = JSON.parse(raw);
    if (!obj || typeof obj !== 'object') return null;

    return {
      habits: Array.isArray(obj.habits) ? obj.habits : [],
      todos: Array.isArray(obj.todos) ? obj.todos : [],
      /* 成长物（F6）：老数据里没这个字段 → 给 null，由 growthState() 补默认值 */
      growth: (obj.growth && typeof obj.growth === 'object') ? obj.growth : null
    };
  } catch (e) {
    return null;                 /* 隐私模式禁止写入 / 内容坏了 */
  }
}

function saveData() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch (e) {
    /* 存不进去（容量满 / 隐私模式）。页面还能继续用，但这次改动留不住 */
    return false;
  }
}

function newId(prefix) {
  return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

/* ==================== 二、日期工具 ==================== */

/*
 * 这一段的算法必须和 app.js 完全一致 ——
 * 否则同一个习惯，两个页面算出来的「本周强度」会不一样。
 *
 * 为什么不直接用 new Date('2026-09-23')：
 * 那样会被当成 UTC 午夜解析，东八区下算出来差一天（Day 7 踩过的坑）。
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

/** 最近 n 天（含今天），从最早排到今天 */
function lastNDays(n) {
  var out = [];
  for (var i = n - 1; i >= 0; i--) {
    out.push(shiftDate(todayStr(), -i));
  }
  return out;
}

/*
 * 28 个格子按「自然周」对齐成 4 行 × 7 列 —— 和今日页详情弹层**同一套算法**。
 *   起点 = 本周周一再往前 3 周，终点 = 本周周日。
 * 为什么不用「纯过去 28 天」：只有对齐到自然周，本周今天之后的那几格
 * 才是真的「还没到」，图例里的三种状态才都有东西可指；
 * 而且同一个习惯在两个页面里，格子位置必须长得一样。
 */
function build28Dates() {
  var t = todayStr();
  var dow = parseDate(t).getDay();                 /* 0 = 周日 */
  var backToMon = (dow === 0 ? 6 : dow - 1);
  var start = shiftDate(t, -(backToMon + 21));
  var out = [];
  for (var i = 0; i < 28; i++) out.push(shiftDate(start, i));
  return out;
}

function humanDate(s) {
  var d = parseDate(s);
  return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + WEEK_CN[d.getDay()];
}

/* ==================== 三、本周强度（PRD 6.2） ==================== */

/*
 * 本周强度 = 最近 7 天内「完成的天数」÷「应该完成的天数」× 100%
 *   · 每天型（daily）：分母 = 7
 *   · 每周 N 次型（weekly）：分母 = N，算出来超过 100% 也按 100%
 *   · 最近 7 天一次都没完成 → 显示「—」而不是 0%
 *     「—」的意思是「还没开始」，不是「没做到」——设计原则 1 的直接落点
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

/*
 * 看板上的待办只显示**属于今天**的，和今日页口径一致（PRD 6.1 的 date 字段就是干这个的）。
 * 两个页面对「今天的待办」给出不同的答案，比少一个功能更糟。
 */
function todosToday() {
  var t = todayStr();
  return state.todos.filter(function (x) { return x.date === t; });
}

/** 一条数据都没有 —— 这时才配显示整页空状态 */
function isBlank() {
  return state.habits.length === 0 && state.todos.length === 0;
}

/* ==================== 三·五、完成状态筛选（v1.2 / AC-16） ==================== */

/*
 * 只有一种口径：全部 / 未完成 / 已完成。
 * 习惯卡片和待办列表**共用这一个值**，所以点一下两个区块同时收敛 ——
 * 一页里放两个各自为政的筛选器，用户就得多记一次「我现在到底在看什么」
 * （PRD F5 的不做清单里把这条划死了）。
 *
 * 这个值**不落盘**：筛选是「我现在想看什么」，不是「这个页面的设置」。
 * 下次打开回到「全部」，才守得住设计原则 3「默认零配置、打开即全貌」。
 */
var FILTERS = ['all', 'open', 'done'];
var filter = 'all';

/** 只判断「完成没完成」，不碰历史、不碰强度 —— 筛选不改任何数据 */
function matchesFilter(done) {
  if (filter === 'open') return !done;
  if (filter === 'done') return done;
  return true;
}

function habitVisible(h) { return matchesFilter(isDoneToday(h)); }
function todoVisible(t) { return matchesFilter(!!t.done); }

function visibleHabits() { return state.habits.filter(habitVisible); }
function visibleTodos() { return todosToday().filter(todoVisible); }

/**
 * 筛完一条都不剩时说什么。**两种情况必须分开说**，别混成一句：
 *   · 本来就没有 → 告诉人下一步怎么加（新人对着一片空白是不知道该干嘛的）
 *   · 有、但都被筛掉了 → 说明这是「筛出来的空」，不是数据没了
 *
 * 「没有未完成的了 —— 今天的都做完了」是**往前看**的说法：
 * 不说「你都还没做」这种追责口气，守设计原则 1（不做惩罚性反馈）。
 */
function emptyNote(kind) {
  var noun = kind === 'habit' ? '习惯' : '待办';
  var total = kind === 'habit' ? state.habits.length : todosToday().length;

  if (total === 0) {
    return kind === 'habit'
      ? '还没有习惯。点右上角的「＋ 新建习惯」加一个。'
      : '今天还没有待办。在最下面的输入框里记一条，按回车就加上。';
  }
  if (filter === 'open') return '没有未完成的' + noun + '了 —— 今天的都做完了。';
  if (filter === 'done') return '今天还没有已完成的' + noun + '。';
  return '';
}

/**
 * 区块的「空」和「有」两种样子同步一次。
 *
 * 空的时候顺手把列表的边框收掉（.is-void）：一条都没有还留着一个空框，
 * 看起来像「加载坏了」而不像「就是没有」—— 这是 Day 10 就发现、一直留着的老毛病，
 * 筛选的「无结果」情况正好要正面处理它，顺手一起修了。
 */
function syncBlockEmpty(kind, visibleCount) {
  var note = el(kind + '-empty');
  var box = el(kind === 'habit' ? 'habit-grid' : 'todo-list');
  if (!note) return;

  if (visibleCount > 0) {
    note.hidden = true;
    note.textContent = '';
    if (box) box.classList.remove('is-void');
    return;
  }
  note.textContent = emptyNote(kind);
  note.hidden = false;
  if (box) box.classList.add('is-void');
}

/** 把「哪个按钮被选中」同步给眼睛（class）和读屏软件（aria-pressed） */
function syncFilterButtons() {
  var btns = el('filter-bar').querySelectorAll('.filter-btn');
  for (var i = 0; i < btns.length; i++) {
    var on = btns[i].dataset.filter === filter;
    btns[i].classList.toggle('is-on', on);
    btns[i].setAttribute('aria-pressed', on ? 'true' : 'false');
  }
}

/**
 * 切换筛选口径。只重画列表和计数，**不碰数据、不碰存储**。
 * 点「全部」就是这个函数的 name = 'all' —— 所谓「清空筛选」，就是回到这一步（AC-16 第 3 种情况）。
 */
function setFilter(name) {
  filter = FILTERS.indexOf(name) === -1 ? 'all' : name;
  syncFilterButtons();
  renderHabits();
  renderTodos();
  renderHints();
}

/* ==================== 三·六、成长物（F6，PRD v1.3） ==================== */

/*
 * 和今日页长的是**同一株**小苗 —— 同一个存储键里的同一个 growth 字段。
 * 规则（PRD 第 4 节 F6）：每完成一个习惯长一格，当天最多一格；攒满 7 格开一朵花，
 * 花进「花架」只增不减；一天没喂不枯、不掉、不清空（设计原则 1）。
 */

var GROWTH_FULL = 7;
var GROWTH_COLORS = ['#d4537e', '#ef9f27', '#7f77dd', '#d85a30'];

function growthState() {
  if (!state.growth || typeof state.growth !== 'object') {
    state.growth = { progress: 0, fedDate: null, flowers: [] };
  }
  var g = state.growth;
  if (typeof g.progress !== 'number' || g.progress < 0) g.progress = 0;
  if (g.progress > GROWTH_FULL) g.progress = GROWTH_FULL;
  if (typeof g.fedDate !== 'string') g.fedDate = null;
  if (!Array.isArray(g.flowers)) g.flowers = [];
  return g;
}

/** 完成了一个习惯 → 喂一口（当天只长一格；攒满 7 格开一朵花） */
function feedGrowth() {
  var g = growthState();
  var t = todayStr();
  if (g.fedDate === t) return;
  g.progress += 1;
  g.fedDate = t;
  if (g.progress >= GROWTH_FULL) {
    g.flowers.push(GROWTH_COLORS[Math.floor(Math.random() * GROWTH_COLORS.length)]);
    g.progress = 0;
  }
}

function renderGrowth() {
  var bar = el('growth');
  if (!bar) return;

  /* 一个习惯都还没有就不占地方 */
  if (state.habits.length === 0) { bar.hidden = true; return; }
  bar.hidden = false;

  var g = growthState();
  var i;

  var leaves = el('growth-leaves');
  leaves.innerHTML = '';
  for (i = 1; i <= GROWTH_FULL; i++) {
    var leaf = document.createElement('i');
    leaf.className = 'growth-leaf' + (i <= g.progress ? ' on' : '');
    leaves.appendChild(leaf);
  }

  var text = el('growth-text');
  if (g.progress === 0) {
    text.textContent = g.flowers.length > 0
      ? '新的一轮 —— 它又从头冒出来了'
      : '还没喂过 —— 它在土里等着';
  } else {
    text.textContent = '这轮喂了 ' + g.progress + ' 口，长到第 ' + g.progress + ' 格';
  }

  var shelf = el('growth-shelf');
  shelf.innerHTML = '';
  if (g.flowers.length === 0) {
    var none = document.createElement('span');
    none.textContent = '花架还是空的';
    shelf.appendChild(none);
  } else {
    var label = document.createElement('span');
    label.textContent = '花架 ' + g.flowers.length + ' 朵';
    shelf.appendChild(label);
    var showN = Math.min(g.flowers.length, 8);
    for (i = 0; i < showN; i++) {
      var pip = document.createElement('i');
      pip.className = 'growth-bloom';
      pip.style.background = g.flowers[i];
      shelf.appendChild(pip);
    }
  }
}

/* ==================== 四、状态机 ==================== */

/*
 * 每一种「视图」都有这几种状态，任何时刻只显示其中一种。
 *
 * 看板视图用全四种；习惯详情视图也有自己的四种（「空」= 这个习惯还一次都没完成过，
 * 「出错」= 找不到这个习惯 / 读不出存储）—— 见第十四节。
 *
 * 关于 loading（骨架屏）：本地存储是同步读的，所以真实数据下它一闪而过。
 * 保留它是因为第 3 周接上真实接口后，读数据会变成真的「要等」，那时它就是活的。
 * error 则是有真实触发条件的：浏览器禁用了本地存储，或者存的内容已经不是合法 JSON。
 */
var STATES = ['loading', 'success', 'empty', 'error'];

/* 看板视图当前停在哪个状态。新增 / 删除之后要靠它决定「要不要整页切过去」 */
var boardState = 'loading';

/**
 * 切某个视图内部的状态。
 * 用 data-state 而不是 id 来找节点 —— 因为「加载中」这一种样子，
 * 看板和习惯详情两个视图各有一份，它们不该各写一套代码。
 */
function setViewState(view, name) {
  var root = el('view-' + view);
  if (!root) return;

  var nodes = root.querySelectorAll('.state');
  for (var i = 0; i < nodes.length; i++) {
    nodes[i].hidden = nodes[i].dataset.state !== name;
  }
  if (view === 'board') boardState = name;
}

/* ==================== 五、渲染 ==================== */

function el(id) {
  return document.getElementById(id);
}

function findHabit(id) {
  for (var i = 0; i < state.habits.length; i++) {
    if (state.habits[i].id === id) return state.habits[i];
  }
  return null;
}

function findTodo(id) {
  for (var i = 0; i < state.todos.length; i++) {
    if (state.todos[i].id === id) return state.todos[i];
  }
  return null;
}

/**
 * 拼出一张习惯卡片。
 * 单独抽出来是为了能「只换这一张」——局部更新和整批渲染复用同一套拼装代码，
 * 不会出现「重画时一种样子、点一下变另一种样子」的偏差（Day 11）。
 */
function buildHabitCard(h, opts) {
  var s = calcStrength(h);
  var done = Array.isArray(h.doneDates) ? h.doneDates : [];
  var doneToday = isDoneToday(h);
  /* 名字是否做成通往详情页的链接。例外只有一个：状态自查页里的示例卡片不是真习惯，不能点 */
  var asLink = !(opts && opts.link === false);

  var card = document.createElement('article');
  card.className = 'habit-card' + (doneToday ? ' is-done' : '');
  card.dataset.id = h.id;
  card.dataset.strength = s.text === '—' ? 'none' : 'has';

  var top = document.createElement('div');
  top.className = 'card-top';

  /*
   * 名字做成链接，而不是给整张卡片绑点击：
   *   · 语义对 —— 它确实是「跳到另一个视图」
   *   · Tab 能走到、Enter 能进、右键「在新标签页打开」—— 全是白拿的
   *   · 和勾选圈 / 删除按钮各管各的，不会互相抢点击
   */
  var name = document.createElement('h3');
  name.className = 'card-name';
  if (asLink) {
    var nameLink = document.createElement('a');
    nameLink.href = '#/habit/' + encodeURIComponent(h.id);
    nameLink.textContent = h.name;
    name.appendChild(nameLink);
  } else {
    name.textContent = h.name;
  }

  var check = document.createElement('button');
  check.type = 'button';
  check.className = 'check';
  check.dataset.act = 'toggle-habit';
  /* aria-pressed：把「这个开关是开还是关」直接告诉读屏软件，不用猜按钮上的文字 */
  check.setAttribute('aria-pressed', doneToday ? 'true' : 'false');
  check.setAttribute('aria-label',
    (doneToday ? '取消完成' : '标记完成') + '：' + h.name);

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

  /*
   * 删除放在卡片最下面、颜色压得很淡。
   * 为什么不跟勾选圈并排放在右上角：那里是每天要点很多次的地方，
   * 紧挨着放一个「删」按钮，迟早会点错。
   */
  var foot = document.createElement('div');
  foot.className = 'card-foot';

  var del = document.createElement('button');
  del.type = 'button';
  del.className = 'link-danger';
  del.dataset.act = 'del-habit';
  del.textContent = '删除';
  del.setAttribute('aria-label', '删除习惯：' + h.name);

  foot.appendChild(del);

  card.appendChild(top);
  card.appendChild(freq);
  card.appendChild(row);
  card.appendChild(bar);
  card.appendChild(cells);
  card.appendChild(foot);
  return card;
}

/** 拼出一条待办行（同样单独抽出来，给局部更新复用） */
function buildTodoRow(t) {
  var li = document.createElement('li');
  li.className = 'todo-row' + (t.done ? ' is-done' : '');
  li.dataset.id = t.id;

  var check = document.createElement('button');
  check.type = 'button';
  check.className = 'todo-check';
  check.dataset.act = 'toggle-todo';
  check.setAttribute('aria-pressed', t.done ? 'true' : 'false');
  check.setAttribute('aria-label', (t.done ? '取消完成' : '标记完成') + '：' + t.text);

  var text = document.createElement('span');
  text.className = 'todo-text';
  text.textContent = t.text;

  var del = document.createElement('button');
  del.type = 'button';
  del.className = 'row-del';
  del.dataset.act = 'del-todo';
  del.textContent = '×';
  del.setAttribute('aria-label', '删除待办：' + t.text);

  li.appendChild(check);
  li.appendChild(text);
  li.appendChild(del);
  return li;
}

function renderHabits() {
  var grid = el('habit-grid');
  grid.textContent = '';
  var list = visibleHabits();
  list.forEach(function (h) {
    grid.appendChild(buildHabitCard(h));
  });
  syncBlockEmpty('habit', list.length);
}

function renderTodos() {
  var list = el('todo-list');
  list.textContent = '';
  var rows = visibleTodos();
  rows.forEach(function (t) {
    list.appendChild(buildTodoRow(t));
  });
  syncBlockEmpty('todo', rows.length);
}

/**
 * 两个区块的计数 + 顶部那行总进度（口径与今日页一致：习惯 + 今天的待办）。
 *
 * ⚠️ 这几个数字**永远按全量算，不受筛选影响** ——
 * 「今天已完成 2 / 4」说的是今天整体的进度，不是「我现在筛出来的那几条」。
 * 筛选只决定「列出哪些」，不决定「一共几件、做了几件」。
 * 筛出来的条数单独写在 #filter-state 里，两个口径各说各的，不混在一起。
 */
function renderHints() {
  var habits = state.habits;
  var todos = todosToday();

  var doneH = 0;
  for (var i = 0; i < habits.length; i++) {
    if (isDoneToday(habits[i])) doneH++;
  }
  el('habit-hint').textContent = habits.length + ' 个 · 今天已完成 ' + doneH + ' 个';

  var doneT = 0;
  for (var j = 0; j < todos.length; j++) {
    if (todos[j].done) doneT++;
  }
  el('todo-hint').textContent = todos.length + ' 条 · 已完成 ' + doneT + ' 条';

  el('today-count').textContent = (doneH + doneT) + ' / ' + (habits.length + todos.length);

  /* 筛选结果的数量。选「全部」时不显示 —— 那时它和上面的计数说的是同一件事 */
  var fs = el('filter-state');
  if (fs) {
    fs.textContent = filter === 'all'
      ? ''
      : '筛出 ' + visibleHabits().length + ' 个习惯 · ' + visibleTodos().length + ' 条待办';
  }

  /* F6：成长物也在这里刷新 —— 所有调 renderHints 的地方（含切视图）都会跟着更新 */
  renderGrowth();
}

function renderAll() {
  renderHabits();
  renderTodos();
  renderHints();
}

/* ==================== 六、局部更新（Day 11） ==================== */

/*
 * 为什么不再用 renderAll() 收尾（Day 11 换掉的写法）：
 *   ① 整页重画＝所有节点瞬间重建，中间没有任何过渡，用户看不出「哪一下生效了」；
 *   ② 重画会把键盘焦点冲掉（焦点掉回 body），想连续勾几条就得重新按一遍 Tab；
 *   ③ 顺手也把滚动位置、鼠标悬停状态一起抹掉。
 * 改成「只换动过的那一个」之后，上面三件事同时不存在了，
 * 动效也才有机会播出来 —— 因为新节点是全新元素，动画会自动跑一次。
 */

/** 只换掉一张习惯卡片，其余卡片原地不动 */
function refreshHabitCard(id) {
  var grid = el('habit-grid');
  var old = grid.querySelector('.habit-card[data-id="' + id + '"]');
  var h = findHabit(id);
  if (!old || !h) return;

  /* 换之前先记两件事：焦点在不在里面、进度条原来是多宽 */
  var keptFocus = old.contains(document.activeElement);
  var s = calcStrength(h);
  var oldFill = old.querySelector('.bar-fill');
  var oldWidth = oldFill ? oldFill.style.width : '';

  var next = buildHabitCard(h);
  next.classList.add('is-changed');

  /* 进度条要从旧宽度「长」到新宽度，所以先把新卡片里的条设回旧值 */
  var newFill = next.querySelector('.bar-fill');
  if (newFill && oldWidth) newFill.style.width = oldWidth;

  old.parentNode.replaceChild(next, old);

  if (newFill && oldWidth) {
    void newFill.offsetWidth;   /* 强制浏览器先认下起始宽度，否则两个值会被合并成一步 */
    newFill.style.width = s.percent + '%';
  }

  /* 焦点还回同一个按钮：键盘连续操作不会断在「换卡片」这一下 */
  if (keptFocus) {
    var back = next.querySelector('[data-act="toggle-habit"]');
    if (back) back.focus({ preventScroll: true });
  }
}

/** 只换掉一条待办行 */
function refreshTodoRow(id) {
  var list = el('todo-list');
  var old = list.querySelector('.todo-row[data-id="' + id + '"]');
  var t = findTodo(id);
  if (!old || !t) return;

  var keptFocus = old.contains(document.activeElement);

  var next = buildTodoRow(t);
  next.classList.add('is-changed');

  old.parentNode.replaceChild(next, old);

  if (keptFocus) {
    var back = next.querySelector('[data-act="toggle-todo"]');
    if (back) back.focus({ preventScroll: true });
  }
}

/* ---------------------------------------------------------------- 增删的局部更新 */
/*
 * 新增 / 删除也走局部，而不是整页重画：这样新来的那一个能自己播一次入场动效，
 * 其余卡片纹丝不动，眼睛能直接跟到「刚加的是哪个」。
 */

function dropHabitNode(id) {
  var grid = el('habit-grid');
  var card = grid.querySelector('.habit-card[data-id="' + id + '"]');
  if (card) grid.removeChild(card);
}

function dropTodoNode(id) {
  var list = el('todo-list');
  var row = list.querySelector('.todo-row[data-id="' + id + '"]');
  if (row) list.removeChild(row);
}

/* ---------------------------------------------------------------- 勾选之后：这一条还该不该留在屏幕上 */

/*
 * 不处理这件事会出一个很刺眼的不一致：
 * 正筛着「未完成」，点一下把它做完了 —— 它明明已经不匹配当前筛选条件，
 * 却还赖在列表里。用户不会觉得「这是筛选的脾气」，只会觉得「筛选坏了」（确实坏了）。
 *
 * 所以勾完之后**按新的完成状态重新判一次**：
 *   还匹配 → 走 Day 11 那套局部替换（动效、焦点都保住）
 *   不匹配 → 摘掉节点，并补上区块的说明文字（可能是「今天的都做完了」）
 */
function syncHabitAfterToggle(id) {
  var h = findHabit(id);
  if (!h) return;
  if (habitVisible(h)) {
    refreshHabitCard(id);
  } else {
    dropHabitNode(id);
    syncBlockEmpty('habit', visibleHabits().length);
  }
}

function syncTodoAfterToggle(id) {
  var t = findTodo(id);
  if (!t) return;
  if (todoVisible(t)) {
    refreshTodoRow(id);
  } else {
    dropTodoNode(id);
    syncBlockEmpty('todo', visibleTodos().length);
  }
}

/* ==================== 七、加载（看板视图） ==================== */

/*
 * 进入看板视图：先摆出「加载中」，再读数据，按结果落到 成功 / 空 / 出错。
 *
 * 为什么要绕一次（afterPaint）：本地存储是同步读的，直接读、直接画的话，
 * 「加载中」这一帧会被浏览器合并掉 —— 屏幕上从来没出现过它。
 * 绕一次事件循环，加载态才是**真的存在过**的（自动化测试能断言到），
 * 也让第 3 周把数据换成网络请求时，这里的写法一行都不用改。
 */
function enterBoard() {
  setViewState('board', 'loading');

  afterPaint(function () {
    var data = loadData();

    /* 读不出来 → 出错状态。数据一条都没被动过，给个「重试」就行 */
    if (data === null) {
      setViewState('board', 'error');
      return;
    }

    state = data;

    /*
     * 每次进来（含点「重试」）都把筛选复位成「全部」。
     * 因为 filter 从来不落盘 —— 它是「我现在想看什么」，不是这个页面的设置项。
     */
    filter = 'all';
    syncFilterButtons();

    if (isBlank()) {
      setViewState('board', 'empty');
      return;
    }

    renderAll();
    setViewState('board', 'success');
  });
}

/* ==================== 八、写操作 ==================== */

/** 新建一条习惯（字段严格按 PRD 6.1，不增不减） */
function createHabit(name, freqType, freqCount) {
  var h = {
    id: newId('h'),
    name: name,
    freqType: freqType === 'weekly' ? 'weekly' : 'daily',
    freqCount: freqType === 'weekly' ? freqCount : 7,
    createdAt: todayStr(),
    doneDates: []
  };
  state.habits.push(h);
  return h;
}

/**
 * 新建习惯之后的收尾（落盘 + 渲染 + 提示）。
 *
 * 两种情况分开处理：
 *   · 本来在空状态 → 整页切过去（那时页面上还没有卡片网格可插）
 *   · 本来就有数据 → 只把新卡片追到末尾，别的卡片不动，新卡片自己播一次入场动效
 *
 * 落盘失败时不装作成功 —— 存不进去的改动，说了「已加上」反而是骗人的。
 */
function addHabit(name, freqType, freqCount) {
  var h = createHabit(name, freqType, freqCount);
  var ok = saveData();
  var switched = false;

  if (boardState === 'empty') {
    renderAll();
    setViewState('board', 'success');
  } else if (!habitVisible(h)) {
    /*
     * 当前筛选看不见这条（比如正筛着「已完成」，却新建了一个还没做的习惯）。
     * 这时**自动切回「全部」**，而不是悄悄加上却不显示 ——
     * 「点了保存，页面上什么都没有」会让人以为没存上，比让人多看一眼糟得多。
     */
    setFilter('all');
    switched = true;
  } else {
    var grid = el('habit-grid');
    var card = buildHabitCard(h);
    card.classList.add('is-changed');
    grid.appendChild(card);
    syncBlockEmpty('habit', visibleHabits().length);
    renderHints();
  }

  showToast(ok
    ? '已加上 · ' + h.name + (switched ? '（筛选已切回「全部」）' : '')
    : '没能存住：这次改动关掉浏览器就没了');
  return ok;
}

/** 勾 / 取消勾「今天」（T7：先落盘，再只换动过的那一张） */
function toggleHabitToday(id) {
  var h = findHabit(id);
  if (!h) return;
  if (!Array.isArray(h.doneDates)) h.doneDates = [];
  var t = todayStr();
  var i = h.doneDates.indexOf(t);
  var nowDone;

  if (i === -1) {
    h.doneDates.push(t);
    nowDone = true;
    feedGrowth();          // F6：变成「完成」才喂一口（取消勾不吐回去）
  } else {
    h.doneDates.splice(i, 1);
    nowDone = false;
  }

  var ok = saveData();
  syncHabitAfterToggle(id);
  renderHints();
  showToast(ok
    ? (nowDone ? '已标记完成 · ' : '已取消完成 · ') + h.name
    : '没能存住：这次改动关掉浏览器就没了');
}

function toggleTodo(id) {
  var t = findTodo(id);
  if (!t) return;
  t.done = !t.done;

  var ok = saveData();
  syncTodoAfterToggle(id);
  renderHints();
  showToast(ok
    ? (t.done ? '已标记完成 · ' : '已取消完成 · ') + t.text
    : '没能存住：这次改动关掉浏览器就没了');
}

/**
 * 一句话加待办（F3）：新的一条放最上面。
 * date = 今天，所以它出现在「今天的待办」里 —— 和今日页加的完全一样。
 */
function addTodo(text) {
  var v = String(text || '').trim();
  if (!v) return false;              /* 空的不允许提交（AC-7） */

  var t = {
    id: newId('t'),
    text: v,
    date: todayStr(),
    done: false
  };

  state.todos.unshift(t);

  var ok = saveData();
  var switched = false;

  if (boardState === 'empty') {
    renderAll();
    setViewState('board', 'success');
  } else if (!todoVisible(t)) {
    /* 同上：正筛着「已完成」时新加一条还没做的，看不见它 —— 切回「全部」让人看见 */
    setFilter('all');
    switched = true;
  } else {
    /* 插到最前面 —— 和上面 unshift 的顺序对上，否则页面顺序会和数据顺序打架 */
    var list = el('todo-list');
    var row = buildTodoRow(t);
    row.classList.add('is-changed');
    list.insertBefore(row, list.firstChild);
    syncBlockEmpty('todo', visibleTodos().length);
    renderHints();
  }

  showToast(ok
    ? '已加上 · ' + t.text + (switched ? '（筛选已切回「全部」）' : '')
    : '没能存住：这次改动关掉浏览器就没了');
  return ok;
}

/* ==================== 九、状态提示条 ==================== */

var toastTimer = null;

/**
 * 弹一条状态提示，2.6 秒后自己收起来。
 * 连续操作时重新计时、复用同一块地方 —— 不叠成好几条，也不排队等着播。
 */
function showToast(msg) {
  var t = el('toast');
  if (!t) return;

  t.textContent = msg;
  t.classList.remove('is-show');
  void t.offsetWidth;              /* 重启动画：连点时也能再弹一下，而不是「第二次没反应」 */
  t.classList.add('is-show');

  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(function () {
    t.classList.remove('is-show');
  }, 2600);
}

/* ==================== 十、新建习惯弹层 ==================== */

function syncFreqField() {
  el('freq-count-field').hidden = el('habit-freq').value !== 'weekly';
}

function openHabitForm() {
  el('habit-name').value = '';
  el('habit-freq').value = 'daily';
  el('habit-freq-count').value = 3;
  el('habit-form-error').hidden = true;

  syncFreqField();
  el('habit-mask').hidden = false;
  el('habit-name').focus();
}

function closeHabitForm() {
  el('habit-mask').hidden = true;
}

/** 只填名称就能存（AC-8：频率有默认值，不改也能存） */
function saveHabitForm() {
  var name = el('habit-name').value.trim();
  if (!name) {
    var box = el('habit-form-error');
    box.textContent = '名称得填一下，频率不改也行。';
    box.hidden = false;
    el('habit-name').focus();
    return;
  }

  var freqType = el('habit-freq').value === 'weekly' ? 'weekly' : 'daily';
  var freqCount = 7;
  if (freqType === 'weekly') {
    freqCount = Number(el('habit-freq-count').value) || 3;
    if (freqCount < 1) freqCount = 1;
    if (freqCount > 7) freqCount = 7;
  }

  closeHabitForm();
  addHabit(name, freqType, freqCount);
}

/* ==================== 十一、删除二次确认（AC-12 / AC-15） ==================== */

/*
 * 习惯和待办共用同一个确认弹层，只有文案不同。
 * 共用的好处：确认这一步的交互只有一种，用户不用学两遍。
 */
var pendingDelete = null;

function askDelete(type, id) {
  var title = el('confirm-title');
  var text = el('confirm-text');

  if (type === 'habit') {
    var h = findHabit(id);
    if (!h) return;
    title.textContent = '删除这个习惯？';
    text.textContent = '「' + h.name + '」和它的完成记录会一起没了，找不回来。';
  } else {
    var t = findTodo(id);
    if (!t) return;
    title.textContent = '删除这条待办？';
    text.textContent = '「' + t.text + '」删掉之后找不回来。';
  }

  pendingDelete = { type: type, id: id };
  el('confirm-mask').hidden = false;

  /* 焦点给「取消」而不是「删除」：这一步的目的就是防误删，别让回车直接删掉 */
  el('confirm-cancel').focus();
}

function closeConfirm() {
  el('confirm-mask').hidden = true;
  pendingDelete = null;
}

function runDelete() {
  if (!pendingDelete) return;

  var p = pendingDelete;
  closeConfirm();

  var label = '';

  if (p.type === 'habit') {
    var h = findHabit(p.id);
    if (!h) return;
    label = h.name;
    state.habits = state.habits.filter(function (x) { return x.id !== p.id; });
  } else {
    var t = findTodo(p.id);
    if (!t) return;
    label = t.text;
    state.todos = state.todos.filter(function (x) { return x.id !== p.id; });
  }

  var ok = saveData();

  /*
   * 在「习惯详情」那一屏里删的：删完这一屏就没内容了，退回看板。
   * 退的时候是改 hash（而不是直接切显示）—— 地址栏、浏览器返回键、
   * 前进后退记录就全都一致了，这正是用 hash 路由白拿的好处。
   */
  if (p.type === 'habit' && currentView === 'habit') {
    location.hash = '#/board';
    showToast(ok ? ('已删除 · ' + label) : '没能存住：这次改动关掉浏览器就没了');
    return;
  }

  /*
   * 先把节点从页面上摘掉，再决定显示哪种状态。
   * 顺序反过来的话，删光最后一条时会先切到空状态 —— 那个被隐藏的区块里
   * 就留着一个「已经删掉、却还在 DOM 里」的卡片（眼睛看不见，但它确实在）。
   */
  if (p.type === 'habit') dropHabitNode(p.id);
  else dropTodoNode(p.id);

  if (isBlank()) {
    setViewState('board', 'empty');  /* 全删光了 → 回到空状态 */
  } else {
    /* 删掉的可能正好是筛出来的最后一条 → 补上区块的说明文字，别留一片空白 */
    syncBlockEmpty('habit', visibleHabits().length);
    syncBlockEmpty('todo', visibleTodos().length);
    renderHints();
  }

  showToast(ok ? ('已删除 · ' + label) : '没能存住：这次改动关掉浏览器就没了');
}

/* ==================== 十二、绑定事件 ==================== */

/*
 * 筛选条：点哪个按钮就按哪个筛。
 * 用 <button> 而不是自己画一排 div，键盘那部分是白拿的 ——
 * Tab 能走到、Enter / 空格按得下去、焦点环由 :focus-visible 统一给。
 */
el('filter-bar').addEventListener('click', function (ev) {
  var btn = ev.target.closest('.filter-btn');
  if (!btn) return;
  setFilter(btn.dataset.filter);
});

/* 习惯卡片：点勾选圈 = 切换今天；点「删除」= 先问一遍 */
el('habit-grid').addEventListener('click', function (ev) {
  var btn = ev.target.closest('[data-act]');
  if (!btn) return;
  var card = btn.closest('.habit-card');
  if (!card) return;

  if (btn.dataset.act === 'toggle-habit') toggleHabitToday(card.dataset.id);
  else if (btn.dataset.act === 'del-habit') askDelete('habit', card.dataset.id);
});

/* 待办行：点勾选框 = 切换完成；点 × = 先问一遍 */
el('todo-list').addEventListener('click', function (ev) {
  var btn = ev.target.closest('[data-act]');
  if (!btn) return;
  var row = btn.closest('.todo-row');
  if (!row) return;

  if (btn.dataset.act === 'toggle-todo') toggleTodo(row.dataset.id);
  else if (btn.dataset.act === 'del-todo') askDelete('todo', row.dataset.id);
});

/* 底部输入框：回车 / 点「加」 */
el('todo-form').addEventListener('submit', function (ev) {
  ev.preventDefault();
  var input = el('todo-input');
  if (addTodo(input.value)) input.value = '';
  input.focus();
});

/* 两个「新建习惯」入口：区块标题旁边那个 + 空状态里那个 */
el('btn-new-habit').addEventListener('click', openHabitForm);
el('btn-empty-new-habit').addEventListener('click', openHabitForm);

/* 空状态里的示例习惯：只加「早睡」一条，待办一条都不加 */
el('btn-example-habit').addEventListener('click', function () {
  addHabit('早睡', 'daily', 7);
});

/* 新建习惯弹层 */
el('habit-freq').addEventListener('change', syncFreqField);
el('habit-cancel').addEventListener('click', closeHabitForm);
el('habit-save').addEventListener('click', saveHabitForm);

/* 表单里按回车＝保存 */
el('habit-mask').addEventListener('keydown', function (ev) {
  if (ev.key === 'Enter') {
    ev.preventDefault();
    saveHabitForm();
  }
});

/* 删除确认弹层 */
el('confirm-cancel').addEventListener('click', closeConfirm);
el('confirm-ok').addEventListener('click', runDelete);

/* 读不出来时的重试 */
el('btn-retry').addEventListener('click', enterBoard);

/* ==================== 十三、弹层的通用关闭方式 ==================== */

el('habit-mask').addEventListener('click', function (ev) {
  if (ev.target === this) closeHabitForm();
});

el('confirm-mask').addEventListener('click', function (ev) {
  if (ev.target === this) closeConfirm();
});

/* 按 Esc 关最上面那个弹层 */
document.addEventListener('keydown', function (ev) {
  if (ev.key !== 'Escape') return;
  if (!el('habit-mask').hidden) { closeHabitForm(); return; }
  if (!el('confirm-mask').hidden) { closeConfirm(); return; }
});

/* ==================== 十四、视图路由（Day 13） ==================== */

/*
 * 问题：三个视图之间怎么切？
 *
 * 摆过四条路，只留下最后一条 —— 因为前三条都被本项目的硬约束挡掉了：
 *
 *   ① 路由库（React Router 那一类）
 *      ✗ 要跑构建。而 AC-1 是「双击 index.html 就能开」，T2 又禁止 ES Module
 *        （file:// 下会被跨域拦成白屏）—— 连加载都加载不起来。
 *   ② History API（pushState / replaceState）
 *      ✗ **file:// 协议下浏览器直接抛 SecurityError**。URL 是好看，
 *        可一放到本地文件上整个坏掉，等于放弃 AC-1。
 *   ③ 纯 JS 显示 / 隐藏，地址栏不动
 *      ✓ 能用，但地址栏永远是那副样子：刷新回默认视图、不能收藏到具体一屏、
 *        浏览器返回键退不回去。这是训练营给的「卡住时的降级方案」，能不用就不用。
 *   ④ hash 路由（← 选它）
 *      ✓ file:// 和 localhost 都能用（改 # 不触发跨域限制）
 *      ✓ 零依赖 —— hashchange 是浏览器原生事件，一行库都不用引
 *      ✓ 地址栏会跟着变 → 能收藏、能分享，**浏览器自带的前进 / 后退立刻可用**
 *      ✓ 训练营那句「够用就好」：我们要的只是「切视图 + 能回退」，
 *        这点需求不值得背上一个路由库
 *
 * 还有一个白拿的好处：**深链接**。把 #/habit/xxx 直接贴进地址栏回车，
 * 一进来就是那个习惯的详情页，不用先走看板再点卡片。
 */

var VIEWS = ['board', 'habit', 'states'];
var currentView = 'board';

/* 习惯详情视图里正在看的那个习惯 */
var detailHabitId = null;

/**
 * 把地址栏里的 hash 翻译成「现在该看哪个视图」。
 * 认不出的 hash **一律回看板**，而不是留一屏空白 —— 白屏是最难排查的一种坏。
 */
function parseRoute() {
  var raw = String(location.hash || '').replace(/^#\/?/, '');   /* "#/habit/h_x" → "habit/h_x" */
  if (!raw) return { name: 'board', param: '' };

  var parts = raw.split('/');
  var name = parts[0];
  var param = parts.slice(1).join('/');

  if (name === 'habit' && param) return { name: 'habit', param: decodeURIComponent(param) };
  if (name === 'states') return { name: 'states', param: '' };
  return { name: 'board', param: '' };
}

/** 当前视图高亮：眼睛靠底线 + 加粗，读屏软件靠 aria-current，两边都有说法 */
function syncNav(name) {
  var links = document.querySelectorAll('.nav-link[data-nav]');
  for (var i = 0; i < links.length; i++) {
    if (links[i].dataset.nav === name) links[i].setAttribute('aria-current', 'page');
    else links[i].removeAttribute('aria-current');
  }
}

/**
 * 换一屏：三个视图都躺在 DOM 里，这里只决定谁露脸。
 * 不重建页面，所以滚动位置、填了一半的表单都不会被冲掉。
 */
function showView(name) {
  VIEWS.forEach(function (v) {
    var node = el('view-' + v);
    if (node) node.hidden = (v !== name);
  });

  /* 底部「一句话加待办」只属于看板。别的视图里它没有意义，留着只会误导 */
  el('todo-form').hidden = (name !== 'board');

  syncNav(name);
  currentView = name;
  window.scrollTo(0, 0);
}

/** 等这一帧画完再干活 —— 让「加载中」真的被画到屏幕上过，而不是被浏览器合并掉 */
function afterPaint(fn) {
  requestAnimationFrame(function () { setTimeout(fn, 0); });
}

/** 进入「习惯详情」：三种结果 —— 有记录 / 一次都没完成过 / 找不到（出错） */
function enterHabit(id) {
  detailHabitId = id;
  setViewState('habit', 'loading');

  afterPaint(function () {
    var data = loadData();

    /* 存储读不出来 → 出错。和看板那屏的「读不出」是同一件事，文案分开说 */
    if (data === null) {
      el('hd-error-title').textContent = '读不出本地数据';
      el('hd-error-text').textContent =
        '浏览器可能禁用了本地存储（比如无痕模式）。数据一条都没被改动，回看板重试一下就行。';
      setViewState('habit', 'error');
      return;
    }
    state = data;

    /* 找不到这个习惯 → 也是出错。最常见的原因：这条链接是旧的，习惯已经被删了 */
    var h = findHabit(id);
    if (!h) {
      el('hd-error-title').textContent = '找不到这个习惯';
      el('hd-error-text').textContent = '它可能已经被删掉了，或者这条地址是旧的。';
      setViewState('habit', 'error');
      return;
    }

    var done = Array.isArray(h.doneDates) ? h.doneDates : [];

    /*
     * 这里的「空」= 习惯在、但一次都还没完成过。
     * 它和「找不到」必须分开说 —— 前者是「还没开始」，后者是「出事了」；
     * 混成一句会让人以为记录丢了（守设计原则 1：不制造惩罚性反馈）。
     */
    if (done.length === 0) {
      el('hd-empty-text').textContent =
        '「' + h.name + '」还没有勾过任何一天。回看板给它勾一个，这里就有格子亮起来了。';
      setViewState('habit', 'empty');
      return;
    }

    renderHabitDetail(h);
    /*
     * 顶栏那句「今天已完成 N / M 件」是全局的，不该跟着视图变。
     * 进详情页时也读了一遍数据，这里补算一次 ——
     * 否则「直接深链接打开详情页」会一直卡在「0 / 0」，看着像数据丢了。
     */
    renderHints();
    setViewState('habit', 'success');
  });
}

/** 把某个习惯铺进详情视图（28 天格子 + 本周强度） */
function renderHabitDetail(h) {
  var done = Array.isArray(h.doneDates) ? h.doneDates : [];
  var s = calcStrength(h);
  var today = todayStr();

  el('hd-name').textContent = h.name;
  el('hd-freq').textContent = freqText(h);
  el('hd-strength').textContent = s.text;
  el('hd-bar').style.width = s.percent + '%';

  var grid = el('hd-grid');
  grid.textContent = '';

  build28Dates().forEach(function (d) {
    var on = done.indexOf(d) !== -1;
    var future = d > today;         /* ISO 格式的日期串可以直接比大小 */
    var cell = document.createElement('div');
    cell.className = 'gcell'
      + (on ? ' on' : '')
      + (future ? ' future' : '')
      + (d === today ? ' today' : '');
    cell.textContent = parseDate(d).getDate();
    cell.title = humanDate(d) + (future ? '：还没到' : (on ? '：已完成' : '：没做'));
    grid.appendChild(cell);
  });
}

/** 进入「状态自查」：四种状态并排，给验收和截图看的一屏 */
function enterStates() {
  /*
   * 顶栏那句「今天已完成 N / M 件」是全局的，四个视图里都该是真的。
   * 这里只**读**一次存储、只更新那几个数字，一个字节都不写回去 ——
   * 页面里展示的内容仍然全是固定样例。
   */
  var data = loadData();
  if (data) {
    state = data;
    renderHints();
  }

  renderStatesDemo();
}

var demoBuilt = false;

/*
 * 用一份固定样例，调**真实的组件函数**（buildHabitCard / buildTodoRow）拼出来 ——
 * 所以这一屏看到的样子，就是真实视图里的样子，不会出现「说明书和实物不一致」。
 * 注意：只读不写，完全不碰 localStorage —— 验收用的东西不该动用户的数据。
 */
function renderStatesDemo() {
  if (demoBuilt) return;
  demoBuilt = true;

  var box = el('demo-success');
  if (!box) return;

  var t = todayStr();
  box.appendChild(buildHabitCard({
    id: 'demo_habit',
    name: '早睡',
    freqType: 'daily',
    freqCount: 7,
    createdAt: t,
    doneDates: [t, shiftDate(t, -1), shiftDate(t, -2), shiftDate(t, -4)]
  }, { link: false }));   /* 示例卡片不是真习惯，名字不做成链接 —— 点了会撞进「找不到」 */

  box.appendChild(buildTodoRow({
    id: 'demo_todo',
    text: '给绿萝浇水',
    date: t,
    done: true
  }));
}

/** 路由总入口：地址栏一变就重跑（首次打开也跑一次） */
function renderRoute() {
  var r = parseRoute();
  showView(r.name);

  if (r.name === 'habit') enterHabit(r.param);
  else if (r.name === 'states') enterStates();
  else enterBoard();
}

/* ==================== 启动 ==================== */

el('today-date').textContent = humanDate(todayStr());

/* 详情页里的「删除这个习惯」 */
el('hd-delete').addEventListener('click', function () {
  if (detailHabitId) askDelete('habit', detailHabitId);
});

/* 地址栏的 hash 一变就换视图 —— 点导航 / 按浏览器返回键 / 手敲地址，走的都是这一条路 */
window.addEventListener('hashchange', renderRoute);

renderRoute();
