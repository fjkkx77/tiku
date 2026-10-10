// 刷题站回归测试：改了 assets/quiz.js / quiz.css / 任意科目页之后跑一遍。
//   node tests/run.cjs            （在仓库根目录跑；需要本机装了 Chrome，路径见 cdp.cjs 里的 CHROME）
// 跑的是真浏览器（headless Chrome + 真窄屏视口 + 真触摸事件），四组检查：
//   1. 判分快照：8 个站共 2690 条用例，结果必须和 2026-10-07 合并前旧站逐条一致（grading-snapshot.json）
//   2. 逻辑：这次修过的每个 bug 各一条用例，防止改回去
//   3. 手势：左右滑动切题、下拉刷新（320/390/430 三档）
//   4. 版面：8 个站 × 4 个界面 × 3 档宽度，不许横向溢出
// 退出码 0 = 全过。
const http = require('http'), fs = require('fs'), path = require('path');
const { open, sleep } = require('./cdp.cjs');
const ROOT = path.resolve(__dirname, '..');
const SITES = ['web-design','software-engineering','mobile-app','os','english-listening','english-reading','english-vocab','english-translation'];
const MIME = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.json':'application/json' };

let pass = 0, fail = 0;
const ok = (cond, name, detail) => { cond ? pass++ : fail++; if (!cond) console.log('  ✗ ' + name + (detail !== undefined ? '  → ' + JSON.stringify(detail) : '')); };

function serve() {
  return new Promise(res => {
    const srv = http.createServer((q, s) => {
      let rel = decodeURIComponent(new URL(q.url, 'http://x').pathname);
      let f = path.join(ROOT, rel);
      if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
      fs.readFile(f, (e, d) => { if (e) { s.writeHead(404); return s.end('404'); } s.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' }); s.end(d); });
    });
    srv.listen(0, '127.0.0.1', () => res(srv));
  });
}

(async () => {
  const srv = await serve();
  const BASE = 'http://127.0.0.1:' + srv.address().port + '/';
  const c = await open(390, 844, 1);
  const fresh = async u => { await c.goto(BASE + u); await c.ev('localStorage.clear();sessionStorage.clear()'); await c.goto(BASE + u); };
  const start = 'document.getElementById("startBtn").click();await new Promise(r=>setTimeout(r,50));const Q=__quiz;';
  try {
    /* ---------- 1. 判分快照 ---------- */
    const snap = JSON.parse(fs.readFileSync(path.join(__dirname, 'grading-snapshot.json'), 'utf8')).cases;
    let n = 0;
    for (const s of SITES) {
      await c.goto(BASE + s + '/');
      // 走引擎自己的判分入口 gradeQuestion（页面点「提交」走的也是它），不在测试里另写一份"这题该用哪种判法"
      const got = await c.ev(`(()=>${JSON.stringify(snap[s])}.map(t=>__quiz.gradeQuestion(QUESTIONS[t.q],t.in).allCorrect))()`);
      snap[s].forEach((t, i) => { n++; ok(got[i] === t.ok, `判分 ${s} 第${t.q}题 ${JSON.stringify(t.in)}`, { 应为: t.ok, 实际: got[i] }); });
    }
    console.log(`1. 判分快照 ${n} 条`);

    /* ---------- 2. 逻辑 ---------- */
    let r;
    await fresh('web-design/');
    r = await c.ev(`(async()=>{document.querySelector('input[value="random"]').checked=true;${start}let sw=0;const q=Q.session.queue;for(let i=1;i<q.length;i++)if(q[i].type!==q[i-1].type)sw++;return sw;})()`);
    ok(r === 1, '随机顺序：单选、填空各成一段不穿插', r);
    await fresh('english-reading/');
    r = await c.ev(`(async()=>{${start}let sw=0;const q=Q.session.queue;for(let i=1;i<q.length;i++)if(q[i].type!==q[i-1].type)sw++;return sw;})()`);
    ok(r === 1, '原始顺序（阅读站）：同样不穿插', r);
    await fresh('web-design/');
    r = await c.ev(`(async()=>{${start}Q.pickOption(Q.session.queue[0].correct);Q.finishQuiz();return document.getElementById("resRate").textContent;})()`);
    ok(r === '100%', '正确率 = 答对 / 已答', r);
    r = await c.ev(`(async()=>{const Q=__quiz;document.getElementById("backToQuizBtn").click();Q.session.idx=1;Q.renderQuestion();Q.submitAnswer();Q.finishQuiz();return {n:Q.history.length,w:Q.history[0].wrong};})()`);
    ok(r.n === 1 && r.w === 1, '返回本次练习再结束：更新同一条记录，不重复', r);
    r = await c.ev(`(async()=>{const Q=__quiz;Q.submitAnswer();return Q.wrongbook[Q.session.queue[1].id].wrongCount;})()`);
    ok(r === 1, '同一题重复提交不会重复记错', r);
    await fresh('web-design/');
    await c.ev(`(async()=>{${start}})()`); await sleep(1000);
    await c.ev('__quiz.showScreen("history")'); await sleep(1500);
    r = await c.ev(`(async()=>{const Q=__quiz;Q.showScreen("home");document.getElementById("resumeContinueBtn").click();await new Promise(r=>setTimeout(r,300));Q.pickOption(Q.session.queue[0].correct);Q.finishQuiz();return Q.history[0].durationSec;})()`);
    ok(r >= 1 && r <= 2, '用时只算停在答题页上的时间（离开的 1.5 秒不算）', r);
    await fresh('web-design/');
    r = await c.ev(`(async()=>{document.getElementById("selNone").click();document.getElementById("startBtn").click();await new Promise(r=>setTimeout(r,50));return {native:window.__alerts.length,show:document.getElementById("confirmBackdrop").classList.contains("show"),cancelHidden:document.getElementById("confirmCancelBtn").hidden};})()`);
    ok(r.native === 0 && r.show && r.cancelHidden, '没选章节：用自己的弹窗，不用原生 alert', r);
    await c.ev('document.getElementById("confirmOkBtn").click();document.getElementById("selAll").click()');
    r = await c.ev(`(async()=>{${start}Q.pickOption(Q.session.queue[0].correct);Q.showScreen("home");document.getElementById("startBtn").click();await new Promise(r=>setTimeout(r,50));const show=document.getElementById("confirmBackdrop").classList.contains("show");document.getElementById("confirmCancelBtn").click();await new Promise(r=>setTimeout(r,50));return {show,kept:JSON.parse(localStorage.getItem("webquiz_inprogress")).answers.filter(Boolean).length};})()`);
    ok(r.show && r.kept === 1, '有没做完的练习时开始新练习：先确认，取消则保留', r);
    await fresh('os/');
    r = await c.ev(`(async()=>{${start}const inp=document.querySelector("#qText .blank-input");inp.value="x";inp.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",isComposing:true,bubbles:true}));return !!Q.session.answers[0]||document.activeElement!==inp;})()`);
    ok(r === false, '中文输入法组字时按回车不提交', r);
    await fresh('english-translation/');
    r = await c.ev(`(async()=>{${start}const t=document.querySelector(".trans-area");t.value="a "+Q.session.queue[0].vocab[0];t.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true}));const a=!!Q.session.answers[0];t.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",ctrlKey:true,bubbles:true}));const asked=!!document.getElementById("selfRightBtn")&&!Q.session.answers[0];document.getElementById("selfWrongBtn").click();return {a,asked,rec:Q.session.answers[0],wb:Object.keys(Q.wrongbook).length,box:document.getElementById("answerBox").textContent};})()`);
    ok(!r.a && r.asked, '翻译框：回车换行不提交，Ctrl+回车提交后先亮参考译文、等本人判', r);
    ok(r.rec && r.rec.allCorrect === false && r.rec.self === true && r.wb === 1 && /你判定：没译对/.test(r.box), '翻译题：点「没译对」才记成答错并进错题本（关键词用到了也一样）', r);
    r = await c.ev(`(()=>QUESTIONS.filter(q=>!__quiz.gradeQuestion(q,[q.ans[0]]).allCorrect).map(q=>q.text.slice(0,12)))()`);
    ok(r.length === 0, '翻译站：每道题的参考译文自己都能命中关键词提示', r);
    await fresh('web-design/');
    await c.ev(`(()=>{const q=QUESTIONS[3];localStorage.setItem("webquiz_wrongbook",JSON.stringify({q5:{cat:q.cat,type:q.type,text:q.text,options:q.options,correct:q.correct,wrongCount:1,correctStreak:0,lastWrongAt:1}}));})()`);
    await c.goto(BASE + 'web-design/');
    ok(JSON.stringify(await c.ev('Object.keys(__quiz.wrongbook)')) === '["q3"]', '错题记录对不上题号时按内容找回');
    await c.ev(`localStorage.setItem("webquiz_inprogress",JSON.stringify({ids:["q0"],fps:["x"],answers:[null],idx:0,elapsed:0,scopeLabel:"t"}))`);
    await c.goto(BASE + 'web-design/');
    ok(await c.ev('document.getElementById("resumeCard").hidden') === true, '续练进度对不上题库时作废');
    r = await c.ev(`(()=>{const Q=__quiz;Q.session={queue:[{id:"zz",type:"blank",cat:"x",text:"<b>x</b>{{}}<img src=x onerror=window.__pwn=1>",ans:["a"]}],idx:0,answers:[null],elapsed:0,scopeLabel:"t"};Q.showScreen("quiz");Q.renderQuestion();const t=document.getElementById("qText");return {tags:t.querySelectorAll("b,img").length,inputs:t.querySelectorAll("input").length};})()`);
    await sleep(100);
    ok(r.tags === 0 && r.inputs === 1 && !(await c.ev('!!window.__pwn')), '题干里的 < > 按文字显示', r);
    for (const s of ['os', 'english-vocab', 'english-translation']) {
      await fresh(s + '/');
      r = await c.ev(`(async()=>{${start}Q.finishQuiz();return parseFloat(getComputedStyle(document.getElementById("resRate")).fontSize);})()`);
      ok(r === 28, `结果页正确率大号显示（${s}）`, r);
    }
    /* ----- 2026-10-10 审查整改：每条都先在改坏的版本上看过它变红 ----- */
    const W8 = 'const w=ms=>new Promise(r=>setTimeout(r,ms));';
    const goto = 'const go=i=>{Q.session.idx=typeof i==="number"?i:Q.session.queue.indexOf(i);Q.renderQuestion();};const ins=()=>[...document.querySelectorAll("#qText .blank-input,#qCode .blank-input")];';
    // 判分：位置、无序、局部可换、序列、包含规则
    await fresh('web-design/');
    r = await c.ev(`(async()=>{${start}${goto}go(QUESTIONS[77]);const i=ins();i[0].value="Request.Cookies";i[1].value="Response.Cookies";document.getElementById("checkBtn").click();
      const a=Q.session.answers[Q.session.idx];const q55=QUESTIONS[55],ref=q55.ans.map(x=>x.split("|")[0]);const sw=(x,y)=>{const t=ref.slice();[t[x],t[y]]=[t[y],t[x]];return Q.gradeQuestion(q55,t).allCorrect;};
      return {rev:a.allCorrect,cls:i.map(x=>x.className.includes("wrong")),wb:!!Q.wrongbook[QUESTIONS[77].id],ls:Object.keys(JSON.parse(localStorage.getItem("webquiz_wrongbook")||"{}")).length,same:Q.gradeQuestion(q55,ref).allCorrect,inGroup:sw(13,15),outGroup:sw(0,1),un:Q.gradeQuestion(QUESTIONS[54],QUESTIONS[54].ans.map(x=>x.split("|")[0]).reverse()).allCorrect};})()`);
    ok(r.rev === false && r.cls.every(Boolean) && r.wb && r.ls === 1, '多空题真点提交：两个空填反 → 判错、框变红、进错题本并写进存储', r);
    ok(r.same && r.inGroup && !r.outGroup, '只有标了可互换的那几个空能换位置（第 56 题 #navigation 的 3 个空）', r);
    ok(r.un === true, '标了 unordered 的题换顺序填仍判对', r);
    await fresh('os/');
    r = await c.ev(`(()=>{const Q=__quiz,g=(i,a)=>Q.gradeQuestion(QUESTIONS[i],a).allCorrect;return {seqRev:g(83,["R,P,Q"]),seqOk:g(83,["Q,P,R"]),un:g(0,["虚拟","异步","共享","并发"]),fifo:g(81,["7","9"]),n150:g(84,["150","14","16K"]),neg:g(9,["不可再现"]),pos:g(9,["可再现性"]),more:g(22,["操作系统"])};})()`);
    ok(!r.seqRev && r.seqOk, '安全序列：顺序反了判错，对的判对', r);
    ok(r.un && !r.fifo, '操作系统：真无序的题换序判对，FIFO/LRU 填反判错', r);
    ok(!r.n150 && !r.neg && r.pos && r.more, '「包含也算对」：数字多一位、前面加否定词不算；多写无关的字仍算', r);
    await fresh('english-vocab/');
    r = await c.ev(`(()=>{const Q=__quiz,q=QUESTIONS[0],ref=q.ans.map(x=>x.split("|")[0]);const t=ref.slice();t[8]=t[8]+"s";const u=ref.slice();u[1]="\\u2018"+"x";return {ok:Q.gradeQuestion(q,ref).allCorrect,plural:Q.gradeQuestion(q,t).assignment[8],curly:Q.isCorrect("of one\\u2019s own","of one's own")};})()`);
    ok(r.ok && r.plural === -1 && r.curly, '英语选词：多写一个 s 判错；iPhone 的弯撇号当直撇号', r);
    // 错题本：连续答对 3 次才移出
    await fresh('mobile-app/');
    r = await c.ev(`(async()=>{${W8}${start}const q=Q.session.queue[0],bad=Object.keys(q.options).find(L=>L!==q.correct);Q.pickOption(bad);const out=[];
      for(let k=0;k<3;k++){Q.finishQuiz();Q.startQuiz([q],"t",false);await w(30);Q.pickOption(q.correct);out.push(!!Q.wrongbook[q.id]);}
      return {out,ip:localStorage.getItem("mobileappquiz_inprogress")!==null};})()`);
    ok(JSON.stringify(r.out) === '[true,true,false]', '错题要连续答对 3 次才移出错题本', r);
    // 快速模式自动跳题、结束后清进度、只练本次错题、总览跳题
    await fresh('mobile-app/');
    r = await c.ev(`(async()=>{${W8}${start}const q0=Q.session.queue[0];Q.pickOption(q0.correct);await w(450);const auto=Q.session.idx;
      const q1=Q.session.queue[1];Q.pickOption(Object.keys(q1.options).find(L=>L!==q1.correct));await w(450);const stay=Q.session.idx;
      Q.openOverview();document.querySelector('.ov-item[data-idx="6"]').click();const jump=Q.session.idx;
      Q.finishQuiz();const cleared=localStorage.getItem("mobileappquiz_inprogress")===null;
      document.getElementById("retryWrongBtn").click();await w(60);return {auto,stay,jump,cleared,retry:Q.session.queue.map(x=>x.id),want:[q1.id]};})()`);
    ok(r.auto === 1 && r.stay === 1, '快速模式：选对自动跳下一题，选错停在本题', r);
    ok(r.jump === 6, '题目总览点第 7 题就到第 7 题', r);
    ok(r.cleared, '结束练习后清掉续练进度', r);
    ok(JSON.stringify(r.retry) === JSON.stringify(r.want), '「只练本次错题」拿到的是答错的那几道', r);
    // 练习记录：最多 100 条；一题没答不记
    await fresh('mobile-app/');
    r = await c.ev(`(async()=>{${start}Q.finishQuiz();const zero=Q.history.length;const many=[];for(let i=0;i<120;i++)many.push({date:i+1,scope:"x",total:1,correct:1,wrong:0,durationSec:1});localStorage.setItem("mobileappquiz_history",JSON.stringify(many));
      document.getElementById("retryAllBtn").click();await new Promise(r=>setTimeout(r,60));Q.pickOption(Q.session.queue[0].correct);Q.finishQuiz();return {zero,n:Q.history.length,ls:JSON.parse(localStorage.getItem("mobileappquiz_history")).length};})()`);
    ok(r.zero === 0, '一题没答就结束：不记练习记录', r);
    ok(r.n === 100 && r.ls === 100, '练习记录最多留 100 条', r);
    // 两个页面不互相覆盖（同源 iframe 就是第二个页面：有自己的一份引擎和内存）
    await fresh('web-design/');
    r = await c.ev(`(async()=>{${W8}const f=document.createElement("iframe");f.src=location.href;document.body.appendChild(f);await new Promise(r=>f.onload=r);await w(200);const B=f.contentWindow;
      B.document.getElementById("startBtn").click();await w(80);let q=B.__quiz.session.queue[0];B.__quiz.pickOption(Object.keys(q.options).find(L=>L!==q.correct));B.__quiz.finishQuiz();
      ${start}Q.session.idx=4;Q.renderQuestion();q=Q.session.queue[4];Q.pickOption(Object.keys(q.options).find(L=>L!==q.correct));Q.finishQuiz();f.remove();
      return {wb:Object.keys(JSON.parse(localStorage.getItem("webquiz_wrongbook"))).sort(),h:JSON.parse(localStorage.getItem("webquiz_history")).length};})()`);
    ok(JSON.stringify(r.wb) === '["q0","q4"]' && r.h === 2, '同一科目开两个页面：各自记的错题和记录都在，不互相冲掉', r);
    // 页面被冻住期间（按返回恢复出来的旧页面）别的页面写了存储，这一页收不到通知：靠"写之前先重读"兜住
    await fresh('web-design/');
    r = await c.ev(`(async()=>{${start}localStorage.setItem("webquiz_wrongbook",JSON.stringify({q9:{cat:"x",type:"mcq",text:"别的页面记的",wrongCount:1,correctStreak:0,lastWrongAt:1}}));
      localStorage.setItem("webquiz_history",JSON.stringify([{date:7,scope:"别的页面",total:1,correct:0,wrong:1,durationSec:1}]));
      const q=Q.session.queue[0];Q.pickOption(Object.keys(q.options).find(L=>L!==q.correct));Q.finishQuiz();
      return {wb:Object.keys(JSON.parse(localStorage.getItem("webquiz_wrongbook"))).sort(),h:JSON.parse(localStorage.getItem("webquiz_history")).length};})()`);
    ok(JSON.stringify(r.wb) === '["q0","q9"]' && r.h === 2, '写错题本和记录之前先重读存储：别处刚记的不会被这一页的旧数据冲掉', r);
    // 旧页面不覆盖更新的进度：别的页面把这场练习接着做了，这一页回到前台就让位
    await fresh('mobile-app/');
    r = await c.ev(`(async()=>{${W8}${start}Q.pickOption(Q.session.queue[0].correct);await w(20);const s=JSON.parse(localStorage.getItem("mobileappquiz_inprogress"));
      s.sid="other-page";s.savedAt=Date.now()+5000;s.idx=7;localStorage.setItem("mobileappquiz_inprogress",JSON.stringify(s));
      Q.session.idx=3;Q.renderQuestion();const kept=JSON.parse(localStorage.getItem("mobileappquiz_inprogress")).idx;Q.refreshFromStorage();await w(50);
      return {kept,home:document.getElementById("screen-home").classList.contains("active"),told:document.getElementById("confirmBackdrop").classList.contains("show"),gone:Q.session===null};})()`);
    ok(r.kept === 7 && r.home && r.told && r.gone, '别的页面有更新的进度时：旧页面不覆盖它，并回到首页说明', r);
    await c.ev('document.getElementById("confirmOkBtn").click()');
    // 没提交的输入：换题回来还在、存档里也有；提示文字里有交代
    await fresh('english-vocab/');
    r = await c.ev(`(async()=>{${W8}${start}${goto}ins().slice(0,10).forEach((x,k)=>{x.value="word"+k;x.dispatchEvent(new Event("input",{bubbles:true}));});
      document.getElementById("nextBtn").click();await w(30);document.getElementById("prevBtn").click();await w(30);const back=ins().filter(x=>x.value).length;
      const ls=localStorage.getItem("engvocabquiz_inprogress").includes("word3");
      document.querySelector('nav button[data-screen="home"]').click();await w(30);document.getElementById("confirmOkBtn").click();await w(30);document.getElementById("resumeContinueBtn").click();await w(30);
      return {back,ls,resume:ins().filter(x=>x.value).length,unanswered:!Q.session.answers[0]};})()`);
    ok(r.back === 10 && r.ls && r.resume === 10 && r.unanswered, '填了一半没提交：换题、切走再续练回来都还在（且不算已作答）', r);
    // 续练卡片上的「重新练习」：答过题要先确认
    await fresh('mobile-app/');
    r = await c.ev(`(async()=>{${W8}${start}for(let i=0;i<3;i++){Q.session.idx=i;Q.renderQuestion();Q.pickOption(Q.session.queue[i].correct);}
      Q.showScreen("home");document.querySelector('nav button[data-screen="home"]').click();await w(30);document.getElementById("resumeRestartBtn").click();await w(60);
      const asked=document.getElementById("confirmBackdrop").classList.contains("show");document.getElementById("confirmCancelBtn").click();await w(30);
      return {asked,kept:JSON.parse(localStorage.getItem("mobileappquiz_inprogress")).answers.filter(Boolean).length};})()`);
    ok(r.asked && r.kept === 3, '续练卡片「重新练习」：已答过题先确认，取消则进度还在', r);
    // 存储写满：要告诉人
    await fresh('mobile-app/');
    r = await c.ev(`(async()=>{${W8}let c="x".repeat(1024*1024),n=0;try{for(;;){localStorage.setItem("fill_"+n,c);n++;}}catch(e){}let s="y".repeat(512),m=0;try{for(;;){localStorage.setItem("f_"+m,s);m++;}}catch(e){}let k=0;try{for(;;){localStorage.setItem("t"+k,"z");k++;}}catch(e){}
      ${start}const q=Q.session.queue[0];Q.pickOption(Object.keys(q.options).find(L=>L!==q.correct));await w(80);
      const r={told:document.getElementById("confirmBackdrop").classList.contains("show"),msg:document.getElementById("confirmMsg").textContent.slice(0,14)};localStorage.clear();return r;})()`);
    ok(r.told && /存不进/.test(r.msg), '浏览器空间写满：弹出提示，不再悄悄丢', r);
    // 坏数据、存储里的数字字段
    await c.goto(BASE + 'web-design/'); await c.ev(`localStorage.clear();localStorage.setItem("webquiz_wrongbook",'{"q1":null,"q2":"x"}');localStorage.setItem("webquiz_history",JSON.stringify([null,{date:1,scope:"x",total:'<img src=x onerror="window.__pwn=1">',correct:0,wrong:0,durationSec:1}]))`);
    await c.goto(BASE + 'web-design/');
    r = await c.ev(`(async()=>{__quiz.showScreen("history");await new Promise(r=>setTimeout(r,200));return {cats:document.querySelectorAll(".catChk").length,items:document.querySelectorAll(".history-item").length,pwn:!!window.__pwn};})()`);
    ok(r.cats > 0 && r.items === 1 && !r.pwn, '存储里的坏数据不会让页面打不开，数字字段不会被当成 HTML', r);
    // 键盘：焦点停在按钮上时字母键照常；弹窗接 Esc / 回车
    await fresh('mobile-app/');
    r = await c.ev(`(async()=>{${W8}${start}const nb=document.getElementById("nextBtn");nb.focus();const q=Q.session.queue[0],bad=Object.keys(q.options).find(L=>L!==q.correct);
      nb.dispatchEvent(new KeyboardEvent("keydown",{key:bad.toLowerCase(),bubbles:true}));const typed=!!Q.session.answers[0];
      document.getElementById("quitQuizBtn").click();await w(30);document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}));await w(30);
      const esc=!document.getElementById("confirmBackdrop").classList.contains("show")&&document.getElementById("screen-quiz").classList.contains("active");
      document.getElementById("quitQuizBtn").click();await w(30);document.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true}));await w(30);
      return {typed,esc,enter:document.getElementById("screen-result").classList.contains("active")};})()`);
    ok(r.typed, '键盘：焦点停在「下一题」按钮上时，字母键仍能选选项', r);
    ok(r.esc && r.enter, '确认弹窗：Esc = 取消，回车 = 确定', r);
    // 背题模式：只看答案，不记对错
    await fresh('mobile-app/');
    r = await c.ev(`(async()=>{${start}document.getElementById("reciteBtn").click();Q.pickOption("A");Q.submitAnswer();const box=document.getElementById("answerBox").textContent;
      return {none:!Q.session.answers[0],wb:Object.keys(Q.wrongbook).length,shown:box.includes(Q.session.queue[0].correct+"."),btn:document.getElementById("checkBtn").hidden};})()`);
    ok(r.none && r.wb === 0 && r.shown && r.btn, '背题模式：直接显示答案，不计对错、不进错题本', r);
    await c.ev('localStorage.clear()');
    // 答题中点🏠：先确认
    await fresh('mobile-app/');
    r = await c.ev(`(async()=>{${W8}${start}document.querySelector(".home-btn").click();await w(60);const asked=document.getElementById("confirmBackdrop").classList.contains("show");document.getElementById("confirmCancelBtn").click();await w(30);return {asked,still:location.pathname.includes("mobile-app")};})()`);
    ok(r.asked && r.still, '答题中点左上角🏠：先确认，取消则留在本页', r);
    // 只练没做过的 + 首页显示做过几题
    await fresh('mobile-app/');
    r = await c.ev(`(async()=>{${W8}${start}Q.pickOption(Q.session.queue[0].correct);await w(20);Q.finishQuiz();Q.showScreen("home");document.querySelector('nav button[data-screen="home"]').click();await w(30);
      const txt=document.querySelector(".cat-count").textContent;document.getElementById("onlyNew").checked=true;document.getElementById("startBtn").click();await w(60);return {txt,n:Q.session.queue.length};})()`);
    ok(/做过1/.test(r.txt) && r.n === 9, '首页显示每章做过几题；「只练没做过的题」跳过已做的', r);
    // 版本号盖了没有（改了共用文件却没跑 node tools/stamp.cjs，手机 10 分钟内会拿到旧文件）
    { let stale = false; try { require('child_process').execFileSync('node', [path.join(ROOT, 'tools', 'stamp.cjs'), '--check'], { stdio: 'ignore' }); } catch (e) { stale = true; } ok(!stale, '科目页里的版本号和共用文件对得上（对不上就跑 node tools/stamp.cjs）'); }
    /* ----- 汇总首页 ----- */
    await c.goto(BASE); await c.ev('localStorage.clear()'); await c.goto(BASE);
    r = await c.ev(`(async()=>{const out={};for(const s of SUBJECTS){const h=await (await fetch(s.href+"index.html")).text();const m=h.match(/prefix:\\s*"([^"]+)"/);out[s.key]=[s.prefix,m&&m[1]];}return out;})()`);
    ok(Object.values(r).every(([a, b]) => a && a === b), '首页科目清单里的存储前缀和各科目页一致（导出备份靠它）', r);
    for (const [k, v] of [['tiku_folders', 'null'], ['tiku_folders', '{}'], ['tiku_folders', '[null]'], ['tiku_subject_folder', 'null'], ['tiku_custom_names', 'null']]) {
      await c.ev(`localStorage.clear();localStorage.setItem(${JSON.stringify(k)},${JSON.stringify(v)})`); await c.goto(BASE);
      ok(await c.ev('document.querySelectorAll("a.item").length') === SITES.length, `首页：存储项 ${k}=${v} 坏了也照常显示科目`);
    }
    await c.ev('localStorage.clear()'); await c.goto(BASE);
    r = await c.ev(`(async()=>{const w=ms=>new Promise(r=>setTimeout(r,ms));document.querySelector(".new-folder-link").click();await w(30);const i=document.querySelector("#newFolderRow .menu-input");i.value="期末";
      i.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",isComposing:true,bubbles:true}));const composing=document.querySelectorAll(".folder-card").length;
      i.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true}));await w(30);return {composing,made:document.querySelectorAll(".folder-card").length};})()`);
    ok(r.composing === 0 && r.made === 1, '首页：输入法选字时按回车不创建文件夹，正常回车才创建', r);
    // 导出 → 清空 → 导入：数据原样回来；再导入一次不会翻倍；本机较新的错题不被旧备份盖掉
    r = await c.ev(`(async()=>{const w=ms=>new Promise(r=>setTimeout(r,ms));localStorage.clear();
      localStorage.setItem("osquiz_wrongbook",JSON.stringify({q1:{cat:"a",text:"t1",wrongCount:1,lastWrongAt:100},q2:{cat:"a",text:"t2",wrongCount:2,lastWrongAt:200}}));
      localStorage.setItem("osquiz_history",JSON.stringify([{date:5,scope:"x",total:1,correct:1,wrong:0},{date:3,scope:"y",total:1,correct:0,wrong:1}]));
      localStorage.setItem("other_project_secret","别动我");
      let blob=null;const orig=URL.createObjectURL;URL.createObjectURL=b=>{blob=b;return orig.call(URL,b);};document.getElementById("exportBtn").click();await w(50);const text=await blob.text();
      const allowed=Object.keys(JSON.parse(text).items);
      localStorage.removeItem("osquiz_wrongbook");localStorage.removeItem("osquiz_history");
      localStorage.setItem("osquiz_wrongbook",JSON.stringify({q1:{cat:"a",text:"t1",wrongCount:9,lastWrongAt:999},q7:{cat:"a",text:"t7",wrongCount:1,lastWrongAt:50}}));
      const imp=async()=>{const p=importBackup(new File([text],"b.json"));await w(60);document.getElementById("confirmOkBtn").click();await p;};
      await imp();await imp();
      const wb=JSON.parse(localStorage.getItem("osquiz_wrongbook")),h=JSON.parse(localStorage.getItem("osquiz_history"));
      const bad=importBackup(new File(['{"app":"tiku","version":1,"items":{"evil_key":"1","tiku_folders":"null"}}'],"x.json"));await w(60);if(document.getElementById("confirmBackdrop").classList.contains("show"))document.getElementById("confirmOkBtn").click();await bad;
      return {allowed,ids:Object.keys(wb).sort(),q1:wb.q1.wrongCount,h:h.map(x=>x.date),evil:localStorage.getItem("evil_key"),other:localStorage.getItem("other_project_secret"),cards:document.querySelectorAll("a.item").length};})()`);
    ok(!r.allowed.includes('other_project_secret') && r.allowed.includes('osquiz_wrongbook'), '导出备份：只装刷题站自己的数据，不带同域名下别的项目的', r.allowed);
    ok(JSON.stringify(r.ids) === '["q1","q2","q7"]' && r.q1 === 9 && JSON.stringify(r.h) === '[5,3]', '导入备份：是合并（本机较新的留着、缺的补上），导入两次也不翻倍', r);
    ok(r.evil === null && r.other === '别动我' && r.cards === SITES.length, '导入备份：清单以外的存储项一律不写，坏内容不会把首页弄坏', r);
    await c.ev('localStorage.clear()');
    console.log('2. 逻辑检查完成');

    /* ---------- 3. 手势 + 4. 版面 ---------- */
    c.close();
    // TIKU_QUICK=1 只跑前两组（改逻辑时来回试用）；提交前要不带它完整跑一遍
    for (const W of process.env.TIKU_QUICK ? [] : [320, 390, 430]) {
      const t = await open(W, 800, 2);
      const T = (type, x, y) => t.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
      const swipe = async (x0, y0, x1, y1, ms) => { const k = Math.max(4, Math.round(ms / 16)); await T('touchStart', x0, y0);
        for (let i = 1; i <= k; i++) { await T('touchMove', x0 + (x1 - x0) * i / k, y0 + (y1 - y0) * i / k); await sleep(16); } await T('touchEnd'); await sleep(800); };
      try {
        for (const s of SITES) {
          await t.goto(BASE + s + '/'); await t.ev('localStorage.clear()'); await t.goto(BASE + s + '/');
          const steps = [['首页', '1'], ['答题', 'document.getElementById("startBtn").click()'], ['作答后', '__quiz.submitAnswer()'], ['结果', '__quiz.finishQuiz()'], ['错题本', '__quiz.showScreen("wrongbook")']];
          for (const [name, js] of steps) {
            await t.ev(js); await sleep(150);
            const sw = await t.ev('Math.max(document.documentElement.scrollWidth, innerWidth)');
            ok(sw <= W, `${W} ${s} ${name} 无横向溢出`, sw);
          }
          await t.ev('__quiz.showScreen("home");document.getElementById("startBtn").click()'); await sleep(200);
          const y = await t.ev('(()=>{const r=document.querySelector(".qcard .q-tag").getBoundingClientRect();return r.top+r.height/2;})()');
          await swipe(W * .75, y, W * .2, y + 4, 180);
          ok(await t.ev('__quiz.session.idx') === 1, `${W} ${s} 左划 → 下一题`);
          await swipe(W * .25, y, W * .8, y + 4, 180);
          ok(await t.ev('__quiz.session.idx') === 0, `${W} ${s} 右划 → 上一题`);
          await swipe(W / 2, y + 60, W / 2 + 6, y - 120, 200);
          ok(await t.ev('__quiz.session.idx') === 0, `${W} ${s} 竖划不翻页`);
        }
        // 错题本/答错明细：全部题答错后逐个元素量，长代码不许伸出自己那一栏（整页宽度量不出来：外层会把超出的裁掉）
        await t.goto(BASE + 'web-design/'); await t.ev('localStorage.clear()'); await t.goto(BASE + 'web-design/');
        let m = await t.ev(`(async()=>{document.getElementById("startBtn").click();await new Promise(r=>setTimeout(r,80));const Q=__quiz;for(let i=0;i<Q.session.queue.length;i++){Q.session.idx=i;Q.renderQuestion();Q.submitAnswer();}
          const over=sel=>[...document.querySelectorAll(sel)].filter(el=>el.scrollWidth>el.clientWidth+1).length;let optOver=0;
          for(let i=0;i<Q.session.queue.length;i++){Q.session.idx=i;Q.renderQuestion();optOver+=over("#screen-quiz .opt-text")+over("#answerBox");}
          Q.finishQuiz();document.getElementById("resWrongBox").click();const a=over("#screen-resultlist .review-item *");Q.showScreen("wrongbook");
          return {optOver,list:a,wb:over("#screen-wrongbook .wrong-item *"),n:document.querySelectorAll(".wrong-item").length,ws:getComputedStyle(document.querySelector(".wrong-item .qtext")).whiteSpace};})()`);
        ok(m.n === 90 && m.optOver === 0 && m.list === 0 && m.wb === 0, `${W} Web 站 90 题全错：选项、答案框、答错明细、错题本里都没有伸出去的长串`, m);
        ok(m.ws === 'pre-wrap', `${W} 错题本里的题干保留换行`, m.ws);
        // 小入口的可点范围：竖向至少 40 像素（文字本身只有 17 像素高，靠内边距或看不见的垫片撑大）
        await t.goto(BASE + 'mobile-app/'); await t.ev('localStorage.clear()'); await t.goto(BASE + 'mobile-app/');
        const tapH = sel => t.ev(`(()=>{const el=document.querySelector(${JSON.stringify(sel)});el.scrollIntoView({block:"center",behavior:"instant"});const r=el.getBoundingClientRect(),x=r.left+r.width/2,cy=r.top+r.height/2;const on=y=>{const p=document.elementFromPoint(x,y);return !!p&&(p===el||el.contains(p));};let up=0,dn=0;while(up<40&&on(cy-up-1))up++;while(dn<40&&on(cy+dn+1))dn++;return up+dn;})()`);
        m = await tapH('#selAll'); ok(m >= 40, `${W} 「全选」可点高度 ${m}`, m);
        await t.ev('document.getElementById("startBtn").click()'); await sleep(150);
        m = [await tapH('#overviewLink'), await tapH('#reciteBtn'), await tapH('#modeToggleBtn')]; ok(m.every(x => x >= 40), `${W} 「题目总览」「背题」「快速模式」可点高度`, m);
        // 快速模式答对后立刻左划：只前进一题（以前自动跳题和滑动各算一次，连跳两题）
        {
          const y2 = await t.ev('(()=>{const r=document.querySelector(".qcard .q-tag").getBoundingClientRect();return r.top+r.height/2;})()');
          await t.ev('__quiz.pickOption(__quiz.session.queue[0].correct)');
          await swipe(W * .75, y2, W * .2, y2 + 4, 180);
          ok(await t.ev('__quiz.session.idx') === 1, `${W} 快速模式答对后马上左划：只到下一题，不连跳两题`, await t.ev('__quiz.session.idx'));
        }
        // 答题时收起大标题：吸顶栏不超过屏高的 15%
        m = await t.ev('Math.round(document.querySelector(".topbar").getBoundingClientRect().height)');
        ok(m <= 800 * 0.15, `${W} 答题时吸顶栏高度 ${m} 不超过屏高 15%`, m);
        await t.goto(BASE + 'os/'); await t.ev('window.__alive=1;sessionStorage.clear()');
        await swipe(W / 2, 120, W / 2, 520, 350); await sleep(800);
        ok(await t.ev('typeof window.__alive==="undefined"'), `${W} 首页下拉 → 刷新`);
        if (t.errors.length) { fail++; console.log('  ✗ 页面 JS 异常', t.errors); }
      } finally { t.close(); }
    }
    console.log('3/4. 手势与版面检查完成');
  } finally { srv.close(); }
  console.log(fail ? `FAIL  通过 ${pass}，失败 ${fail}` : `PASS  ${pass} 条全部通过`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
