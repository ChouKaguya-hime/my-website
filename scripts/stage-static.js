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

// 要发到公网的，就这 6 个 —— 三个页面 + 各自配套的样式和脚本
const WHITELIST = [
  'index.html',
  'style.css',
  'app.js',
  'dashboard.html',
  'dashboard.css',
  'dashboard.js',
];

const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'dist');

function main() {
  // 1. 先清空 dist/，避免上一次的残留被一起发上去
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });

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
  console.log('已打包到 dist/，共 ' + copied.length + ' 个文件、' + total + ' 字节：');
  for (const f of copied) {
    console.log('  ' + f.name.padEnd(18) + f.bytes + ' 字节');
  }
  console.log('\n下一步：tcb hosting deploy dist -e <环境ID>');
}

main();
