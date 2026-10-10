// 重新生成判分快照（只在「有意改判分规则」之后用）：
//   node tests/regen-snapshot.cjs          只看哪些用例的结果会变，不写文件
//   node tests/regen-snapshot.cjs --write  确认变化都是想要的之后，写回 grading-snapshot.json
// 用例本身（哪道题、填什么）不变，只把「应该判成什么」换成当前引擎的结果，并把变了的逐条列出来给人看。
const fs = require('fs'), path = require('path'), http = require('http');
const { open } = require('./cdp.cjs');
const ROOT = path.resolve(__dirname, '..'), FILE = path.join(__dirname, 'grading-snapshot.json');
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
(async () => {
  const srv = await new Promise(res => { const s = http.createServer((q, r) => { let f = path.join(ROOT, decodeURIComponent(new URL(q.url, 'http://x').pathname)); if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html'); fs.readFile(f, (e, d) => { if (e) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' }); r.end(d); }); }); s.listen(0, '127.0.0.1', () => res(s)); });
  const snap = JSON.parse(fs.readFileSync(FILE, 'utf8')), c = await open(390, 844, 1);
  let changed = 0, total = 0;
  try {
    for (const s of Object.keys(snap.cases)) {
      if (!snap.cases[s].length) continue;
      await c.goto('http://127.0.0.1:' + srv.address().port + '/' + s + '/');
      const got = await c.ev(`(()=>${JSON.stringify(snap.cases[s])}.map(t=>__quiz.gradeQuestion(QUESTIONS[t.q],t.in).allCorrect))()`);
      const text = await c.ev(`(()=>QUESTIONS.map(q=>(q.text||'').slice(0,24)))()`);
      snap.cases[s].forEach((t, i) => { total++; if (t.ok !== got[i]) { changed++; console.log(`${s} 第${t.q}题「${text[t.q]}」填 ${JSON.stringify(t.in)}：${t.ok ? '对' : '错'} → ${got[i] ? '对' : '错'}`); t.ok = got[i]; } });
    }
  } finally { c.close(); srv.close(); }
  console.log(`共 ${total} 条，结果变了 ${changed} 条`);
  if (process.argv.includes('--write')) {
    snap.note = '判分结果快照。最初是 2026-10-07 合并前 8 个旧站的结果；2026-10-10 有意改了判分规则（多空题默认按位置判、数字和否定词不再"包含也算对"、英语选词两站只认完全一致、弯引号当直引号）后重新生成。改判分逻辑后跑 tests/run.cjs 对照，不一致就是改坏了（除非是有意改的，那就用 tests/regen-snapshot.cjs 看清变化再重新生成，并在提交说明里写清楚）';
    fs.writeFileSync(FILE, JSON.stringify(snap)); console.log('已写回 ' + path.basename(FILE));
  }
})().catch(e => { console.error('FAIL', e); process.exit(1); });
