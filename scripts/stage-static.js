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

// 要发到公网的，就这 7 个 —— 两个页面 + 各自配套的样式和脚本 + 共用的云端接入层
const WHITELIST = [
  'index.html',
  'style.css',
  'app.js',
  'dashboard.html',
  'dashboard.css',
  'dashboard.js',
  'cloud.js',   // Day 17 新增：两个页面共用的「读云端」接入层
];

const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'dist');

function main() {
  // 1. 先清掉 dist/ 里「这一轮不在白名单里的」文件，避免上一次的残留被一起发上去。
  //    为什么逐个 unlink，而不是一把 fs.rmSync(dir, {recursive:true})：
  //      递归删除在很多受管环境里会被安全策略拦下来（Day 17 实测踩到：脚本直接崩，
  //      dist/ 还留在半路状态）。逐个删文件在哪都能跑，效果一样，也更说得清删了什么。
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const removed = [];
  for (const name of fs.readdirSync(OUT_DIR)) {
    if (WHITELIST.indexOf(name) !== -1) continue;
    const stale = path.join(OUT_DIR, name);
    if (fs.lstatSync(stale).isDirectory()) {
      // dist/ 里本来不该有子目录；真出现了先报出来，别悄悄留着
      console.warn('dist/ 里有没预料到的子目录，已跳过：' + name);
      continue;
    }
    fs.unlinkSync(stale);
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
    fs.copyFileSync(src, path.join(OUT_DIR, name));
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
