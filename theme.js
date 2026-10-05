/* ==========================================================================
   theme.js —— 环境层：页面音乐（Day 18 加餐）
   --------------------------------------------------------------------------
   目标：**一打开页面，就把 assets/bgm-starfall-sea.ogg 循环放起来。**

   但有一条浏览器的硬规矩绕不过去：
     **没人操作过的页面，不许自己出声。**（防的是网页一打开就吵人）
   所以这里按「能自动就自动、不能自动就**明说**」来做，不留白：

     ① 页面一加载就试 `play()`，还在「缓冲好」「从别的标签页切回来」时各再试一次
        —— 浏览器放行的话，你已经听到了；
     ② 一旦被拒，页面底部浮出一条提示：「点这里开始播放」。
        点它（或点页面任意处、按任意键）立刻开始 —— 之后就一直循环；
     ③ `loop = true`，放完一遍接一遍，不用管。

   👉 想「连一次都不用点」，只有一条路：在浏览器里给这个页面开
      「允许播放声音」权限（README 里写了怎么点）。代码这边做不到 ——
      能自动播的话 ① 已经替你播了。

   另外两件事：
     - 音乐文件**故意没上公网**（版权，见 .gitignore）。公网那份加载不到它，
       会把开关和提示**都藏掉**，页面上不留多余的字，页面照常能用。
     - 你的开关选择记在浏览器本地（键 `habit-board/music`）。

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
  audio.loop = true;               // 循环：放完一遍接着放
  audio.preload = 'auto';          // 想「一打开就响」，就得早点把数据拉下来
  audio.volume = VOLUME;

  var available = true;            // 素材在不在（不在就把开关和提示都藏掉）
  var want = read();               // 用户想不想听
  var playing = false;             // 此刻真的在响吗（被拦时是 false —— 按钮就别装作在放）
  var trying = false;              // 防并发：好几个时机可能同时来试
  var hint = null;

  /* ---------------------------------------------- 开关状态的存取 */

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

  /* ---------------------------------------------- 右上角那个开关 */

  function paint() {
    btn.hidden = !available;
    // is-on 的语义是「真的在响」：被浏览器拦着的时候按钮就不该亮，
    // 否则会出现「按钮亮着、却没声音」这种骗人的状态
    btn.classList.toggle('is-on', available && want && playing);
    btn.setAttribute('aria-pressed', want ? 'true' : 'false');
    btn.title = !want ? '点一下放音乐'
      : (playing ? '点一下静音' : '点一下开始播放');
  }

  /** 素材不在（公网那份）：开关和提示都收掉，只留一行控制台说明 */
  function unavailable() {
    available = false;
    want = false;
    playing = false;
    hideHint();
    paint();
    console.info('页面音乐：' + SRC + ' 没找到，音乐开关与提示都不显示（公网那份不带音乐，这是预期的）');
  }

  /* ---------------------------------------------- 底部提示条：被拦时把话说出来 */

  function ensureHint() {
    if (hint) return hint;

    hint = document.createElement('div');
    hint.className = 'music-hint';
    hint.setAttribute('role', 'status');
    hint.innerHTML =
      '<button type="button" class="music-hint-go">' +
        '<span class="music-hint-icon" aria-hidden="true">♫</span>' +
        '<span>浏览器不让网页自己出声 —— <b>点这里开始播放</b></span>' +
      '</button>' +
      '<button type="button" class="music-hint-no" aria-label="不要音乐" title="不要音乐">✕</button>';

    hint.querySelector('.music-hint-go').addEventListener('click', function () {
      want = true;
      save();
      hint.classList.remove('is-show');   // 先收起；真放起来了才算数
      attempt();
      paint();
    });

    hint.querySelector('.music-hint-no').addEventListener('click', function () {
      want = false;
      save();
      hideHint();
      paint();
    });

    document.body.appendChild(hint);
    return hint;
  }

  function showHint() {
    if (!want || !available) return;
    ensureHint().classList.add('is-show');
  }

  function hideHint() {
    if (hint) hint.classList.remove('is-show');
  }

  /* ---------------------------------------------- 试着放 */

  function attempt() {
    if (!want || !available || trying) return;
    trying = true;

    var p;
    try {
      p = audio.play();
    } catch (e) {                  // 老浏览器可能直接抛
      trying = false;
      showHint();
      armGesture();
      return;
    }

    if (p && typeof p.then === 'function') {
      p.then(function () {
        trying = false; playing = true; hideHint(); paint();
      }).catch(function () {
        // 被浏览器拦下了：这不是坏了，是规矩。把提示浮出来，并等第一次操作
        trying = false; playing = false; showHint(); paint(); armGesture();
      });
    } else {                       // 很老的浏览器：play() 不给 promise
      trying = false; playing = true; hideHint(); paint();
    }
  }

  /** 兜底：等用户第一次操作，再放一次 */
  function armGesture() {
    if (playing) return;
    global.addEventListener('pointerdown', onGesture, true);
    global.addEventListener('keydown', onGesture, true);
    global.addEventListener('touchstart', onGesture, true);   // 老手机
  }

  function onGesture() {
    global.removeEventListener('pointerdown', onGesture, true);
    global.removeEventListener('keydown', onGesture, true);
    global.removeEventListener('touchstart', onGesture, true);
    if (want && available) attempt();
  }

  /* ---------------------------------------------- 接线 */

  btn.addEventListener('click', function () {
    want = !want;
    save();
    if (want) {
      attempt();
    } else {
      audio.pause();
      playing = false;
      hideHint();
    }
    paint();
  });

  audio.addEventListener('error', unavailable);
  audio.addEventListener('playing', function () { playing = true; hideHint(); paint(); });
  audio.addEventListener('pause', function () { playing = false; paint(); });

  /* ---------------------------------------------- 尽量不用你点：多试几个时机 */

  audio.src = SRC;                 // 放最后：设了 src 才会真的去加载
  paint();
  if (want) attempt();             // ① 立刻

  // ② 数据够放了（首次加载完成）
  audio.addEventListener('canplaythrough', function () { if (want && !playing) attempt(); });

  // ③ DOM 就绪（万一这个脚本跑在 DOM 之前）
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { if (want && !playing) attempt(); });
  }

  // ④ 从别的标签页 / 别的窗口切回来：有些浏览器只在「页面可见」时才放行
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && want && !playing) attempt();
  });
})(window);
