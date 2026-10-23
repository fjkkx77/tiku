// 多设备同步：两台「设备」（两个各自独立存储的浏览器）+ 真的 api/sync.js + 内存版 Upstash（照 CAS 脚本语义）
//   node tests/sync.cjs          单独跑（run.cjs 也会调它）
// 验的是设计稿里写的每一条：哪些数据同步、两台都改了听谁的、删了不复活、接上同步码时设置让着云端、哪些不同步、跨域
const http = require('http'), fs = require('fs'), path = require('path');
const { open, sleep } = require('./cdp.cjs');
const ROOT = path.resolve(__dirname, '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json' };

/* 假 Upstash：只实现 api/sync.js 用到的 GET / EVAL（EVAL 照 CAS_SCRIPT 的语义：版本对得上才写） */
function fakeRedis() {
  const store = new Map();
  const srv = http.createServer((q, s) => {
    let b = ''; q.on('data', d => b += d); q.on('end', () => {
      const cmd = JSON.parse(b || '[]'); let result = null;
      if (cmd[0] === 'GET') result = store.has(cmd[1]) ? store.get(cmd[1]) : null;
      else if (cmd[0] === 'EVAL') {
        const key = cmd[3], base = Number(cmd[4]), cur = store.has(key) ? store.get(key) : null;
        const m = cur && /^\{"version":(\d+)/.exec(cur), v = m ? Number(m[1]) : 0;
        if (v !== base) result = [0, v, cur || '']; else { store.set(key, cmd[5]); result = [1, v + 1]; }
      }
      s.writeHead(200, { 'content-type': 'application/json' }); s.end(JSON.stringify({ result }));
    });
  });
  return { srv, store };
}

/* 站点 + /api/sync（真的 handler）。log 记下每个请求，好核对方法、Content-Type、跨域头 */
function site(handler, log) {
  return http.createServer((q, s) => {
    const u = new URL(q.url, 'http://x');
    if (u.pathname === '/api/sync') {
      let b = ''; q.on('data', d => b += d); q.on('end', () => {
        const req = { method: q.method, query: Object.fromEntries(u.searchParams), body: b || undefined, headers: q.headers };
        const hdr = {};
        const res = { status(c) { s.statusCode = c; return res; }, setHeader(k, v) { hdr[k.toLowerCase()] = v; s.setHeader(k, v); }, end(x) { log.push({ m: q.method, ct: q.headers['content-type'] || '', origin: q.headers.origin || '', status: s.statusCode, acao: hdr['access-control-allow-origin'] || '' }); s.end(x); } };
        handler(req, res);
      });
      return;
    }
    let f = path.join(ROOT, decodeURIComponent(u.pathname));
    if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
    fs.readFile(f, (e, d) => { if (e) { s.writeHead(404); return s.end(); } s.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' }); s.end(d); });
  });
}
const listen = srv => new Promise(r => srv.listen(0, '127.0.0.1', () => r(srv.address().port)));

async function runSync(ok) {
  const R = fakeRedis(), rport = await listen(R.srv);
  process.env.KV_REST_API_URL = 'http://127.0.0.1:' + rport; process.env.KV_REST_API_TOKEN = 'test';
  const log = [];
  // 「GitHub Pages」那个来源要先知道端口，才能放进跨域白名单：先占一个端口
  const ghSrv = site(null, []); const ghPort = await listen(ghSrv); ghSrv.close();
  process.env.SYNC_EXTRA_ORIGINS = 'http://127.0.0.1:' + ghPort;
  delete require.cache[require.resolve('../api/sync.js')];
  const handler = require('../api/sync.js');
  const main = site(handler, log), port = await listen(main);
  const B = 'http://127.0.0.1:' + port + '/';
  const CODE = 'test-sync-' + Date.now().toString(36);
  const devs = [];
  try {
    const A = await open(390, 844, 1), Bd = await open(390, 844, 1); devs.push(A, Bd);
    const go = async (d, p) => { await d.goto(B + p); await sleep(150); };
    const sync = d => d.ev('TikuSync.client.syncNow().then(()=>TikuSync.client.status.state)');
    const ls = (d, k) => d.ev(`localStorage.getItem(${JSON.stringify(k)})`);

    /* ---------- 0. 接口和对照表 ---------- */
    await go(A, '');
    const pre = await A.ev(`JSON.stringify(SUBJECTS.map(s=>s.prefix))===JSON.stringify(TikuSync.PREFIXES)`);
    ok(pre, '同步：tiku-sync.js 的科目前缀和首页 SUBJECTS 一一对应');
    ok(await A.ev(`fetch(TikuSync.api+'?_=1').then(r=>r.json()).then(j=>j.ok&&j.configured)`), '同步：接口探测 → 已配好存储');

    /* ---------- 1. A：先在本机攒一些数据，再开同步 ---------- */
    await A.ev('localStorage.clear()'); await go(A, '');
    await A.ev(`(()=>{const fs=loadFolders();fs.push({id:'fA',name:'期末'});saveFolders(fs);saveName('os','操作系统A');
      const m=loadSubjectFolderMap();m['web-design']='fA';saveSubjectFolderMap(m);savePinned(['english-listening']);setExpanded('fA',true);render();})()`);
    await go(A, 'os/');
    await A.ev(`(async()=>{document.getElementById('startBtn').click();await new Promise(r=>setTimeout(r,80));const Q=__quiz;
      Q.session.idx=0;Q.renderQuestion();document.querySelectorAll('#qText .blank-input').forEach(b=>b.value='错');Q.submitAnswer();
      Q.session.idx=1;Q.renderQuestion();Q.finishQuiz();
      document.getElementById('startBtn').click();await new Promise(r=>setTimeout(r,80));Q.session.idx=2;Q.renderQuestion();return 1;})()`);   // 再开一轮不做完：留一份「继续上次练习」
    await A.ev(`localStorage.setItem('webquiz_exammode','false')`);
    // 用面板开同步（真点按钮，不直接调接口）
    await go(A, '');
    await A.ev(`(async()=>{document.getElementById('topMoreBtn').click();await new Promise(r=>setTimeout(r,200));document.getElementById('menuSync').click();await new Promise(r=>setTimeout(r,200));
      const sh=document.getElementById('sheet');sh.querySelector('[data-sp="code"]').value=${JSON.stringify(CODE)};sh.querySelector('[data-sp="on"]').click();return 1;})()`);
    await sleep(300); await sync(A);
    let m = await A.ev(`({line:document.getElementById('syncLine').textContent,hidden:document.getElementById('syncLine').hidden,state:TikuSync.client.status.state,where:document.getElementById('backupWhere').textContent})`);
    ok(m.state === 'ok' && !m.hidden && /已同步/.test(m.line) && /已开启多设备同步/.test(m.where), '同步：首页面板开启 → 横幅下显示「已同步」、底部说明改成已开启', m);
    const cloud = () => { const k = [...R.store.keys()].find(x => x.indexOf('tiku:') === 0); return k ? JSON.parse(R.store.get(k)) : null; };
    m = cloud();
    ok(!!m && [...R.store.keys()].every(k => /^tiku:[0-9a-f]{40}$/.test(k)) && !JSON.stringify([...R.store.keys()]).includes(CODE), '同步：云端键是 tiku: + 哈希，不含同步码本身', [...R.store.keys()]);
    const ids = (m ? m.items : []).filter(e => !e.deletedAt).map(e => e.id);
    ok(['f|fA', 'n|os', 'sf|web-design', 'pin', 'webquiz|em'].every(x => ids.includes(x)) && ids.some(x => /^osquiz\|wb\|/.test(x)) && ids.some(x => /^osquiz\|d\|/.test(x)) && ids.some(x => /^osquiz\|pg\|/.test(x)),
      '同步：文件夹、改名、放哪个文件夹、置顶、错题、做过的题、进度、开关都传上去了', ids.slice(0, 20));
    ok(!ids.some(x => /expanded|last_export|wbremoved/.test(x)), '同步：展开状态、上次导出时间、移出记号不上传', ids.filter(x => /expanded|export|removed/.test(x)));

    /* ---------- 2. B：本机有自己的旧设置和数据，再接上同一个同步码 ---------- */
    await Bd.goto(B); await Bd.ev('localStorage.clear()'); await go(Bd, '');
    await Bd.ev(`(()=>{saveName('os','操作系统B旧名');const fs=loadFolders();fs.push({id:'fB',name:'B的文件夹'});saveFolders(fs);savePinned(['mobile-app']);})()`);
    await go(Bd, 'software-engineering/');
    await Bd.ev(`(async()=>{document.getElementById('startBtn').click();await new Promise(r=>setTimeout(r,80));const Q=__quiz;Q.session.idx=0;Q.renderQuestion();
      if(Q.session.queue[0].type==='mcq'){const q=Q.session.queue[0];Q.pickOption(Object.keys(q.options).find(k=>k!==q.correct));}else{document.querySelectorAll('#qText .blank-input').forEach(b=>b.value='错');}
      Q.submitAnswer();return 1;})()`);
    await go(Bd, '');
    await Bd.ev(`TikuSync.client.enable(${JSON.stringify(CODE)})`); await sleep(200); await sync(Bd);
    m = await Bd.ev(`({os:loadNames().os,folders:loadFolders().map(f=>f.id).sort(),pin:loadPinned(),sf:loadSubjectFolderMap()['web-design'],
      osWb:Object.keys(JSON.parse(localStorage.getItem('osquiz_wrongbook')||'{}')).length,seWb:Object.keys(JSON.parse(localStorage.getItem('rjgcquiz_wrongbook')||'{}')).length,
      prog:Object.keys(JSON.parse(localStorage.getItem('osquiz_progs')||'{}')).length>0,em:localStorage.getItem('webquiz_exammode'),exp:localStorage.getItem('tiku_expanded_folders')})`);
    ok(m.os === '操作系统A' && JSON.stringify(m.pin) === '["english-listening"]', 'B 接上同步码：没动过的设置以云端为准（改名、置顶顺序用 A 的）', m);
    ok(JSON.stringify(m.folders) === '["fA","fB"]' && m.sf === 'fA', 'B 接上：两边的文件夹都在，科目放在 A 定的文件夹里', m);
    ok(m.osWb >= 1 && m.seWb >= 1 && m.prog && m.em === 'false', 'B 接上：A 的错题/进度/开关下来了，B 自己的错题也还在', m);
    ok(m.exp === null, 'B 接上：A 的文件夹展开状态没跟过来（只跟设备有关）', m.exp);
    // A 再同步一次：拿到 B 独有的
    await go(A, ''); await sync(A);
    m = await A.ev(`({folders:loadFolders().map(f=>f.id).sort(),seWb:Object.keys(JSON.parse(localStorage.getItem('rjgcquiz_wrongbook')||'{}')).length,os:loadNames().os})`);
    ok(JSON.stringify(m.folders) === '["fA","fB"]' && m.seWb >= 1 && m.os === '操作系统A', 'A 再同步：拿到了 B 的文件夹和错题，自己的改名没被 B 的旧名冲掉', m);

    /* ---------- 3. 接上之后的改动：谁后改听谁的；删了不复活 ---------- */
    await Bd.ev(`saveName('os','B后来改的名')`); await sync(Bd);
    await sync(A);
    ok(await A.ev(`loadNames().os`) === 'B后来改的名', '之后 B 改名 → A 跟着变（后改的赢）');
    await A.ev(`(()=>{saveFolders(loadFolders().filter(f=>f.id!=='fB'));render();})()`); await sync(A);
    await sync(Bd); await sync(Bd);
    m = await Bd.ev(`loadFolders().map(f=>f.id)`);
    ok(JSON.stringify(m) === '["fA"]', 'A 删了文件夹 → B 也删了，B 再同步也不复活', m);
    await sync(A);
    ok(JSON.stringify(await A.ev(`loadFolders().map(f=>f.id)`)) === '["fA"]', 'A 这边也没被 B 加回来');
    // 错题移出：A 在操作系统站把错题本清空 → B 那边也没了，而且记下了移出时间（以后导入旧备份不会放回来）
    await go(A, 'os/');
    await A.ev(`(()=>{localStorage.setItem('osquiz_wrongbook','{}');window.TikuSync.changed();return 1;})()`); await sync(A);
    await go(Bd, 'os/'); await sync(Bd);
    m = await Bd.ev(`({wb:Object.keys(JSON.parse(localStorage.getItem('osquiz_wrongbook')||'{}')).length,rm:Object.keys(JSON.parse(localStorage.getItem('osquiz_wbremoved')||'{}')).length})`);
    ok(m.wb === 0 && m.rm >= 1, 'A 清空错题本 → B 也清空，并记下移出时间', m);
    // 「会 / 不会」标记（2026-10-23）：A 标的 B 收到；A 取消 → B 也取消
    await go(A, 'cet4-vocab/');
    await A.ev(`(async()=>{document.getElementById("startBtn").click();await new Promise(r=>setTimeout(r,60));__quiz.setMark("dunno");__quiz.session.idx=1;__quiz.renderQuestion();__quiz.setMark("know");return 1;})()`); await sync(A);
    await go(Bd, 'cet4-vocab/'); await sync(Bd);
    m = await Bd.ev(`Object.values(JSON.parse(localStorage.getItem('cet4vocabquiz_marks')||'{}')).map(x=>x.s).sort().join(',')`);
    ok(m === 'dunno,know', '标记：A 标的「会」「不会」，B 同步后都有', m);
    await A.ev(`(()=>{__quiz.setMark("know");return 1;})()`); await sync(A); await sync(Bd);
    m = await Bd.ev(`Object.values(JSON.parse(localStorage.getItem('cet4vocabquiz_marks')||'{}')).map(x=>x.s).join(',')`);
    ok(m === 'dunno', '标记：A 取消一个 → B 那边也没了', m);
    await go(A, ''); await go(Bd, '');
    // 开关
    await go(A, 'web-design/'); await A.ev(`document.getElementById('modeToggleBtn').click()`); await sync(A);
    await go(Bd, 'web-design/'); await sync(Bd);
    m = await Bd.ev(`({ls:localStorage.getItem('webquiz_exammode'),btn:document.getElementById('modeToggleBtn').textContent})`);
    ok(m.ls === 'true' && /快速/.test(m.btn), 'A 点快速模式开关 → B 的开关跟着变（页面上也重画了）', m);

    /* ---------- 4. 开着的页面收到别的设备的改动：当场重画 ---------- */
    await go(Bd, ''); await go(A, '');
    await A.ev(`(()=>{const fs=loadFolders();fs.push({id:'fC',name:'实时'});saveFolders(fs);render();})()`); await sync(A);
    await sync(Bd); await sleep(100);
    ok(await Bd.ev(`[...document.querySelectorAll('#list .folder-name, #list .folder-title, #list *')].some(e=>e.children.length===0&&e.textContent==='实时')`), 'B 的首页开着：A 新建的文件夹同步过来后当场出现在列表里');

    /* ---------- 4b. /code-review 之后补的几条 ---------- */
    const ckey = () => [...R.store.keys()].find(x => x.indexOf('tiku:') === 0);
    const editCloud = fn => { const k = ckey(), d = JSON.parse(R.store.get(k)); fn(d.items); R.store.set(k, JSON.stringify(d)); };
    // 云端有这台设备存不下的（新加的科目、这台还是旧脚本；不合法的值）：同步几次也不能被当成「本机删了」、把墓碑传上去
    editCloud(items => { items.push({ id: 'zzznewquiz|wb|q1', updatedAt: Date.now(), v: { cat: '新科目', wrongCount: 1 } }, { id: 'webquiz|rc', updatedAt: Date.now() + 5, v: 'maybe' }); });
    await go(Bd, ''); await sync(Bd); await sync(Bd); await Bd.ev(`saveName('english-vocab','触发一次上传')`); await sync(Bd); await sync(Bd);
    m = cloud().items.filter(e => e.id === 'zzznewquiz|wb|q1' || e.id === 'webquiz|rc').map(e => e.id + (e.deletedAt ? ' 墓碑' : ' 活着'));
    ok(m.length === 2 && m.every(x => /活着/.test(x)), '存不下的远端条目：同步几轮也不会被当成本机删了（不传墓碑、别的设备上不会被删）', m);
    editCloud(items => { const i = items.findIndex(e => e.id === 'webquiz|rc'); if (i >= 0) items.splice(i, 1); });
    // 离线时改的：按改的那一刻记时间——联网后不能盖掉另一台设备更晚的改动
    await Bd.send('Network.enable'); await Bd.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    await Bd.ev(`saveName('english-reading','B离线时改的')`); await sleep(1500);
    await A.ev(`saveName('english-reading','A后来改的')`); await sync(A);
    await Bd.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }); await sleep(200);
    await sync(Bd); await sync(A);
    m = { A: await A.ev(`loadNames()['english-reading']`), B: await Bd.ev(`loadNames()['english-reading']`) };
    ok(m.A === 'A后来改的' && m.B === 'A后来改的', '离线时改的：联网后不会盖掉另一台设备更晚的改动（按改的那一刻记时间）', m);
    // 删了 120 天以上的墓碑：云端那份也清掉，不永远留着
    editCloud(items => { items.push({ id: 'n|zz-old', updatedAt: Date.now() - 200 * 864e5, deletedAt: Date.now() - 200 * 864e5 }); });
    await A.ev(`saveName('english-translation','顺手改一下')`); await sync(A);
    ok(!cloud().items.some(e => e.id === 'n|zz-old'), '删了 120 天以上的墓碑：下一次上传时从云端清掉');
    // 面板反复开关：同步状态的监听只挂一次
    m = await A.ev(`(async()=>{let n=0;const C=TikuSync.client,o=C.onState;C.onState=f=>{n++;return o(f)};const w=ms=>new Promise(r=>setTimeout(r,ms));
      for(let i=0;i<5;i++){openSyncSheet();await w(120);closeSheet();await w(60);}C.onState=o;openSyncSheet();await w(120);const k=document.querySelectorAll('.sp-code').length;const st=document.querySelector('#sheet [data-sp="state"]').textContent;closeSheet();return {n,k,st};})()`);
    ok(m.n <= 1 && m.k === 1 && /已同步|同步中/.test(m.st), '同步面板反复开关：监听只挂一次，面板照样显示状态', m);
    // 填空打字（只是「继续上次练习」变了）：不立刻整份上传，停手 4 秒再传
    await go(A, 'os/'); await A.ev(`(async()=>{document.getElementById('startBtn').click();await new Promise(r=>setTimeout(r,100));return 1;})()`); await sync(A);
    const p0 = log.filter(x => x.m === 'POST').length;
    await A.ev(`(()=>{const b=document.querySelector('#qText .blank-input');b.focus();b.textContent='打字中';b.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await sleep(2500); const p1 = log.filter(x => x.m === 'POST').length;
    await sleep(3500); const p2 = log.filter(x => x.m === 'POST').length;
    ok(p1 === p0 && p2 > p1, '填空打字只改了进度：2.5 秒内不上传，停手 4 秒后再传', { 之前: p0, '2.5秒': p1, '6秒': p2 });
    await go(A, '');

    /* ---------- 5. 跨域（页面在 GitHub Pages、接口在 Vercel）：简单请求、只放行白名单来源 ---------- */
    const gh = site(null, []); await new Promise(r => gh.listen(ghPort, '127.0.0.1', r));
    const G = await open(390, 844, 1); devs.push(G);
    await G.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.TIKU_SYNC_API=${JSON.stringify(B + 'api/sync')};` });
    await G.goto('http://127.0.0.1:' + ghPort + '/'); await sleep(200);
    log.length = 0;
    await G.ev(`TikuSync.client.enable(${JSON.stringify(CODE)})`); await sleep(200); await sync(G);
    await G.ev(`saveName('mobile-app','跨域改的')`); await sync(G);
    const posts = log.filter(x => x.m === 'POST'), opts = log.filter(x => x.m === 'OPTIONS');
    m = { posts: posts.map(x => x.ct + ' ' + x.status + ' ' + x.acao), opts: opts.length, name: await G.ev(`loadNames()['mobile-app']`), state: await G.ev('TikuSync.client.status.state') };
    ok(posts.length >= 1 && posts.every(x => /^text\/plain/.test(x.ct) && x.status === 200 && x.acao === 'http://127.0.0.1:' + ghPort) && opts.length === 0 && m.state === 'ok',
      '跨域：上传用 text/plain（不发预检），服务端回放行头，同步成功', m);
    await sync(A);
    ok(await A.ev(`loadNames()['mobile-app']`) === '跨域改的', '跨域那台的改动，同源这台收到了');
    const evil = await new Promise(r => { const q = http.request({ host: '127.0.0.1', port, path: '/api/sync', method: 'GET', headers: { origin: 'https://evil.example' } }, s => r(s.headers['access-control-allow-origin'] || '')); q.end(); });
    ok(evil === '', '跨域：白名单以外的来源不放行', evil);
    gh.close();

    /* ---------- 6. 数据量：所有科目全部题都进错题本 + 全做过，照样传得上去（上限见 api/sync.js MAX_BODY_BYTES） ---------- */
    await go(A, '');
    const big = await A.ev(`(async()=>{for(const s of SUBJECTS){const r=await fetch('./'+s.key+'/index.html').then(r=>r.text());const m=r.match(/const QUESTIONS\\s*=\\s*(\\[[\\s\\S]*?\\]);\\s*\\n/);if(!m)continue;const Q=(new Function('return '+m[1]))();
      const wb={},done={};Q.forEach((q,i)=>{wb['q'+i]={cat:q.cat,type:q.type||'blank',text:q.text||'',code:q.code||'',options:q.options||null,correct:q.correct||null,ans:q.ans||null,wrongCount:2,correctStreak:0,lastWrongAt:Date.now()};done['f'+i]=1;});
      localStorage.setItem(s.prefix+'_wrongbook',JSON.stringify(wb));localStorage.setItem(s.prefix+'_done',JSON.stringify(done));}
      TikuSync.changed();await TikuSync.client.syncNow();return {state:TikuSync.client.status.state,err:TikuSync.client.status.error};})()`);
    const c2 = cloud(), bytes = c2 ? Buffer.byteLength(JSON.stringify(c2)) : 0;
    ok(big.state === 'ok' && bytes < 3584 * 1024, '数据量：全部题进错题本 + 全做过，照样传得上去（' + Math.round(bytes / 1024) + 'KB，上限 3.5MB）', big);

    for (const d of devs) if (d.errors.length) ok(false, '同步：页面 JS 异常', d.errors);
  } finally {
    devs.forEach(d => { try { d.close(); } catch (e) {} });
    main.close(); R.srv.close();
  }
}

module.exports = { runSync };

if (require.main === module) {
  let pass = 0, fail = 0;
  const ok = (cond, name, detail) => { cond ? pass++ : fail++; if (!cond) console.log('  ✗ ' + name + (detail !== undefined ? '  → ' + JSON.stringify(detail) : '')); };
  runSync(ok).then(() => { console.log((fail ? 'FAIL' : 'PASS') + '  通过 ' + pass + '，失败 ' + fail); process.exit(fail ? 1 : 0); })
    .catch(e => { console.error('FAIL', e); process.exit(1); });
}
