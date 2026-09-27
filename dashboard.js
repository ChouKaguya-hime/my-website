/* ==========================================================================
   习惯看板 · 主视图逻辑（Day 12｜第 2 周）
   --------------------------------------------------------------------------
   这一版把 Day 8 的「本地假数据」换成了**真实的浏览器本地存储**。

   ⭐ 最关键的一件事：它和今日页（app.js）读写的是
      **同一个存储键 + 同一套字段**（PRD 第 6.1 节）。
      在今日页加的习惯和待办，刷新这个页面就能看到；反过来也一样。
      两个视图，一份数据 —— 这是本次改动的全部意义。

   结构（Day 8 搭的那三层原样保留，只把最底下取数据的地方换掉了）：

       存储层 loadData / saveData  →  渲染 render*()  →  状态机 setState()

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
    if (!raw) return { habits: [], todos: [] };

    var obj = JSON.parse(raw);
    if (!obj || typeof obj !== 'object') return null;

    return {
      habits: Array.isArray(obj.habits) ? obj.habits : [],
      todos: Array.isArray(obj.todos) ? obj.todos : []
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

/* ==================== 四、状态机 ==================== */

/*
 * 页面有这几种状态，任何时刻只显示其中一种。
 *
 * 关于 loading（骨架屏）：本地存储是同步读的，所以它在真实数据下几乎不会被看到。
 * 保留它是因为第 3 周接上真实接口后，读数据会变成真的「要等」，那时它就是活的。
 * error 则是有真实触发条件的：浏览器禁用了本地存储，或者存的内容已经不是合法 JSON。
 */
var STATES = ['loading', 'success', 'empty', 'error'];
var currentState = 'loading';

function setState(name) {
  currentState = name;
  STATES.forEach(function (s) {
    el('state-' + s).hidden = (s !== name);
  });
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
function buildHabitCard(h) {
  var s = calcStrength(h);
  var done = Array.isArray(h.doneDates) ? h.doneDates : [];
  var doneToday = isDoneToday(h);

  var card = document.createElement('article');
  card.className = 'habit-card' + (doneToday ? ' is-done' : '');
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

/* ==================== 七、加载 ==================== */

function load() {
  var data = loadData();

  /* 读不出来 → 出错状态。数据一条都没被动过，给个「重试」就行 */
  if (data === null) {
    setState('error');
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
    setState('empty');
    return;
  }

  renderAll();
  setState('success');
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

  if (currentState === 'empty') {
    renderAll();
    setState('success');
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

  if (currentState === 'empty') {
    renderAll();
    setState('success');
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
   * 先把节点从页面上摘掉，再决定显示哪种状态。
   * 顺序反过来的话，删光最后一条时会先切到空状态 —— 那个被隐藏的区块里
   * 就留着一个「已经删掉、却还在 DOM 里」的卡片（眼睛看不见，但它确实在）。
   */
  if (p.type === 'habit') dropHabitNode(p.id);
  else dropTodoNode(p.id);

  if (isBlank()) {
    setState('empty');               /* 全删光了 → 回到空状态 */
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
el('btn-retry').addEventListener('click', load);

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

/* ==================== 启动 ==================== */

el('today-date').textContent = humanDate(todayStr());
load();
