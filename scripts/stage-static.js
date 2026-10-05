'use strict';

/**
 * stage-static.js —— 把「要发到公网的静态文件」挑出来放进 dist/
 *
 * 为什么不直接把仓库根目录整个发上去：
 *   仓库根目录除了页面文件，还有 PRD.md / README.md / TECH_DESIGN.md /
 *   user-test/ 这些内部文档。静态托管是公开可读的，发上去等于把内部文档挂到公网。
 *   所以这里用一张「白名单」——只有列表里的文件会进 dist/。
 *
 * 用法（在仓库根目录执行）：
 *   <node> scripts/stage-static.js
 *
 * 它是纯本地操作：只读仓库文件、只写 dist/，不联网、不改原文件。
 */

const fs = require('fs');
const path = require('path');

// 要发到公网的，就这 10 个 —— 两个页面 + 各自配套的样式和脚本 + 共用的两层 + 背景图
const WHITELIST = [
  'index.html',
  'style.css',
  'app.js',
  'dashboard.html',
  'dashboard.css',
  'dashboard.js',
  'cloud.js',                    // Day 17：两个页面共用的「读云端」接入层
  'theme.css',                   // Day 18 加餐：背景 + 主题色 + 音乐开关样式（覆盖层）
  'theme.js',                    // Day 18 加餐：页面音乐开关（素材不在时自己藏起来）
  'assets/bg-starry-sea.jpg',    // Day 18 加餐：页面背景插画
];

// ⚠️ 故意**不在这里**的：assets/bgm-starfall-sea.ogg（那首商业单曲只在本机用，
//    见 .gitignore 里的说明）。公网那份页面加载不到它，会自己把音乐开关藏掉。

const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'dist');

function main() {
  // 1. 先清掉 dist/ 里「这一轮不在白名单里的」文件，避免上一次的残留被一起发上去。
  //    为什么逐个 unlink，而不是一把 fs.rmSync(dir, {recursive:true})：
  //      递归删除在很多受管环境里会被安全策略拦下来（Day 17 实测踩到：脚本直接崩，
  //      dist/ 还留在半路状态）。逐个删文件在哪都能跑，效果一样，也更说得清删了什么。
  //    Day 18 加餐补的：白名单里开始有 assets/xxx 这种带目录的条目，
  //      所以目录**只往下走一层**（够用，也不去碰深层递归删除）。
  const want = {};
  for (const name of WHITELIST) want[name] = true;

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const removed = [];
  for (const name of fs.readdirSync(OUT_DIR)) {
    const full = path.join(OUT_DIR, name);
    if (fs.lstatSync(full).isDirectory()) {
      for (const sub of fs.readdirSync(full)) {
        const rel = name + '/' + sub;
        const subFull = path.join(full, sub);
        if (!want[rel] && fs.lstatSync(subFull).isFile()) {
          fs.unlinkSync(subFull);
          removed.push(rel);
        }
      }
      continue;
    }
    if (want[name]) continue;
    fs.unlinkSync(full);
    removed.push(name);
  }

  // 2. 逐个复制，白名单里少一个文件就报出来（宁可失败，也不要发一个缺文件的站点）
  const missing = [];
  const copied = [];

  for (const name of WHITELIST) {
    const src = path.join(ROOT, name);
    if (!fs.existsSync(src)) {
      missing.push(name);
      continue;
    }
    const dst = path.join(OUT_DIR, name);
    fs.mkdirSync(path.dirname(dst), { recursive: true });   // assets/ 这类要先建目录
    fs.copyFileSync(src, dst);
    copied.push({ name, bytes: fs.statSync(src).size });
  }

  if (missing.length > 0) {
    console.error('缺少这些文件，已中止：' + missing.join('、'));
    process.exit(1);
  }

  // 3. 报告结果（用真实文件大小，方便核对发出去的就是本机这份）
  const total = copied.reduce((sum, f) => sum + f.bytes, 0);
  if (removed.length > 0) {
    console.log('已清掉上一轮的残留：' + removed.join('、'));
  }
  console.log('已打包到 dist/，共 ' + copied.length + ' 个文件、' + total + ' 字节：');
  for (const f of copied) {
    console.log('  ' + f.name.padEnd(18) + f.bytes + ' 字节');
  }
  console.log('\n下一步：tcb hosting deploy dist -e <环境ID>');
}

main();
