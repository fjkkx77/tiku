// 四级词汇的三样东西（2026-10-23 用户要的）：DAY 快捷入口、首页自动放进「四级词汇」文件夹、「会 / 不会」标记。
//   tests/run.cjs 会调它；单独跑不了（要 run.cjs 起的静态服务器）
const { open, sleep } = require('./cdp.cjs');

async function runMarks(BASE, ok) {
  /* ---------- 首页：快捷入口、自动放文件夹 ---------- */
  const c = await open(390, 844, 1, { autoPlace: true });
  try {
    await c.goto(BASE); await c.ev('localStorage.clear();sessionStorage.clear()'); await c.goto(BASE);
    let r = await c.ev(`({
      folders: JSON.parse(localStorage.tiku_folders||"[]"),
      inF: [...document.querySelectorAll('.folder-card[data-fid="auto-cet4"] .item[data-key]')].map(x=>x.dataset.key),
      loose: [...document.querySelectorAll('#list > .item[data-key]')].map(x=>x.dataset.key),
      open: document.querySelector('.folder-card[data-fid="auto-cet4"]').classList.contains('open'),
      d3: document.querySelector('[data-key="cet4-vocab-day3"]').getAttribute('href') })`);
    const want = ['cet4-vocab'].concat(Array.from({ length: 15 }, (_, i) => 'cet4-vocab-day' + (i + 1)), ['cet4-spell']);
    ok(JSON.stringify(r.folders) === '[{"id":"auto-cet4","name":"四级词汇"}]' && JSON.stringify(r.inF) === JSON.stringify(want) && !r.loose.some(k => /^cet4/.test(k)) && !r.open,
      '首页：四级的两科 + 15 个 DAY 入口自动进「四级词汇」文件夹，默认收着', r);
    ok(r.d3 === './cet4-vocab/?cat=DAY%203', 'DAY 3 入口指向选意思科目、带 ?cat=DAY 3', r.d3);
    // 挪出来以后，刷新不会被放回去；删了文件夹也不会重建
    r = await c.ev(`(async()=>{const m=JSON.parse(localStorage.tiku_subject_folder);delete m["cet4-spell"];localStorage.tiku_subject_folder=JSON.stringify(m);location.reload();})()`).catch(() => null);
    await sleep(600);
    r = await c.ev(`[...document.querySelectorAll('#list > .item[data-key]')].map(x=>x.dataset.key)`);
    ok(r.includes('cet4-spell'), '首页：从文件夹挪出来的科目，刷新后不会被自动放回去', r);
    await c.ev(`localStorage.tiku_folders="[]";localStorage.tiku_subject_folder="{}";location.reload()`).catch(() => null); await sleep(600);
    r = await c.ev(`localStorage.tiku_folders`);
    ok(r === '[]', '首页：删掉自动建的文件夹后不会再自动建回来', r);
    // 用户已经自己把四级放进别的文件夹：不动
    await c.ev(`localStorage.clear();localStorage.tiku_folders=JSON.stringify([{id:"mine",name:"英语"}]);localStorage.tiku_subject_folder=JSON.stringify({"cet4-vocab":"mine"});location.reload()`).catch(() => null); await sleep(600);
    r = await c.ev(`JSON.parse(localStorage.tiku_subject_folder)`);
    ok(r['cet4-vocab'] === 'mine' && r['cet4-spell'] === 'auto-cet4', '首页：用户已经放好的科目不挪，没放过的才自动放', r);
    // DAY 入口的总题数和题库里这个 DAY 的题数一致
    await c.goto(BASE + 'cet4-vocab/');
    const perCat = await c.ev(`(()=>{const o={};QUESTIONS.forEach(q=>o[q.cat]=(o[q.cat]||0)+1);return o;})()`);
    await c.goto(BASE);
    const sc = await c.ev(`SHORTCUTS.map(s=>[s.cat,s.total])`);
    ok(sc.length === 15 && sc.every(([k, n]) => perCat[k] === n), '首页：每个 DAY 入口写的题数和题库一致', { sc, perCat });
  } finally { c.close(); }

  /* ---------- 科目页：?cat=、标记、自动改回、首页统计、备份 ---------- */
  const p = await open(390, 844, 1);
  try {
    await p.goto(BASE + 'cet4-vocab/'); await p.ev('localStorage.clear()'); await p.goto(BASE + 'cet4-vocab/?cat=DAY%205');
    let r = await p.ev(`[...document.querySelectorAll(".catChk:checked")].map(x=>x.value)`);
    ok(JSON.stringify(r) === '["DAY 5"]', '?cat=DAY 5：开始练习页只勾 DAY 5', r);
    await p.goto(BASE + 'cet4-vocab/?cat=DAY%2099');
    r = await p.ev(`document.querySelectorAll(".catChk:checked").length`);
    ok(r === 15, '?cat= 写的分类不存在：照常全勾，不会一个都不勾', r);
    await p.goto(BASE + 'os/?cat=DAY%201');
    r = await p.ev(`[document.getElementById("markCard"), document.getElementById("markKnow"), document.querySelectorAll(".catChk:checked").length===document.querySelectorAll(".catChk").length]`);
    ok(r[0] === null && r[1] === null && r[2] === true, '没开 marks 的科目：没有标记按钮和标记卡片，界面不变', r);

    await p.goto(BASE + 'cet4-vocab/?cat=DAY%202');
    r = await p.ev(`(async()=>{const w=ms=>new Promise(r=>setTimeout(r,ms));const Q=__quiz;
      document.getElementById("startBtn").click();await w(80);
      const s=Q.session; const a=s.queue[0], b=s.queue[1];
      document.getElementById("markDunno").click();await w(20);
      const on1=document.getElementById("markDunno").classList.contains("on")&&document.getElementById("markDunno").getAttribute("aria-pressed")==="true";
      document.getElementById("markDunno").click();await w(20);
      const off=!document.getElementById("markDunno").classList.contains("on")&&!Object.keys(Q.marks).length;
      document.getElementById("markDunno").click();await w(20);
      s.idx=1;Q.renderQuestion();
      const fresh=!document.getElementById("markDunno").classList.contains("on");
      document.getElementById("markKnow").click();await w(20);
      Q.pickOption("ABCD".replace(b.correct,"")[0]);await w(40);       // 标了「会」又答错 → 改回「不会」
      const down=Object.values(Q.marks).map(m=>m.s).sort().join(",");
      const tip=document.getElementById("ptrTip").textContent;
      s.idx=2;Q.renderQuestion();document.getElementById("markKnow").click();await w(20);
      Q.pickOption(s.queue[2].correct);await w(40);                      // 标了「会」答对 → 不变
      const keep=Object.values(Q.marks).filter(m=>m.s==="know").length;
      s.idx=0;Q.renderQuestion();
      const back=document.getElementById("markDunno").classList.contains("on");
      return {on1,off,fresh,down,tip,keep,back,stored:JSON.parse(localStorage.cet4vocabquiz_marks)};})()`);
    ok(r.on1 && r.off && r.fresh && r.back, '标记：点一下标上、再点取消；换题后显示那道题自己的标记', r);
    ok(r.down === 'dunno,dunno' && /改回「不会」/.test(r.tip), '标了「会」答错了：自动改回「不会」并提示', r);
    ok(r.keep === 1, '标了「会」答对了：保持「会」', r);
    ok(Object.values(r.stored).every(m => m.c === 'DAY 2' && m.t > 0), '标记存了分类和时间（首页按 DAY 数「不会」要用）', r.stored);

    // 开始练习页的卡片：按勾选的 DAY 数；点「不会的」只练这两题；DAY 3 下是 0、按钮不可点
    await p.ev(`document.querySelector('nav [data-screen="home"]').click()`); await sleep(100);
    if (await p.ev(`document.getElementById("confirmBackdrop").classList.contains("show")`)) { await p.ev(`document.getElementById("confirmOkBtn").click()`); await sleep(100); }
    r = await p.ev(`(async()=>{const w=ms=>new Promise(r=>setTimeout(r,ms));
      const t=()=>document.getElementById("markCard").innerText.replace(/\\s+/g," ");
      const a=t(), dis2=document.getElementById("markGoDunno").disabled;
      document.querySelectorAll(".catChk").forEach(c=>c.checked=c.value==="DAY 3");document.getElementById("catList").dispatchEvent(new Event("change"));
      const b=t(), dis3=document.getElementById("markGoDunno").disabled;
      document.getElementById("selAll").click();
      document.getElementById("markGoDunno").click();await w(80);
      if(document.getElementById("confirmBackdrop").classList.contains("show")){document.getElementById("confirmOkBtn").click();await w(80);}
      const q=__quiz.session.queue, ids=Object.keys(__quiz.marks);
      return {a,b,dis2,dis3,n:q.length,allDunno:q.every(x=>__quiz.marks[__quiz.fp(x)]&&__quiz.marks[__quiz.fp(x)].s==="dunno"),scope:document.getElementById("quizScopeText").textContent};})()`);
    ok(/不会的 2/.test(r.a) && /会的 1/.test(r.a) && !r.dis2, '开始练习页：「不会的 2 · 会的 1」', r.a);
    ok(/不会的 0/.test(r.b) && r.dis3, '开始练习页：改勾 DAY 3 后只数 DAY 3（0 个，入口不可点）', r.b);
    ok(r.n === 2 && r.allDunno, '点「不会的」：只练标了「不会」的题', r);

    // 首页卡片统计：选意思总入口和 DAY 2 入口都显示「不会 2」，DAY 3 不显示；已做按 DAY 数
    await p.goto(BASE);
    r = await p.ev(`["cet4-vocab","cet4-vocab-day2","cet4-vocab-day3"].map(k=>document.querySelector('[data-key="'+k+'"] .desc').textContent)`);
    ok(/不会 2/.test(r[0]) && /已做 2/.test(r[0]) && /不会 2/.test(r[1]) && /已做 2/.test(r[1]) && /还没练过/.test(r[2]) && !/不会/.test(r[2]),
      '首页：总入口和 DAY 2 入口显示「已做 2 · 不会 2」（第 1 题只标没答，不算做过），DAY 3 照旧「还没练过」', r);

    // 导出备份带上标记；清空后导入能回来；导入时同一题留后标的
    r = await p.ev(`(async()=>{const w=ms=>new Promise(r=>setTimeout(r,ms));
      let blob=null;const orig=URL.createObjectURL;URL.createObjectURL=b=>{blob=b;return orig.call(URL,b);};exportBackup();await w(50);const text=await blob.text();
      const has=Object.keys(JSON.parse(text).items).includes("cet4vocabquiz_marks");
      const k=Object.keys(JSON.parse(localStorage.cet4vocabquiz_marks))[0];
      localStorage.cet4vocabquiz_marks=JSON.stringify({[k]:{s:"know",t:1,c:"DAY 2"}});
      const p=importBackup(new File([text],"b.json"));await w(60);document.getElementById("confirmOkBtn").click();await p;
      const m=JSON.parse(localStorage.cet4vocabquiz_marks);
      return {has,n:Object.keys(m).length,k:m[k].s};})()`);
    ok(r.has && r.n === 3 && r.k === 'dunno', '导出备份带上标记；导入合并时同一题留后标的那个', r);

    /* ---------- 进行中的练习：每个范围各一份（2026-10-24 用户报的场景） ---------- */
    await p.goto(BASE + 'cet4-vocab/'); await p.ev('localStorage.clear()');
    // 旧版留下的单份存档：打开时并进列表，不丢
    await p.ev(`(()=>{const ids=QUESTIONS.slice(0,5).map((q,i)=>"q"+i);localStorage.setItem("cet4vocabquiz_inprogress",JSON.stringify({ids,fps:QUESTIONS.slice(0,5).map(q=>__quiz.fp(q)),answers:[{allCorrect:true,selectedOpt:"A"},{allCorrect:true,selectedOpt:"A"},null,null,null],idx:2,elapsed:0,scopeLabel:"全部DAY",savedAt:1}));})()`);
    await p.goto(BASE + 'cet4-vocab/');
    r = await p.ev(`({old:localStorage.getItem("cet4vocabquiz_inprogress"),slots:Object.keys(JSON.parse(localStorage.getItem("cet4vocabquiz_progs")||"{}")),rows:[...document.querySelectorAll("#resumeList .resume-row")].map(x=>x.innerText.replace(/\\s+/g," "))})`);
    ok(r.old === null && JSON.stringify(r.slots) === '["全部DAY"]' && /全部DAY/.test(r.rows[0]) && /2\/5/.test(r.rows[0]), '旧版的单份进度：打开时并进「进行中的练习」，不丢', r);
    // 主线做了 3 题 → 标一个「不会」→ 去刷「不会的」→ 再去错题本练 → 回来主线进度原样
    r = await p.ev(`(async()=>{const w=ms=>new Promise(r=>setTimeout(r,ms));const Q=__quiz,yes=()=>{if(document.getElementById("confirmBackdrop").classList.contains("show"))document.getElementById("confirmOkBtn").click();};
      document.getElementById("resumeList").querySelector(".resume-del").click();await w(40);yes();await w(40);
      document.getElementById("startBtn").click();await w(60);
      for(let i=0;i<3;i++){Q.session.idx=i;Q.renderQuestion();Q.pickOption("ABCD".replace(Q.session.queue[i].correct,"")[0]);await w(10);}
      Q.session.idx=3;Q.renderQuestion();Q.setMark("dunno");
      document.querySelector('nav button[data-screen="home"]').click();await w(40);yes();await w(40);
      document.getElementById("markGoDunno").click();await w(60);const dunnoAsked=document.getElementById("confirmBackdrop").classList.contains("show");
      Q.pickOption(Q.session.queue[0].correct);const dunnoScope=Q.session.scopeLabel;
      document.querySelector('nav button[data-screen="wrongbook"]').click();await w(40);yes();await w(60);
      [...document.querySelectorAll("button")].find(b=>/练习全部错题/.test(b.textContent)).click();await w(60);const wbAsked=document.getElementById("confirmBackdrop").classList.contains("show");
      Q.pickOption(Q.session.queue[0].correct);const wbScope=Q.session.scopeLabel;
      document.querySelector('nav button[data-screen="home"]').click();await w(40);yes();await w(40);
      const ps=JSON.parse(localStorage.getItem("cet4vocabquiz_progs"));
      document.getElementById("startBtn").click();await w(60);
      return {dunnoAsked,wbAsked,dunnoScope,wbScope,slots:Object.keys(ps).sort(),main:ps["全部DAY"]&&ps["全部DAY"].answers.filter(Boolean).length,
        back:{scope:Q.session.scopeLabel,idx:Q.session.idx,n:Q.session.answers.filter(Boolean).length},rows:document.querySelectorAll("#resumeList .resume-row").length};})()`);
    ok(!r.dunnoAsked && !r.wbAsked, '开「不会的」、错题本练习：不再弹「会覆盖上次练习」', r);
    ok(r.slots.length === 3 && r.main === 3 && r.back.scope === '全部DAY' && r.back.n === 3 && r.back.idx === 3,
      '主线做到第 4 题 → 刷不会的 → 刷错题本 → 回来点开始练习：主线 3 题的进度原样接上', r);
    // 最多 10 份：第 11 份进来时删最久没碰的那份并提示
    r = await p.ev(`(async()=>{const w=ms=>new Promise(r=>setTimeout(r,ms));const Q=__quiz;
      for(let d=1;d<=10;d++){Q.showScreen("home");await w(60);document.querySelectorAll(".catChk").forEach(c=>c.checked=c.value==="DAY "+d);document.getElementById("startBtn").click();await w(30);Q.pickOption(Q.session.queue[0].correct);await w(5);}
      const ps=JSON.parse(localStorage.getItem("cet4vocabquiz_progs"));
      return {n:Object.keys(ps).length,gone:!("全部DAY（不会的）" in ps),tip:document.getElementById("ptrTip").textContent};})()`);
    ok(r.n === 10 && /最多留 10 份/.test(r.tip), '进行中的练习最多 10 份：多出来的删最久没碰的那份，并提示', r);
  } finally { p.close(); }
}
module.exports = { runMarks };
