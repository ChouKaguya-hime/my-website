/* ==========================================================================
   习惯养成规划板 · 逻辑
   技术路线：原生 JS + 浏览器本地存储（TECH_DESIGN 第 2 节）
   必须守的硬约束：
     T1 不引任何外部资源        T2 不用 ES Module（不用 import / export）
     T3 不依赖构建              T4 全部用相对路径
     T7 每次数据改动后立刻写回存储，然后重画页面
     T8 不用 fetch 读本地文件
   ========================================================================== */

/* ============================ 一、存储层 ============================ */

/* 存储键带版本号：以后字段变了，靠版本号区分新旧数据（TECH_DESIGN 4 节） */
var STORAGE_KEY = 'habit-board/v1';

/**
 * 从本地存储读出数据。
 * 任何异常（没存过 / 内容坏了 / 隐私模式禁止）都退回空数据，绝不让页面崩掉。
 */
function loadData() {
  var empty = { habits: [], todos: [], growth: null };
  try {
    var raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return empty;
    var obj = JSON.parse(raw);
    if (!obj || typeof obj !== 'object') return empty;
    return {
      habits: Array.isArray(obj.habits) ? obj.habits : [],
      todos: Array.isArray(obj.todos) ? obj.todos : [],
      /* 成长物（F6）：老数据里没这个字段 → 给 null，由 growthState() 补默认值 */
      growth: (obj.growth && typeof obj.growth === 'object') ? obj.growth : null
    };
  } catch (e) {
    return empty;
  }
}

function saveData() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    /* 存不进去（容量满 / 隐私模式）时页面仍然可用，只是这次改动留不住 */
  }
}

var state = loadData();

/** 改完数据统一走这里：先落盘，再重画（T7） */
function commit() {
  saveData();
  render();
}

/* ==================== Day 24：把改动推回库 ==================== */

/*
 * 今天修的 Bug：在今日页上新建 / 编辑 / 删除习惯，**刷新之后全白做**。
 *
 *   复现：在页面上加一个习惯 → 刷新 → 没了。
 *   定位：这几步只写了浏览器本机（localStorage），**一个写请求都没发**；
 *         而页面一打开，cloud.js 的 sync 又会拿云端那份把本机覆盖掉 —— 改动就这么消失了。
 *        （排除掉的原因：不是网断了——GET 全是 200；不是库里数据坏了——库好着；
 *          不是页面没渲染——页面上当时确实显示了。真因只有一个：**改动没回库**。）
 *   修复：本机照旧先落盘、先重画（秒开、断网也能用），随后异步把这次改动推回库。
 *
 * 一条铁规矩：**不许假成功**。推不上去必须说出来（右上角那个小标 + 一行控制台），
 * 不能出现「页面看着存好了、其实库里没有」—— 那正是契约 §4.4 一直在防的事。
 */

function cloudReady() {
  return !!window.HabitBoardCloud;
}

/** 把「数据来源」那个小标改成「没同步上云端」，别让人以为存好了 */
function markUnsynced(detail) {
  console.warn('[写回库失败] ' + detail);

  var box = el('data-source');
  if (!box) return;
  box.title = '这次改动只存在本机：' + detail;
  /* 本来就在「本机数据」模式下（比如用 file:// 直接打开）：那行小字已经说明白了，不必再改 */
  if (cloudReady() && window.HabitBoardCloud.source === 'cloud') {
    box.textContent = '没同步上云端';
    box.className = 'data-source';
    box.hidden = false;
  }
}

/** 推一次写请求。res 是 cloud.js 里那个统一形状：成功静默，失败说话 */
function afterPush(p, what) {
  if (!p || !p.then) return;
  p.then(function (res) {
    if (res && res.ok) return;
    markUnsynced(what + '：' + ((res && (res.message || res.netError)) || '未知原因'));
  });
}

/** 用服务端那条替换本机那条（新建之后 id 以服务端为准，契约 §3.8） */
function replaceHabit(oldId, fresh) {
  for (var i = 0; i < state.habits.length; i++) {
    if (state.habits[i].id === oldId) {
      state.habits[i] = fresh;
      return true;
    }
  }
  return false;
}

function newId(prefix) {
  return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

/* ============================ 二、日期工具 ============================ */

/*
 * 为什么不直接用 new Date('2026-09-22')？
 * 那样会被当成 UTC 午夜解析，东八区下算出来差一天。
 * 所以一律用手动构造的本地日期（TECH_DESIGN 第 7 节已经点过这个坑）。
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

/** 把日期字符串往前/往后挪 n 天 */
function shiftDate(s, n) {
  var d = parseDate(s);
  d.setDate(d.getDate() + n);
  return fmtDate(d);
}

/** 取最近 n 天（含今天），从最早排到今天 */
function lastNDays(n, endStr) {
  var end = endStr || todayStr();
  var out = [];
  for (var i = n - 1; i >= 0; i--) {
    out.push(shiftDate(end, -i));
  }
  return out;
}

/** 「9月22日 周二」这种给人看的写法 */
function humanDate(s) {
  var d = parseDate(s);
  return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + WEEK_CN[d.getDay()];
}

/* ======================= 三、本周强度（PRD 6.2） ======================= */

/*
 * 本周强度 = 最近 7 天内「完成的天数」÷「应该完成的天数」× 100%
 *   · 每天型（daily）：分母 = 7
 *   · 每周 N 次型（weekly）：分母 = N，算出来超过 100% 也按 100%
 *   · 最近 7 天一次都没完成 → 显示「—」而不是 0%
 *     「—」的意思是「还没开始」，不是「没做到」——这是设计原则 1 的直接落点
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

/*
 * 详情弹层专用：把两个口径都说成人话（Day 14 第 5 条的回补）。
 * 用户问的是「最近一个月坚持得怎么样」，原来只答「本周强度 29%」——
 * 口径不对，而且 29% 没说是「什么的 29%」。这里修成：
 *   · 最近 28 天 → 「12/24 天」（数天数；每周 N 次型也成立，不会被「分母该是几」绕进去）
 *   · 最近 7 天  → 「3/7 天 · 43%」（补上分子分母，%不再是光秃秃一个数）
 * 28 天窗口和下面的格子用同一个 build28Dates()，数字和图不会两张嘴。
 */
function strengthDetail(h) {
  var done = Array.isArray(h.doneDates) ? h.doneDates : [];

  var win = lastNDays(7);
  var hit7 = 0;
  for (var i = 0; i < win.length; i++) {
    if (done.indexOf(win[i]) !== -1) hit7++;
  }
  var denom = h.freqType === 'weekly'
    ? Math.max(1, Number(h.freqCount) || 1)
    : 7;
  var s = calcStrength(h);
  var text7 = (hit7 === 0) ? '—' : hit7 + '/' + denom + ' 天 · ' + s.text;

  var d28 = build28Dates();
  var today = todayStr();
  var done28 = 0, elapsed28 = 0;
  for (var j = 0; j < d28.length; j++) {
    if (d28[j] > today) continue;          // 没到的日子不算进分母
    elapsed28++;
    if (done.indexOf(d28[j]) !== -1) done28++;
  }
  return { text7: text7, days28: done28 + '/' + elapsed28 + ' 天' };
}

function isHabitDoneToday(habit) {
  return Array.isArray(habit.doneDates) && habit.doneDates.indexOf(todayStr()) !== -1;
}

/* 「今天该做哪些习惯」（PRD 6.3）：
   每天型每天都出现；每周 N 次型也每天都出现，不指定星期几。
   所以今天出现的习惯 = 全部习惯。 */
function habitsToday() {
  return state.habits.slice();
}

function todosToday() {
  var t = todayStr();
  return state.todos.filter(function (x) { return x.date === t; });
}

/* ======================= 三·五、成长物（F6，PRD v1.3） ======================= */

/*
 * 一株跟着打卡长的小苗。
 * 规则（PRD 第 4 节 F6）：每完成一个习惯长一格，**当天最多一格**；
 * 攒满 7 格开一朵花，花进「花架」只增不减；一天没喂不枯、不掉、不清空（设计原则 1）。
 * 数据并进同一个存储键，**不新增存储键**。
 */

var GROWTH_FULL = 7;
var GROWTH_COLORS = ['#d4537e', '#ef9f27', '#7f77dd', '#d85a30'];

/** 取成长物状态；老数据没这个字段就补一份默认的（不单独写盘，下次 commit 一起存） */
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

/**
 * 完成了一个习惯 → 喂一口。
 * 当天只长一格；攒满 7 格就开一朵花（4 种颜色里随机），然后下一格从头长。
 */
function feedGrowth() {
  var g = growthState();
  var t = todayStr();
  if (g.fedDate === t) return;          // 今天已经长过了 —— 一天最多一格
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

  /* 一个习惯都还没有时不占地方 —— 那时页面已经在引导「先加一个试试」了 */
  if (state.habits.length === 0) { bar.hidden = true; return; }
  bar.hidden = false;

  var g = growthState();
  var i;

  /* 7 片叶子：长出来的绿、还没长到的灰 */
  var leaves = el('growth-leaves');
  leaves.innerHTML = '';
  for (i = 1; i <= GROWTH_FULL; i++) {
    var leaf = document.createElement('i');
    leaf.className = 'growth-leaf' + (i <= g.progress ? ' on' : '');
    leaves.appendChild(leaf);
  }

  /* 一句话 */
  var text = el('growth-text');
  if (g.progress === 0) {
    text.textContent = g.flowers.length > 0
      ? '新的一轮 —— 它又从头冒出来了'
      : '还没喂过 —— 它在土里等着';
  } else {
    text.textContent = '这轮喂了 ' + g.progress + ' 口，长到第 ' + g.progress + ' 格';
  }

  /* 花架：只增不减 */
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

/* ============================ 四、渲染 ============================ */

function el(id) {
  return document.getElementById(id);
}

function renderTodayBar() {
  var t = todayStr();
  el('today-date').textContent = humanDate(t);

  var habits = habitsToday();
  var todos = todosToday();

  var total = habits.length + todos.length;
  var doneCount = 0;
  for (var i = 0; i < habits.length; i++) {
    if (isHabitDoneToday(habits[i])) doneCount++;
  }
  for (var j = 0; j < todos.length; j++) {
    if (todos[j].done) doneCount++;
  }

  el('today-count').textContent = doneCount + ' / ' + total;
}

/** 造一排小格子：最近 7 天，完成=实心 */
function buildCells7(habit) {
  var wrap = document.createElement('span');
  wrap.className = 'cells7';

  /*
   * ★ Day 27 修复（Day 14 一位真人留下的卡点，一直开着没修）
   *
   * 这一排格子看着很像「最近几天做了什么」，人也一定会去点它 ——
   * 想补记昨天，就点昨天那一格，这是最自然的动作。
   *
   * 可它以前**不带 data-act**，而卡片上的点击是靠事件委托找 [data-act] 的（见文件末尾），
   * 所以点下去一声不响 —— 用户会以为「坏了 / 点错了」。
   * Day 14 真人的原话就是：「补记入口不明显，并未明显暴露」。
   *
   * 现在把它接到「打开详情」上：点这排格子 = 打开这个习惯的详情弹层，
   * 里面那 28 格才是真正的补记入口（点过去的格子可以补勾）。
   * 它只负责**带路**，不直接改数据 —— 免得手一抖就把记录改了。
   */
  wrap.dataset.act = 'open-detail';
  wrap.setAttribute('role', 'button');
  wrap.setAttribute('tabindex', '0');
  wrap.setAttribute('aria-label', '查看「' + habit.name + '」详情，可以补记过去的日子');
  wrap.title = '点开看详情，可以补勾过去的日子';

  var done = Array.isArray(habit.doneDates) ? habit.doneDates : [];
  lastNDays(7).forEach(function (d) {
    var c = document.createElement('i');
    c.className = 'cell' + (done.indexOf(d) !== -1 ? ' on' : '');
    wrap.appendChild(c);
  });
  return wrap;
}

/*
 * 卡片上「频率」那一行。
 * ⚠️ 这句话必须和看板（dashboard.js 的 freqText）一字不差 ——
 *    同一个习惯，两个页面得说出同一句话。
 */
function freqText(h) {
  if (h.freqType === 'weekly') return '每周 ' + (h.freqCount || 1) + ' 次';
  return '每天';
}

/*
 * 拼出一张习惯卡片（Day 24）。
 * 形状照着看板的 buildHabitCard 来：
 *   名称 / 勾选圈 / 频率 / 本周强度 / 强度条 / 最近 7 天 / 删除
 *
 * 为什么改：原来这里是一行行文字（名字 + 强度 + 7 格 + 圈），看板却是卡片 ——
 * 同一件事在两个页面长得不一样，说不过去。现在两页同一套。
 * 名字仍是 <button>：点开详情弹层，跟改版前一样；删除也仍是「先弹确认再删」。
 */
function buildHabitCard(h) {
  var s = calcStrength(h);
  var doneToday = isHabitDoneToday(h);

  var card = document.createElement('li');
  card.className = 'habit-card' + (doneToday ? ' is-done' : '');
  card.dataset.id = h.id;
  card.dataset.strength = s.text === '—' ? 'none' : 'has';

  var top = document.createElement('div');
  top.className = 'card-top';

  var name = document.createElement('button');
  name.type = 'button';
  name.className = 'card-name';
  name.dataset.act = 'open-detail';
  name.textContent = h.name;
  name.title = '点开看详情';

  var check = document.createElement('button');
  check.type = 'button';
  check.className = 'check';
  check.dataset.act = 'toggle-habit';
  /* aria-pressed：把「开关是开还是关」直接告诉读屏软件，不用猜 */
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

  /* 删除放在卡片最下面、颜色压淡：右上角是每天要点很多次的地方，别在那儿贴删除 */
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
  card.appendChild(buildCells7(h));
  card.appendChild(foot);
  return card;
}

function renderHabits() {
  var list = el('habit-list');
  var emptyBox = el('habit-empty');
  var habits = habitsToday();

  list.textContent = '';
  emptyBox.hidden = habits.length > 0;

  habits.forEach(function (h) {
    list.appendChild(buildHabitCard(h));
  });
}

/*
 * 拼出一条待办行：勾选框 + 一句话 + 行尾删除（PRD F3）。
 * 单独抽成一个函数，好处是看板那边也是同一个形状（buildTodoRow），
 * 两页的待办行长什么样、有哪些按钮，一眼能对上。
 */
function buildTodoRow(t) {
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

  /* Day 14 新增：行尾删除。点它只弹确认，不直接删（AC-15） */
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

function renderTodos() {
  var list = el('todo-list');
  var emptyBox = el('todo-empty');
  var todos = todosToday();

  list.textContent = '';
  emptyBox.hidden = todos.length > 0;

  todos.forEach(function (t) {
    list.appendChild(buildTodoRow(t));
  });
}

function render() {
  renderTodayBar();
  renderGrowth();          /* F6：成长物 */
  renderHabits();
  renderTodos();
}

/* ============================ 五、动作 ============================ */

function findHabit(id) {
  for (var i = 0; i < state.habits.length; i++) {
    if (state.habits[i].id === id) return state.habits[i];
  }
  return null;
}

/* Day 14 补：删待办要用（看板里早就有，今日页一直缺，见 PRD F3 / AC-15） */
function findTodo(id) {
  for (var i = 0; i < state.todos.length; i++) {
    if (state.todos[i].id === id) return state.todos[i];
  }
  return null;
}

/** 勾 / 取消勾「今天」 */
function toggleHabitToday(id) {
  var h = findHabit(id);
  if (!h) return;
  if (!Array.isArray(h.doneDates)) h.doneDates = [];
  var t = todayStr();
  var i = h.doneDates.indexOf(t);
  if (i === -1) {
    h.doneDates.push(t);
    feedGrowth();          // F6：变成「完成」才喂一口（取消勾不吐回去）
  } else {
    h.doneDates.splice(i, 1);
  }
  commit();
}

function toggleTodo(id) {
  for (var i = 0; i < state.todos.length; i++) {
    if (state.todos[i].id === id) {
      state.todos[i].done = !state.todos[i].done;
      break;
    }
  }
  commit();
}

/** 一句话加待办：新的一条放在最上面（F3） */
function addTodo(text) {
  var v = String(text || '').trim();
  if (!v) return false;            // 空的不允许提交（AC-7）
  state.todos.unshift({
    id: newId('t'),
    text: v,
    date: todayStr(),
    done: false
  });
  commit();
  return true;
}

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

/* ============================ 六、绑定事件 ============================ */

/* 习惯卡片：点名字开详情，点圆圈勾今天，点「删除」走二次确认（Day 24 加的第三个动作） */
el('habit-list').addEventListener('click', function (ev) {
  var btn = ev.target.closest('[data-act]');
  if (!btn) return;
  var row = btn.closest('.habit-card');
  if (!row) return;
  var id = row.dataset.id;

  if (btn.dataset.act === 'toggle-habit') {
    toggleHabitToday(id);
  } else if (btn.dataset.act === 'open-detail') {
    if (typeof openDetail === 'function') openDetail(id);
  } else if (btn.dataset.act === 'del-habit') {
    askDelete('habit', id);
  }
});

/*
 * Day 27：那排 7 格是 <span role="button">（不是真的 <button>），
 * 键盘 Tab 能聚焦，但回车 / 空格不会自己触发 click —— 这里补上。
 * 只对「不是 BUTTON 的委托目标」生效，免得和 <button> 的默认行为叠起来触发两次。
 */
el('habit-list').addEventListener('keydown', function (ev) {
  if (ev.key !== 'Enter' && ev.key !== ' ') return;
  var target = ev.target.closest('[data-act]');
  if (!target || target.tagName === 'BUTTON') return;
  ev.preventDefault();
  target.click();
});

/* 待办列表：点勾选框切换完成，点行尾 × 走删除确认（Day 14 补上后者） */
el('todo-list').addEventListener('click', function (ev) {
  var btn = ev.target.closest('[data-act]');
  if (!btn) return;
  var row = btn.closest('.todo-row');
  if (!row) return;

  if (btn.dataset.act === 'toggle-todo') {
    toggleTodo(row.dataset.id);
  } else if (btn.dataset.act === 'del-todo') {
    askDelete('todo', row.dataset.id);
  }
});

/* 底部输入框：回车 / 点「加」 */
el('todo-form').addEventListener('submit', function (ev) {
  ev.preventDefault();
  var input = el('todo-input');
  if (addTodo(input.value)) {
    input.value = '';
  }
  input.focus();
});

/* 空状态里的示例习惯 */
el('btn-example-habit').addEventListener('click', function () {
  createHabit('每天喝够 8 杯水', 'daily', 7);
  commit();
});

/* 新建习惯按钮（表单逻辑在文件末尾补齐） */
el('btn-new-habit').addEventListener('click', function () {
  if (typeof openHabitForm === 'function') openHabitForm(null);
});

/* ==================== 七、习惯详情弹层（F2） ==================== */

var detailHabitId = null;

function openMask(id) { el(id).hidden = false; }
function closeMask(id) { el(id).hidden = true; }

/*
 * 28 个格子按「自然周」对齐成 4 行 × 7 列：
 *   起点 = 本周周一再往前 3 周，终点 = 本周周日。
 * 这样本周今天之后的那几格才是真的「未来」，可以锁住不让点（AC-11）。
 */
function build28Dates() {
  var t = todayStr();
  var dow = parseDate(t).getDay();                 // 0 = 周日
  var backToMon = (dow === 0 ? 6 : dow - 1);       // 距离本周一过了几天
  var start = shiftDate(t, -(backToMon + 21));
  var out = [];
  for (var i = 0; i < 28; i++) out.push(shiftDate(start, i));
  return out;
}

function renderDetail() {
  var h = findHabit(detailHabitId);
  if (!h) return;

  el('detail-name').textContent = h.name;

  var s = calcStrength(h);
  var sd = strengthDetail(h);
  el('detail-month').textContent = sd.days28;
  el('detail-strength').textContent = sd.text7;
  el('detail-bar').style.width = s.percent + '%';

  var t = todayStr();
  var done = Array.isArray(h.doneDates) ? h.doneDates : [];
  var grid = el('detail-grid');
  grid.textContent = '';

  build28Dates().forEach(function (d) {
    var future = d > t;                            // 日期格式固定，可直接比字符串
    var cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'gcell';
    if (future) cell.classList.add('future');
    if (d === t) cell.classList.add('today');
    if (!future && done.indexOf(d) !== -1) cell.classList.add('on');

    cell.dataset.date = d;
    cell.textContent = String(parseDate(d).getDate());
    if (future) cell.disabled = true;

    cell.title = humanDate(d) + (future ? '（还没到）' : '（点一下可切换）');
    grid.appendChild(cell);
  });
}

function openDetail(id) {
  detailHabitId = id;
  renderDetail();
  openMask('detail-mask');
}

function closeDetail() {
  closeMask('detail-mask');
  detailHabitId = null;
}

/** 补勾 / 取消某个过去的日期（AC-11） */
function toggleHabitDate(id, dateStr) {
  if (!dateStr || dateStr > todayStr()) return;    // 未来的点不动
  var h = findHabit(id);
  if (!h) return;
  if (!Array.isArray(h.doneDates)) h.doneDates = [];
  var i = h.doneDates.indexOf(dateStr);
  if (i === -1) {
    h.doneDates.push(dateStr);
    if (dateStr === todayStr()) feedGrowth();   // F6：补勾的是「今天」才算喂了一口
  } else {
    h.doneDates.splice(i, 1);
  }

  commit();          // 今日页跟着变
  renderDetail();    // 详情自己也要立刻更新
}

el('detail-back').addEventListener('click', closeDetail);

el('detail-grid').addEventListener('click', function (ev) {
  var cell = ev.target.closest('.gcell');
  if (!cell || cell.classList.contains('future') || cell.disabled) return;
  toggleHabitDate(detailHabitId, cell.dataset.date);
});

el('detail-edit').addEventListener('click', function () {
  if (detailHabitId) openHabitForm(detailHabitId);
});

/* ================= 八、新建 / 编辑习惯表单（F4） ================= */

var editingHabitId = null;

function showFormError(msg) {
  var box = el('habit-form-error');
  box.textContent = msg;
  box.hidden = false;
}

function syncFreqField() {
  el('freq-count-field').hidden = el('habit-freq').value !== 'weekly';
}

function openHabitForm(id) {
  editingHabitId = id;
  var h = id ? findHabit(id) : null;

  el('habit-form-title').textContent = h ? '编辑习惯' : '新建习惯';
  el('habit-name').value = h ? h.name : '';
  el('habit-freq').value = h ? (h.freqType || 'daily') : 'daily';
  el('habit-freq-count').value =
    (h && h.freqType === 'weekly' && h.freqCount) ? h.freqCount : 3;
  el('habit-form-error').hidden = true;

  syncFreqField();
  openMask('habit-mask');
  el('habit-name').focus();
}

function closeHabitForm() {
  closeMask('habit-mask');
  editingHabitId = null;
}

function saveHabitForm() {
  var name = el('habit-name').value.trim();
  if (!name) {
    showFormError('名称得填一下，频率不改也行。');
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

  var created = null;
  if (editingHabitId) {
    var h = findHabit(editingHabitId);
    if (h) {
      h.name = name;
      h.freqType = freqType;
      h.freqCount = freqCount;
    }
  } else {
    created = createHabit(name, freqType, freqCount);
  }

  var wasEditing = editingHabitId;
  closeMask('habit-mask');
  editingHabitId = null;
  commit();

  /* 如果是「从详情里点编辑」进来的，详情要跟着刷新 */
  if (wasEditing && detailHabitId === wasEditing && !el('detail-mask').hidden) {
    renderDetail();
  }

  /* ★ Day 24：把这一步推回库。本机已经存好了，这里只负责「让库里也知道」 */
  if (!cloudReady()) return;

  if (wasEditing) {
    /* 改：白名单正好是 name / freqType / freqCount 三个（契约 §3.11） */
    afterPush(
      window.HabitBoardCloud.updateHabit(wasEditing, {
        name: name, freqType: freqType, freqCount: freqCount
      }),
      '改习惯（' + name + '）'
    );
  } else if (created) {
    /* 新建：成功之后拿服务端那条替换本机那条 —— id 以服务端为准，以后改/删才对得上 */
    window.HabitBoardCloud.createHabit(created).then(function (res) {
      if (res && res.ok && res.data) {
        replaceHabit(created.id, res.data);
        commit();
      } else {
        markUnsynced('新建习惯（' + name + '）：'
          + ((res && (res.message || res.netError)) || '未知原因'));
      }
    });
  }
}

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

/* ==================== 九、删除二次确认（AC-12 / AC-15） ==================== */

/*
 * 习惯和待办**共用同一个确认弹层**，只有文案不同 ——
 * 和看板 dashboard.js 里是同一套写法：确认这一步的交互只有一种，用户不用学两遍。
 *
 * Day 14 之前这里只认习惯（变量就叫 pendingDeleteId），
 * 所以待办在今日页根本没有删除入口 —— 这是 PRD F3「行尾一个删除按钮」漏实现的后果。
 */
var pendingDelete = null;   /* { type: 'habit' | 'todo', id: string } */

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
  openMask('confirm-mask');

  /* 焦点给「取消」而不是「删除」：这一步本来就为了防误删，别让回车直接删掉 */
  el('confirm-cancel').focus();
}

function closeConfirm() {
  closeMask('confirm-mask');
  pendingDelete = null;
}

function runDelete() {
  if (!pendingDelete) return;

  var p = pendingDelete;
  closeConfirm();

  var gone = null;
  if (p.type === 'habit') {
    gone = findHabit(p.id);                          // 名字留着，写日志用
    state.habits = state.habits.filter(function (h) { return h.id !== p.id; });
    closeDetail();
  } else {
    state.todos = state.todos.filter(function (t) { return t.id !== p.id; });
  }
  commit();

  /* ★ Day 24：习惯的删除要回库（服务端默认软删，能找回，契约 §3.12）。
     待办那条链服务端还没有写口 —— 见今日的「不做清单」。 */
  if (p.type === 'habit' && cloudReady()) {
    afterPush(
      window.HabitBoardCloud.removeHabit(p.id),
      '删习惯（' + ((gone && gone.name) || p.id) + '）'
    );
  }
}

el('detail-delete').addEventListener('click', function () {
  if (!detailHabitId) return;
  askDelete('habit', detailHabitId);
});

el('confirm-cancel').addEventListener('click', closeConfirm);
el('confirm-ok').addEventListener('click', runDelete);

/* ==================== 十、弹层的通用关闭方式 ==================== */

el('detail-mask').addEventListener('click', function (ev) {
  if (ev.target === this) closeDetail();
});

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
  if (!el('detail-mask').hidden) closeDetail();
});

/* ============================ 启动 ============================ */

render();

/* Day 17：先用本机那份把页面画出来（保证秒开、断网也不白屏），
   再去问云端要一份；读到了就换过来重画，读不到就保持本机那份。
   读云端这件事全都封装在 cloud.js 里，这里只调一行。 */
if (window.HabitBoardCloud) {
  window.HabitBoardCloud.sync({ state: state, save: saveData, rerender: render });
}

