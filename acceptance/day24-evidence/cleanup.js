/*
 * cleanup.js —— 把 Day 24 验证用的习惯从库里清干净（独立于浏览器，跑不通也不影响别的）
 * 用法: node cleanup.js
 */
const BASE = 'https://habit-board-d0gum6nqu512acc29-1499798330.ap-shanghai.app.tcloudbase.com';
const PAT = ['__Day24验证__', '__Day24验证_改过名__', 'Day24｜新建即入库'];

(async () => {
  const r = await fetch(BASE + '/api/habits');
  const j = await r.json();
  const junk = (j.data || []).filter((h) => PAT.includes(h.name));
  if (!junk.length) { console.log('库里没有验证数据，干净。当前共 ' + (j.count || 0) + ' 条习惯。'); return; }
  for (const h of junk) {
    const d = await fetch(BASE + '/api/habits/' + encodeURIComponent(h.id), { method: 'DELETE' });
    let b = {}; try { b = await d.json(); } catch (e) {}
    console.log('删除 ' + h.id + ' （' + h.name + '）→ HTTP ' + d.status + ' ok=' + b.ok);
  }
  const r2 = await fetch(BASE + '/api/habits');
  const j2 = await r2.json();
  console.log('清理完成，删了 ' + junk.length + ' 条；现在库里 ' + (j2.count || 0) + ' 条习惯。');
})().catch((e) => { console.error('清理出错：' + (e && e.message || e)); process.exit(1); });
