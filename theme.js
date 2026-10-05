/* ==========================================================================
   theme.js —— 环境层：页面音乐开关（Day 18 加餐）
   --------------------------------------------------------------------------
   它只干一件事：把顶栏那个音乐开关接上 assets/bgm-starfall-sea.ogg。

   三件要交代的事：

   1) **浏览器不允许「没人操作就出声」** —— 打开页面先试一次自动播放；
      被拦下来就等你**第一次点页面 / 按键盘**时再开始。
      这是浏览器的规矩（防止页面一打开就吵人），不是坏了。

   2) **音乐文件故意没有上公网**（版权原因，见 .gitignore 里的说明）。
      所以部署出去的那份页面会加载不到它 —— 这时把开关**整个藏掉**，
      页面上不留任何多余的字，只在控制台留一行说明，页面照常能用。

   3) 你的选择记在浏览器本地（键 `habit-board/music`），下次打开照旧。

   守项目硬约束：T1 不引外部资源（这是本地文件）、T2 不用 ES Module（IIFE + var）。
   ========================================================================== */
(function (global) {
  'use strict';

  var SRC = 'assets/bgm-starfall-sea.ogg';
  var KEY = 'habit-board/music';   // 存 'on' / 'off'
  var VOLUME = 0.45;               // 当背景音用，别盖过人说话

  var btn = document.getElementById('music-toggle');
  if (!btn) return;

  var audio = new Audio();
  audio.loop = true;
  audio.preload = 'metadata';      // 先只读个头，不把 2.9 MB 直接拉下来
  audio.volume = VOLUME;

  var available = true;            // 素材在不在（不在就把开关藏掉）
  var want = read();               // 用户想不想听
  var gestureArmed = false;

  function read() {
    try {
      var v = global.localStorage.getItem(KEY);
      if (v === 'off') return false;
      if (v === 'on') return true;
    } catch (e) { /* 隐私模式下读不到，落到默认值 */ }
    return true;                   // 默认开：这个页面本来就该有音乐
  }

  function save() {
    try { global.localStorage.setItem(KEY, want ? 'on' : 'off'); } catch (e) { /* 存不进也不影响此刻 */ }
  }

  function paint() {
    btn.hidden = !available;
    btn.classList.toggle('is-on', available && want);
    btn.setAttribute('aria-pressed', want ? 'true' : 'false');
    btn.title = want ? '点一下静音' : '点一下放音乐';
  }

  function unavailable() {
    available = false;
    want = false;
    paint();
    console.info('页面音乐：' + SRC + ' 没找到，音乐开关已隐藏（公网那份不带音乐，这是预期的）');
  }

  /** 等用户第一次操作，再试一次自动播放 */
  function armGesture() {
    if (gestureArmed) return;
    gestureArmed = true;
    var once = function () {
      global.removeEventListener('pointerdown', once, true);
      global.removeEventListener('keydown', once, true);
      gestureArmed = false;
      if (want && available) attempt();
    };
    global.addEventListener('pointerdown', once, true);
    global.addEventListener('keydown', once, true);
  }

  function attempt() {
    var p = audio.play();
    if (p && typeof p.catch === 'function') p.catch(armGesture);
  }

  btn.addEventListener('click', function () {
    want = !want;
    save();
    paint();
    if (want && available) attempt();
    else audio.pause();
  });

  audio.addEventListener('error', unavailable);

  audio.src = SRC;                 // 放最后：设了 src 才会真的去加载
  paint();
  if (want) attempt();
})(window);
