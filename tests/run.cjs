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
const SITES = ['web-design','software-engineering','mobile-app','os','english-listening','english-reading','english-vocab','english-translation','cet4-vocab'];
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
    r = await c.ev(`(async()=>{${start}const inp=document.querySelector("#qText .blank-input");inp.focus();inp.value="x";inp.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",isComposing:true,bubbles:true}));return !!Q.session.answers[0]||document.activeElement!==inp;})()`);
    ok(r === false, '中文输入法组字时按回车不提交', r);
    await fresh('english-translation/');
    /* 翻译题严格对照参考译文自动判（2026-10-14 用户要求，取代本人自评） */
    r = await c.ev(`(async()=>{${start}const t=document.querySelector(".trans-area");t.value="Jack is so diligent a student that he never goes anywhere with a book.";t.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true}));const a=!!Q.session.answers[0];t.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",ctrlKey:true,bubbles:true}));const box=document.getElementById("answerBox");return {a,rec:Q.session.answers[0],wb:Object.keys(Q.wrongbook).length,extra:[...box.querySelectorAll(".trans-line mark.tw-extra")].map(m=>m.textContent),miss:[...box.querySelectorAll(".trans-line mark.tw-miss")].map(m=>m.textContent),btns:!!document.getElementById("selfRightBtn"),cls:t.className};})()`);
    ok(!r.a && r.rec && r.rec.allCorrect === false && r.wb === 1 && !r.btns && /wrong/.test(r.cls), '翻译框：回车换行不提交，Ctrl+回车提交后直接判（错一个词就是错，进错题本，不再让本人点对错）', r);
    ok(JSON.stringify(r.extra) === '["with"]' && JSON.stringify(r.miss) === '["without"]', '翻译题答错：标出多写/写错的词和漏掉的词', r);
    r = await c.ev(`(()=>{const q=QUESTIONS[0],g=s=>__quiz.gradeQuestion(q,[s]).allCorrect;return {
      ok:[g("jack IS so diligent  a student that he never goes anywhere without a book"),g("  Jack is so diligent a student, that he never goes anywhere without a book! ")],
      bad:[g("Jack is so diligent a student that he never goes anywhere without book."),g("Jack is such a diligent student that he never goes anywhere without a book."),g(""),g("杰克")]};})()`);
    ok(r.ok.every(Boolean) && !r.bad.some(Boolean), '翻译题：大小写/空格/标点不算错，少一个词、换个说法、空着都算错', r);
    r = await c.ev(`(()=>{const g=(i,s)=>__quiz.gradeQuestion(QUESTIONS[i],[s]).allCorrect;const i3=QUESTIONS.findIndex(q=>/you’re buying/.test(q.ans[0]));return [g(i3,QUESTIONS[i3].ans[0].replace(/’/g,"'")),!g(i3,QUESTIONS[i3].ans[0].replace("you’re","you are"))];})()`);
    ok(r.every(Boolean), '翻译题：弯引号直引号都行，缩写和展开算不同', r);
    r = await c.ev(`(()=>QUESTIONS.filter(q=>q.vocab).flatMap(q=>(q.accept||[q.ans[0]]).filter(a=>!__quiz.gradeQuestion(q,[a]).allCorrect).map(a=>a.slice(0,30))))()`);
    ok(r.length === 0, '翻译站：每一种参考写法自己都判对', r);
    r = await c.ev(`(()=>QUESTIONS.filter(q=>q.vocab&&!q.accept&&/[\/()]/.test(q.ans[0])).map(q=>q.ans[0].slice(0,30)))()`);
    ok(r.length === 0, '翻译站：参考译文里写了「a/b」「(可省略)」的题都用 accept 列全了每种写法', r);
    r = await c.ev(`(()=>{const q=QUESTIONS.find(q=>q.accept&&/article/.test(q.ans[0])),g=s=>__quiz.gradeQuestion(q,[s]).allCorrect;return [g(q.accept[1]),!g(q.ans[0])];})()`);
    ok(r.every(Boolean), '翻译站：accept 里的另一种写法判对；原资料的「article/essay」照抄不算对', r);
    // 旧版自评留下的记录照原样显示
    await fresh('english-translation/');
    r = await c.ev(`(async()=>{${start}Q.session.answers[0]={allCorrect:true,userInputs:["x"],assignment:[0],self:true};Q.renderQuestion();return document.getElementById("answerBox").textContent;})()`);
    ok(/你判定：译对了/.test(r), '旧的自评记录照原样显示', r);
    await fresh('web-design/');
    await c.ev(`(()=>{const q=QUESTIONS[3];localStorage.setItem("webquiz_wrongbook",JSON.stringify({q5:{cat:q.cat,type:q.type,text:q.text,options:q.options,correct:q.correct,wrongCount:1,correctStreak:0,lastWrongAt:1}}));})()`);
    await c.goto(BASE + 'web-design/');
    ok(JSON.stringify(await c.ev('Object.keys(__quiz.wrongbook)')) === '["q3"]', '错题记录对不上题号时按内容找回');
    await c.ev(`localStorage.setItem("webquiz_inprogress",JSON.stringify({ids:["q0"],fps:["x"],answers:[null],idx:0,elapsed:0,scopeLabel:"t"}))`);
    await c.goto(BASE + 'web-design/');
    ok(await c.ev('document.getElementById("resumeCard").hidden') === true, '续练进度对不上题库时作废');
    // 2026-10-19 用户报快速连点「下一题」触发双击放大：整页和会滚的框都要是 manipulation（只留拖动 + 双指缩放）
    r = await c.ev(`["html","body",".q-text",".q-code"].map(s=>getComputedStyle(document.querySelector(s)).touchAction)`);
    ok(r.every(v => v === 'manipulation'), '整页去掉双击放大（双指缩放保留）', r);
    // 2026-10-19 用户报参考答案「a / b / c」挤一段：分不清哪个是哪一空、长答案从中间断开。改成每空一行、题里每空挂同号编号
    for (const W of [320, 375, 390]) {
      await c.send('Emulation.setDeviceMetricsOverride', { width: W, height: 844, deviceScaleFactor: 1, mobile: true, screenWidth: W, screenHeight: 844 });
      r = await c.ev(`(async()=>{const Q=__quiz,i=QUESTIONS.findIndex(q=>(q.ans||[]).join().includes("Cal(Num1, Num2);"));
        Q.session={queue:[QUESTIONS[i]],idx:0,answers:[null],drafts:{},elapsed:0,scopeLabel:"t"};Q.showScreen("quiz");Q.renderQuestion();
        const b=[...document.querySelectorAll("#qCode .blank-input")];b[0].value="Cal(Num1, Num2);";b[1].value="Cal(Num1, Num2);";
        Q.submitAnswer();await new Promise(r=>setTimeout(r,50));
        const rows=[...document.querySelectorAll("#answerBox .ans-row")],nos=[...document.querySelectorAll("#qCode .blank-no")];
        const asg=Q.session.answers[0].assignment;
        // 每个答案都是一整块：只要放得下一行，就只占一行（以前「Random r = new / Random();」从中间断开）
        // 折了行的，单行的自然宽度必须确实超过这一行能用的宽度（只有放不下才准在里面折）
        const split=[...document.querySelectorAll("#answerBox .ans-main")].filter(e=>{const lh=parseFloat(getComputedStyle(e).lineHeight)||20;if(e.getBoundingClientRect().height<=lh*1.5)return false;
          const k=e.cloneNode(true);k.style.whiteSpace="nowrap";k.style.maxWidth="none";k.style.position="absolute";e.parentNode.appendChild(k);const w=k.getBoundingClientRect().width;k.remove();return w<=e.parentNode.clientWidth;}).map(e=>e.textContent);
        return {n:b.length,rows:rows.length,nos:nos.map(e=>e.dataset.no).join(),noText:document.getElementById("qCode").textContent.includes("①"),
          match:rows.every((r,k)=>r.classList.contains(asg[k]!==-1?"ok":"bad")&&nos[k].classList.contains("bad")===(asg[k]===-1)),
          mine:rows[1].querySelector(".ans-mine s")&&rows[1].querySelector(".ans-mine s").textContent,empty:rows[3].querySelector(".ans-mine.none")!==null,split};})()`);
      ok(r.n === 6 && r.rows === 6 && r.nos === '1,2,3,4,5,6' && r.match, `${W} 参考答案每空一行，题里每空编号与之对应、对错颜色一致`, r);
      ok(r.mine === 'Cal(Num1, Num2);' && r.empty && r.split.length === 0, `${W} 参考答案：错的写出你填的、没填的标没填、答案不从中间断开`, r);
      r = await c.ev(`(()=>{const Q=__quiz,i=QUESTIONS.findIndex(q=>(q.ans||[]).join().includes("Random r = new Random();"));
        Q.session={queue:[QUESTIONS[i]],idx:0,answers:[null],drafts:{},elapsed:0,scopeLabel:"t"};Q.renderQuestion();Q.submitAnswer();
        const e=document.querySelector("#answerBox .ans-main");return {t:e.textContent,h:e.getBoundingClientRect().height,lh:parseFloat(getComputedStyle(e).lineHeight)};})()`);
      if (W >= 375) ok(r.t === 'Random r = new Random();' && r.h < r.lh * 1.5, `${W} 「Random r = new Random();」整句一行`, r);
    }
    await c.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true, screenWidth: 390, screenHeight: 844 });
    // 2026-10-19 用户定：1~4 空的普通题默认一行（老样子、分号隔开），能点「逐空对照」切过去再切回来；判分严格按答案；判错差一两个字时提示「差一点」
    await fresh('os/');
    r = await c.ev(`(async()=>{const Q=__quiz,q=QUESTIONS[0],g=a=>Q.gradeQuestion(q,a).allCorrect;
      const strict={short:g(["并发","共享性","异步性","虚拟性"]),full:g(["虚拟性","并发性","共享性","异步性"]),suffix:Q.gradeQuestion(QUESTIONS[1],["系统软件性"]).allCorrect};
      Q.session={queue:[q,QUESTIONS[1]],idx:0,answers:[null,null],drafts:{},elapsed:0,scopeLabel:"t"};Q.showScreen("quiz");Q.renderQuestion();
      const b=[...document.querySelectorAll("#qText .blank-input")];["并发","共享","",""].forEach((v,k)=>b[k].value=v);Q.submitAnswer();
      const box=document.getElementById("answerBox"),snap=()=>({one:box.querySelectorAll(".ans-one").length,sep:box.querySelectorAll(".ans-sep").length,rows:box.querySelectorAll(".ans-row").length,
        nos:document.querySelectorAll("#qText .blank-no").length,can:!!box._toggle,icon:box.querySelectorAll("button,svg").length,near:[...box.querySelectorAll(".ans-near")].map(e=>e.textContent)});
      const line=snap();box._toggle();const list=snap();box._toggle();const back=snap();
      // 答案整块：每个答案（连同后面的分号）都只占一行
      const split=[...box.querySelectorAll(".ans-one")].filter(e=>e.getBoundingClientRect().height>parseFloat(getComputedStyle(box).lineHeight||"20")*1.5).length;
      Q.session.idx=1;Q.renderQuestion();document.querySelector("#qText .blank-input").value="系统";Q.submitAnswer();
      const single={can:!!box._toggle,near:(box.querySelector(".ans-near")||{}).textContent};
      return {strict,line,list,back,split,single};})()`);
    ok(r.strict.short === false && r.strict.full === true && r.strict.suffix === false, '判分严格：「并发」不算「并发性」，词尾多写「性」也不算', r.strict);
    ok(r.line.one === 4 && r.line.sep === 3 && r.line.rows === 0 && r.line.nos === 0 && r.line.can && r.line.icon === 0 && r.split === 0, '1~4 空的题默认一行、分号隔开、题里不挂编号、答案框里没有切换图标', r.line);
    ok(r.list.rows === 4 && r.list.nos === 4 && r.list.icon === 0 && r.back.rows === 0 && r.back.nos === 0 && r.back.one === 4, '「逐空对照」切过去有编号、再切回一行编号摘掉', { list: r.list, back: r.back });
    ok(r.line.near.length === 2 && r.line.near.every(t => t.includes('少了「性」')) && r.list.near.length === 2, '差一点：「并发」提示少了「性」（一行和逐空两种样式都有）', r.line.near);
    ok(r.single.can === false && /「系统」少了「软件」/.test(r.single.near || ''), '只有一空的题不给切换；差一点：系统 → 少了「软件」', r.single);
    // 2026-10-19 用户定：切换只靠双击答案区（图标也去掉了）。用真的触摸输入点（CDP），不在页面里伪造 click
    await c.ev(`(()=>{const Q=__quiz;Q.session={queue:[QUESTIONS[0]],idx:0,answers:[null],drafts:{},elapsed:0,scopeLabel:"t"};Q.showScreen("quiz");Q.renderQuestion();Q.submitAnswer();document.getElementById("answerBox").scrollIntoView({block:"center"});})()`);
    const at = async sel => c.ev(`(()=>{const r=document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+Math.min(r.height/2,14)};})()`);
    const tap = async (pt, gap) => { await c.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: pt.x, y: pt.y }] }); await c.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await sleep(gap); };
    const modeNow = () => c.ev('document.getElementById("answerBox").classList.contains("as-list")');
    const dt = {}; let pt = await at('#answerBox .real');
    await tap(pt, 500); dt.single = await modeNow();
    await tap(pt, 120); await tap(pt, 400); dt.dbl = await modeNow();
    pt = await at('#answerBox .ans-list'); await tap(pt, 120); await tap(pt, 400); dt.dblBack = await modeNow();
    pt = await at('#answerBox .real'); await tap(pt, 600); await tap(pt, 400); dt.slow = await modeNow();
    ok(dt.single === false && dt.dbl === true && dt.dblBack === false && dt.slow === false, '双击答案区切换、再双击切回；单击和慢点两下不切', dt);
    // 只有一空的题双击不切换
    await c.ev(`(()=>{const Q=__quiz;Q.session={queue:[QUESTIONS[1]],idx:0,answers:[null],drafts:{},elapsed:0,scopeLabel:"t"};Q.renderQuestion();Q.submitAnswer();document.getElementById("answerBox").scrollIntoView({block:"center"});})()`);
    pt = await at('#answerBox .real'); const before1 = await c.ev('document.getElementById("answerBox").innerHTML'); await tap(pt, 120); await tap(pt, 400);
    ok(before1 === await c.ev('document.getElementById("answerBox").innerHTML'), '只有一空的题双击答案区不变', null);
    // 差一点不能把意思不同的答案也说成「差一点」（/code-review 指出的）；提示里显示原样的字，不是规范化后的小写
    r = await c.ev(`(()=>{const n=(m,a)=>{const h=__quiz.nearText(m,a);return h?h.text:"";};return {no:[n("LIFO","FIFO"),n("线程","进程"),n("异步","同步"),n("3","2"),n("不可再现性","可再现性"),n("=","!=")],
      yes:[n("可再现性","可再现"),n("getElement","getElementById"),n("x; i < y; i++","x; i <= y; i++"),n("存与辅存的容量之","主存与辅存的容量之和")]};})()`);
    ok(r.no.every(t => t === '') && r.yes[0] === '多了「性」' && r.yes[1] === '少了「ById」' && r.yes[2] === '有 1 处不一样' && r.yes[3] === '有 2 处不一样', '差一点：只认结尾少写/多写和长答案里一两处不同，短词换字、开头加「不」不提示', r);
    // 改了答案的题指纹会变：进行中的练习、做过的题、错题本都要接上（不处理的话续练卡片直接作废）
    r = await c.ev(`(()=>{__quiz.showScreen("home");__quiz.session=null;const A=__quiz.CFG.fpAlias,now=__quiz.fp(QUESTIONS[0]),old=Object.keys(A).find(k=>A[k]===now);
      localStorage.setItem("osquiz_inprogress",JSON.stringify({ids:["q0","q1"],fps:[old,__quiz.fp(QUESTIONS[1])],answers:[null,null],idx:0,elapsed:0,scopeLabel:"t"}));
      localStorage.setItem("osquiz_done",JSON.stringify({[old]:1}));
      localStorage.setItem("osquiz_wrongbook",JSON.stringify({q0:{cat:QUESTIONS[0].cat,type:"blank",text:QUESTIONS[0].text,code:"",ans:["并发性|并发","共享性|共享","异步性|异步","虚拟性|虚拟"],wrongCount:1,correctStreak:0,lastWrongAt:1}}));
      return {old:!!old,now};})()`);
    await c.goto(BASE + 'os/');
    const mig = await c.ev(`(()=>{const d=JSON.parse(localStorage.getItem("osquiz_done")),p=JSON.parse(localStorage.getItem("osquiz_inprogress"));
      return {card:!document.getElementById("resumeCard").hidden,done:Object.keys(d),fps0:p&&p.fps[0],wbAns:__quiz.wrongbook.q0&&__quiz.wrongbook.q0.ans.join()};})()`);
    ok(r.old && mig.card && mig.fps0 === r.now && mig.done.length === 1 && mig.done[0] === r.now && mig.wbAns === '并发性,共享性,异步性,虚拟性',
      '改过答案的题：续练进度、做过的题、错题本都接上新指纹', mig);
    // 错题本：代码题逐空列出（题里空前写 ①②），短题一行
    await fresh('web-design/');
    r = await c.ev(`(async()=>{const Q=__quiz,pick=k=>QUESTIONS[QUESTIONS.findIndex(q=>(q.ans||[]).join().includes(k))];const qs=[pick("Cookie"),pick("Cal(Num1, Num2);")];
      Q.session={queue:qs,idx:0,answers:[null,null],drafts:{},elapsed:0,scopeLabel:"t"};Q.showScreen("quiz");
      for(let k=0;k<2;k++){Q.session.idx=k;Q.renderQuestion();document.querySelectorAll("#qText .blank-input,#qCode .blank-input").forEach(x=>x.value="zz");Q.submitAnswer();}
      Q.showScreen("wrongbook");await new Promise(r=>setTimeout(r,50));
      const items=[...document.querySelectorAll(".wrong-item")].map(e=>({rows:e.querySelectorAll(".ans-row").length,one:e.querySelectorAll(".ans-one").length,circ:/①/.test(e.querySelector(".qtext").textContent)}));
      return items;})()`);
    ok(r.length === 2 && r.some(i => i.rows === 6 && i.circ) && r.some(i => i.rows === 0 && i.one === 1 && !i.circ), '错题本：代码题逐空列出且题里空前有编号，短题一行', r);
    await c.goto(BASE + 'web-design/');
    r = await c.ev(`(()=>{const Q=__quiz;Q.session={queue:[{id:"zz",type:"blank",cat:"x",text:"<b>x</b>{{}}<img src=x onerror=window.__pwn=1>",ans:["a"]}],idx:0,answers:[null],elapsed:0,scopeLabel:"t"};Q.showScreen("quiz");Q.renderQuestion();const t=document.getElementById("qText");return {tags:t.querySelectorAll("b,img").length,inputs:t.querySelectorAll(".blank-input").length};})()`);
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
    r = await c.ev(`(()=>{const Q=__quiz,g=(i,a)=>Q.gradeQuestion(QUESTIONS[i],a).allCorrect;return {seqRev:g(83,["R,P,Q"]),seqOk:g(83,["Q,P,R"]),un:g(0,["虚拟性","异步性","共享性","并发性"]),fifo:g(81,["7","9"]),n150:g(84,["150","14","16K"]),neg:g(9,["不可再现"]),pos:g(9,["可再现。"]),suffix:g(9,["可再现性"]),more:g(22,["操作系统"]),junk:g(0,["救恩的基督教的细节虚拟世界安安静静","共享","异步","并发"])};})()`);
    ok(!r.seqRev && r.seqOk, '安全序列：顺序反了判错，对的判对', r);
    ok(r.un && !r.fifo, '操作系统：真无序的题换序判对，FIFO/LRU 填反判错', r);
    ok(!r.n150 && !r.neg && r.pos && !r.suffix && !r.more && !r.junk, '「包含也算对」已去掉（2026-10-18 用户定）：多写字、乱写一句碰巧含答案、数字多一位、加否定词都不算；多写「性」也不算（2026-10-19 判分改严）；只差标点的仍算', r);
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
    // 存储写满：要告诉人（用填空题：先打几个字，存草稿时才会真的多占空间、写失败）
    await fresh('os/');
    // 先进答题页，再把空间占满，然后点底部标签：存草稿失败的提示不能顶掉「确定要切换吗」这个问题（两者以前共用一个弹窗）
    r = await c.ev(`(async()=>{${W8}${start}let c="x".repeat(1024*1024),n=0;try{for(;;){localStorage.setItem("fill_"+n,c);n++;}}catch(e){}let s="y".repeat(512),m=0;try{for(;;){localStorage.setItem("f_"+m,s);m++;}}catch(e){}let k=0;try{for(;;){localStorage.setItem("t"+k,"z");k++;}}catch(e){}
      document.querySelector("#qText .blank-input").value="并发并发并发并发";document.querySelector('nav button[data-screen="history"]').click();await w(120);
      const r={tip:document.getElementById("ptrTip").classList.contains("show")&&/存不进/.test(document.getElementById("ptrTip").textContent),ask:document.getElementById("confirmMsg").textContent.slice(0,24),cancelShown:!document.getElementById("confirmCancelBtn").hidden};
      document.getElementById("confirmCancelBtn").click();await w(50);r.stay=document.getElementById("screen-quiz").classList.contains("active");localStorage.clear();return r;})()`);
    ok(r.tip && /切换/.test(r.ask) && r.cancelShown && r.stay, '浏览器空间写满：用提示条说明，不顶掉正在问的确认框（点取消仍留在答题页）', r);
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
    // 焦点停在「取消」上按回车：取消（以前一律当成确定，清空错题本时会清掉）
    await fresh('mobile-app/');
    r = await c.ev(`(async()=>{${W8}${start}const q=Q.session.queue[0];Q.pickOption(Object.keys(q.options).find(L=>L!==q.correct));await w(20);Q.showScreen("wrongbook");await w(30);
      document.getElementById("clearWrongbookBtn").click();await w(30);const cb=document.getElementById("confirmCancelBtn");cb.focus();
      const ev=new KeyboardEvent("keydown",{key:"Enter",bubbles:true,cancelable:true});cb.dispatchEvent(ev);if(!ev.defaultPrevented)cb.click();await w(30);
      return {open:document.getElementById("confirmBackdrop").classList.contains("show"),wb:Object.keys(JSON.parse(localStorage.getItem("mobileappquiz_wrongbook")||"{}")).length};})()`);
    ok(!r.open && r.wb === 1, '确认弹窗：焦点在「取消」上按回车 = 取消，错题本没被清空', r);
    // 错题本里多空题（选词题 14 空以上）逐空列出，题干自带 (1)(2) 编号，不再另挂 ①②
    await fresh('english-vocab/');
    r = await c.ev(`(async()=>{${start}Q.submitAnswer();Q.showScreen("wrongbook");const e=document.querySelector(".wrong-item"),t=e.querySelector(".qtext").textContent;return {rows:e.querySelectorAll(".ans-row").length,n:Q.session.queue[0].ans.length,num:/\\(1\\)____/.test(t)&&/\\(2\\)____/.test(t),circ:/①/.test(t)};})()`);
    ok(r.rows === r.n && r.n >= 14 && r.num && !r.circ, '错题本里多空题逐空列出，题干的 (1)(2) 编号保留、不重复挂 ①②', r);
    // 数字后面多写个量词仍算对
    await fresh('os/');
    r = await c.ev(`(()=>{const g=(i,a)=>__quiz.gradeQuestion(QUESTIONS[i],a).allCorrect;return {ge:g(80,["256个","64KB"]),ci:g(84,["15位","14位","16K"]),big:g(80,["1256","64KB"]),exact:g(80,["256","64KB"])};})()`);
    ok(!r.ge && !r.ci && !r.big && r.exact, '数字答案：只认完全一致——后面多写「个/位」、前后多一位数字都不算（2026-10-18 去掉「包含也算对」后）', r);
    // 别的页面只是在打字（存草稿）：这一页的错题本不整块重画
    await fresh('mobile-app/');
    r = await c.ev(`(async()=>{${W8}${start}const q=Q.session.queue[0];Q.pickOption(Object.keys(q.options).find(L=>L!==q.correct));await w(20);Q.finishQuiz();Q.showScreen("wrongbook");await w(30);
      const f=document.createElement("iframe");f.src=location.href;document.body.appendChild(f);await new Promise(r=>f.onload=r);await w(200);
      const first=document.querySelector(".wrong-item");f.contentWindow.document.getElementById("startBtn").click();await w(300);const same=document.querySelector(".wrong-item")===first;f.remove();return {same};})()`);
    ok(r.same, '另一个页面在答题存进度时，这一页的错题本不跟着整块重画', r);
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
    // 答题页顶栏：科目名一行放得下、下面写「正在练习 · 范围」；回到首页这行要消失（2026-10-15 用户选的方案 B）
    await fresh('english-reading/');   // 标题最长的一科
    r = await c.ev(`(async()=>{const w=ms=>new Promise(r=>setTimeout(r,ms));document.getElementById("startBtn").click();await w(200);
      const h=document.querySelector("header h1"),p=document.getElementById("quizScope");
      const q={lines:Math.round(h.getBoundingClientRect().height/parseFloat(getComputedStyle(h).fontSize)),scope:p.textContent,shown:getComputedStyle(p).display!=="none"};
      document.querySelector('nav button[data-screen=home]').click();await w(60);document.getElementById("confirmOkBtn").click();await w(100);
      q.homeShown=getComputedStyle(p).display!=="none";q.homeSub=[...document.querySelectorAll("header p")].filter(x=>getComputedStyle(x).display!=="none").length;return q;})()`);
    ok(r.lines === 1 && /^正在练习 · 全部/.test(r.scope) && r.shown && !r.homeShown && r.homeSub === 1, '答题页顶栏：标题一行、显示练习范围；回首页恢复原副标题', r);
    // 2026-10-21 用户定：本次统计挪到顶栏「正在练习 · 范围」后面、题号放进度条左边。范围很长时只截范围，统计必须完整
    await fresh('web-design/');
    for (const W of [320, 375, 390, 430]) {
      await c.send('Emulation.setDeviceMetricsOverride', { width: W, height: 844, deviceScaleFactor: 1, mobile: true, screenWidth: W, screenHeight: 844 });
      r = await c.ev(`(async()=>{const w=ms=>new Promise(r=>setTimeout(r,ms));if(!__quiz.session||!document.body.classList.contains('quizzing')){document.getElementById("startBtn").click();await w(150);}
        const Q=__quiz;Q.session.scopeLabel="HTML/CSS基础、C#基础、ASP.NET内置对象（没做过的）";Q.session.idx=37;Q.showScreen("quiz");Q.renderQuestion();await w(50);
        const p=document.getElementById("quizScope").getBoundingClientRect(),a=document.getElementById("quizScopeText"),b=document.getElementById("quizScoreText").getBoundingClientRect();
        const n=document.getElementById("quizProgressText").getBoundingClientRect(),bar=document.querySelector(".progress-bar").getBoundingClientRect();
        return {txt:document.getElementById("quizScoreText").textContent,statIn:b.left>=p.left-1&&b.right<=p.right+1&&b.width>0,scopeCut:a.scrollWidth>a.clientWidth,
          oneLine:Math.round(p.height)<=20,sameRow:Math.abs((n.top+n.bottom)/2-(bar.top+bar.bottom)/2)<4&&n.right<=bar.left,idx:document.getElementById("quizProgressText").textContent};})()`);
      ok(/^ · 对\d+ 错\d+ · 已答\d+ 未答\d+$/.test(r.txt) && r.statIn && r.oneLine && (W > 430 || r.scopeCut), `${W} 顶栏：范围太长只截范围，对错统计完整显示`, r);
      ok(r.sameRow && r.idx === '38/90', `${W} 题号在进度条左边同一行`, r);
    }
    await c.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true, screenWidth: 390, screenHeight: 844 });
    /* ----- 汇总首页 ----- */
    await c.goto(BASE); await c.ev('localStorage.clear()'); await c.goto(BASE);
    r = await c.ev(`(async()=>{const out={};for(const s of SUBJECTS){const h=await (await fetch(s.href+"index.html")).text();const m=h.match(/prefix:\\s*"([^"]+)"/);out[s.key]=[s.prefix,m&&m[1]];}return out;})()`);
    ok(Object.values(r).every(([a, b]) => a && a === b), '首页科目清单里的存储前缀和各科目页一致（导出备份靠它）', r);
    for (const [k, v] of [['tiku_folders', 'null'], ['tiku_folders', '{}'], ['tiku_folders', '[null]'], ['tiku_subject_folder', 'null'], ['tiku_custom_names', 'null']]) {
      await c.ev(`localStorage.clear();localStorage.setItem(${JSON.stringify(k)},${JSON.stringify(v)})`); await c.goto(BASE);
      ok(await c.ev('document.querySelectorAll("#list .item[data-key]").length') === SITES.length, `首页：存储项 ${k}=${v} 坏了也照常显示科目`);
    }
    // 展开状态存坏了也照常显示分组（新建分组、展开收起记忆等 2026-10-16 改版后的用例在 tests/home.cjs）
    await c.ev(`localStorage.clear();localStorage.setItem("tiku_folders",JSON.stringify([{id:"f1",name:"甲"},{id:"f2",name:"乙"}]));localStorage.setItem("tiku_expanded_folders","{坏")`); await c.goto(BASE);
    ok(await c.ev('document.querySelectorAll("#list .folder-card").length') === 2, '首页：展开状态存坏了也照常显示分组');
    // 导出 → 清空 → 导入：数据原样回来；再导入一次不会翻倍；本机较新的错题不被旧备份盖掉
    r = await c.ev(`(async()=>{const w=ms=>new Promise(r=>setTimeout(r,ms));localStorage.clear();
      localStorage.setItem("osquiz_wrongbook",JSON.stringify({q1:{cat:"a",text:"t1",wrongCount:1,lastWrongAt:100},q2:{cat:"a",text:"t2",wrongCount:2,lastWrongAt:200}}));
      localStorage.setItem("osquiz_history",JSON.stringify([{date:5,scope:"x",total:1,correct:1,wrong:0},{date:3,scope:"y",total:1,correct:0,wrong:1}]));
      localStorage.setItem("other_project_secret","别动我");
      let blob=null;const orig=URL.createObjectURL;URL.createObjectURL=b=>{blob=b;return orig.call(URL,b);};exportBackup();await w(50);const text=await blob.text();
      const allowed=Object.keys(JSON.parse(text).items);
      localStorage.removeItem("osquiz_wrongbook");localStorage.removeItem("osquiz_history");
      localStorage.setItem("osquiz_wrongbook",JSON.stringify({q1:{cat:"a",text:"t1",wrongCount:9,lastWrongAt:999},q7:{cat:"a",text:"t7",wrongCount:1,lastWrongAt:50}}));
      const imp=async()=>{const p=importBackup(new File([text],"b.json"));await w(60);document.getElementById("confirmOkBtn").click();await p;};
      await imp();await imp();
      const wb=JSON.parse(localStorage.getItem("osquiz_wrongbook")),h=JSON.parse(localStorage.getItem("osquiz_history"));
      const bad=importBackup(new File(['{"app":"tiku","version":1,"items":{"evil_key":"1","tiku_folders":"null"}}'],"x.json"));await w(60);if(document.getElementById("confirmBackdrop").classList.contains("show"))document.getElementById("confirmOkBtn").click();await bad;
      return {allowed,ids:Object.keys(wb).sort(),q1:wb.q1.wrongCount,h:h.map(x=>x.date),evil:localStorage.getItem("evil_key"),other:localStorage.getItem("other_project_secret"),cards:document.querySelectorAll("#list .item[data-key]").length};})()`);
    ok(!r.allowed.includes('other_project_secret') && r.allowed.includes('osquiz_wrongbook'), '导出备份：只装刷题站自己的数据，不带同域名下别的项目的', r.allowed);
    ok(JSON.stringify(r.ids) === '["q1","q2","q7"]' && r.q1 === 9 && JSON.stringify(r.h) === '[5,3]', '导入备份：是合并（本机较新的留着、缺的补上），导入两次也不翻倍', r);
    ok(r.evil === null && r.other === '别动我' && r.cards === SITES.length, '导入备份：清单以外的存储项一律不写，坏内容不会把首页弄坏', r);
    // 本机已移出错题本的题，导入更早的备份后不复活；之后又答错（更新的）的照样能导进来
    r = await c.ev(`(async()=>{const w=ms=>new Promise(r=>setTimeout(r,ms));localStorage.clear();
      localStorage.setItem("osquiz_wbremoved",JSON.stringify({q1:500}));
      const text=JSON.stringify({app:"tiku",version:1,items:{"osquiz_wrongbook":JSON.stringify({q1:{cat:"a",text:"t",lastWrongAt:100},q2:{cat:"a",text:"t",lastWrongAt:900}})}});
      const p=importBackup(new File([text],"b.json"));await w(60);document.getElementById("confirmOkBtn").click();await p;
      return Object.keys(JSON.parse(localStorage.getItem("osquiz_wrongbook")||"{}")).sort();})()`);
    ok(JSON.stringify(r) === '["q2"]', '导入备份：本机移出过的题，比移出时间旧的不复活', r);
    await c.ev('localStorage.clear()');
    await c.ev('localStorage.clear()');
    console.log('2. 逻辑检查完成');
    // 汇总首页改版（2026-10-16）：置顶、排序、分组、左滑、长按拖动、学习情况——自己开浏览器，含 320/390/430 三档真触摸
    await require('./home.cjs').runHome(BASE, ok);
    console.log('2b. 汇总首页检查完成');
    await require('./sync.cjs').runSync(ok);   // 多设备同步：两台设备 + 真接口 + 假存储（2026-10-19）
    console.log('2c. 多设备同步检查完成');

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
        // 填空的空是横线（2026-10-18 用户报：方框最宽 22 个字，长中文/英文截在框里看不全）：真打字进去，长内容要折行、全看得见
        {
          await t.goto(BASE + 'os/'); await t.ev('localStorage.clear()'); await t.goto(BASE + 'os/');
          await t.ev('document.getElementById("startBtn").click();(()=>{const Q=__quiz;Q.session.idx=Q.session.queue.findIndex(q=>(q.text||"").includes("操作系统的特征是"));Q.renderQuestion();})()'); await sleep(100);
          const LONG = '点几点几点几点几点几点几点几点几点几点几点几点几点几点几点几';
          await t.ev('(()=>{const b=document.querySelectorAll("#qText .blank-input")[0];b.scrollIntoView({block:"center"});b.focus();})()');
          await t.send('Input.insertText', { text: LONG }); await sleep(600);
          let m = await t.ev(`(()=>{const Q=__quiz,b=document.querySelectorAll("#qText .blank-input"),q=document.getElementById("qText");
            return {v:b[0].value,lines:b[0].getClientRects().length,over:q.scrollWidth-q.clientWidth,draft:(Q.session.drafts[Q.session.idx]||[])[0],page:document.documentElement.scrollWidth};})()`);
          ok(m.v === LONG && m.draft === LONG && m.lines >= 2 && m.over <= 0 && m.page <= W, `${W} 填空：打进去的长中文折行显示、一个字不截、草稿记下`, m);
          await t.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
          await t.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }); await sleep(100);
          m = await t.ev('(()=>{const b=[...document.querySelectorAll("#qText .blank-input")];return {at:b.indexOf(document.activeElement),v0:b[0].value,br:b[0].querySelectorAll("br,div").length};})()');
          ok(m.at === 1 && m.v0 === LONG && m.br === 0, `${W} 填空：回车跳到下一空、不在空里换行`, m);
          await t.send('Input.insertText', { text: 'concurrency and resource sharing' });
          await t.ev('__quiz.submitAnswer()'); await sleep(100);
          m = await t.ev('(()=>{const b=[...document.querySelectorAll("#qText .blank-input")];return {ed:b.map(x=>x.getAttribute("contenteditable")),cls:b.map(x=>x.className),ui:__quiz.session.answers[__quiz.session.idx].userInputs};})()');
          ok(m.ed.every(x => x === 'false') && m.cls[0].includes('wrong') && m.ui[0] === LONG && m.ui[1] === 'concurrency and resource sharing', `${W} 填空：提交后锁住、标对错、记下原文`, m);
          // 配色口径（2026-10-18 用户定）：答错时参考答案也是绿的（以前跟着红框一起变红），空着答错的不垫粉底
          m = await t.ev(`(()=>{const c=v=>{const e=document.createElement("i");e.style.color=v;document.body.appendChild(e);const x=getComputedStyle(e).color;e.remove();return x;};
            const b=document.querySelectorAll("#qText .blank-input"),bg=getComputedStyle(b[3]).backgroundImage;
            return {real:getComputedStyle(document.querySelector("#answerBox .correct-ans, #answerBox .ans-main")).color,green:c("var(--green)"),emptyFill:/254, 242, 242/.test(bg)};})()`);
          ok(m.real === m.green && !m.emptyFill, `${W} 填空：答错时参考答案是绿的、空着答错的不垫粉底`, m);
        }
        // 手机上点「下一题」不自动聚焦（2026-10-18 用户报：iPhone 键盘直接弹出来，题还没看完）
        {
          await t.goto(BASE + 'os/'); await t.ev('localStorage.clear()'); await t.goto(BASE + 'os/');
          await t.ev('document.getElementById("startBtn").click()'); await sleep(150);
          const nb = await t.ev('(()=>{const b=document.getElementById("nextBtn");b.scrollIntoView({block:"center"});const r=b.getBoundingClientRect();return [r.left+r.width/2,r.top+r.height/2];})()');
          await T('touchStart', nb[0], nb[1]); await T('touchEnd'); await sleep(400);
          const m = await t.ev('({idx:__quiz.session.idx,focus:document.activeElement&&document.activeElement.className,coarse:matchMedia("(pointer:coarse)").matches})');
          ok(m.idx === 1 && !/blank-input/.test(m.focus || ''), `${W} 手机：点「下一题」不自动聚焦第一空（不弹键盘）`, m);
        }
        // 横线空的几个边角（/code-review 2026-10-18）：多行文字进来收成一行；只剩空格也保持占位横线；横线上下都好点
        {
          await t.goto(BASE + 'os/'); await t.ev('localStorage.clear()'); await t.goto(BASE + 'os/');
          await t.ev('document.getElementById("startBtn").click();(()=>{const Q=__quiz;Q.session.idx=Q.session.queue.findIndex(q=>(q.text||"").includes("操作系统的特征是"));Q.renderQuestion();})()'); await sleep(100);
          await t.ev('(()=>{const b=document.querySelectorAll("#qText .blank-input")[0];b.scrollIntoView({block:"center"});b.focus();})()');
          await t.send('Input.insertText', { text: '并发\n共享' }); await sleep(100);
          let m = await t.ev('(()=>{const b=document.querySelectorAll("#qText .blank-input")[0];return {v:b.value,html:b.innerHTML,lines:b.getClientRects().length};})()');
          ok(m.v === '并发 共享' && !/<|\n/.test(m.html) && m.lines === 1, `${W} 填空：多行文字进来收成一行`, m);
          await t.ev('document.querySelectorAll("#qText .blank-input")[1].focus()');
          await t.send('Input.insertText', { text: ' ' }); await sleep(100);
          m = await t.ev('(()=>{const b=document.querySelectorAll("#qText .blank-input")[1];return {w:b.getBoundingClientRect().width,fs:parseFloat(getComputedStyle(b).fontSize)};})()');
          ok(m.w >= 4 * m.fs, `${W} 填空：只打了个空格，横线不缩成一小截`, m);
          // 可点高度：从中心往上下找 elementFromPoint 还是这个空的范围（空着的、填了字的各量一个）
          const tapH = i => t.ev(`(()=>{const el=document.querySelectorAll("#qText .blank-input")[${i}],r=el.getClientRects()[0],x=r.left+Math.min(r.width/2,20),cy=r.top+r.height/2;const on=y=>{const p=document.elementFromPoint(x,y);return !!p&&(p===el||el.contains(p));};let up=0,dn=0;while(up<40&&on(cy-up-1))up++;while(dn<40&&on(cy+dn+1))dn++;return up+dn;})()`);
          m = [await tapH(0), await tapH(2)];
          ok(m.every(h => h >= 26), `${W} 填空：横线可点高度（填了字的、空着的）`, m);
          // 空着的横线跟旁边的字对齐、不把行撑高（2026-10-18：以前空盒子按里面那一行定基线，低 3~4px，iPhone 上光标还戳穿横线）
          m = await t.ev(`(()=>{const t=document.getElementById("qText"),b=t.querySelectorAll(".blank-input");b[0].value="";b[1].value="";b[2].value="并发性";document.activeElement.blur();
            const w=document.createTreeWalker(t,NodeFilter.SHOW_TEXT);let n,he=null;while((n=w.nextNode())){const i=n.data.indexOf("和");if(i>=0){const r=document.createRange();r.setStart(n,i);r.setEnd(n,i+1);he=r.getBoundingClientRect();}}
            const pad=parseFloat(getComputedStyle(b[3]).paddingBottom),e=b[3].getBoundingClientRect(),f=b[2].getClientRects()[0];
            const lh=parseFloat(getComputedStyle(t).lineHeight),lines=Math.round(t.getBoundingClientRect().height/lh);
            return {emptyVsText:+(e.bottom-pad-he.bottom).toFixed(1),filledVsText:+(f.bottom-pad-he.bottom).toFixed(1),extra:+(t.getBoundingClientRect().height-lines*lh).toFixed(1),lh:getComputedStyle(b[3]).lineHeight};})()`);
          ok(Math.abs(m.emptyVsText) <= 1 && Math.abs(m.extra) <= 2, `${W} 填空：空着的横线跟字对齐、不撑高行`, m);
        }
        // 代码题照 markdown 站：不折行、代码框里左右滑；在代码框里横划是滚代码，不翻页（2026-10-18 用户要求）
        {
          await t.goto(BASE + 'web-design/'); await t.ev('localStorage.clear()'); await t.goto(BASE + 'web-design/');
          const idx = await t.ev('document.getElementById("startBtn").click();(()=>{const Q=__quiz;Q.session.idx=Q.session.queue.findIndex(q=>(q.code||"").includes("StyleSheet.css"));Q.renderQuestion();return Q.session.idx;})()'); await sleep(100);
          const y = await t.ev('(()=>{const e=document.getElementById("qCode");e.scrollIntoView({block:"center"});const r=e.getBoundingClientRect();return r.top+r.height/2;})()'); await sleep(100);
          let m = await t.ev('(()=>{const e=document.getElementById("qCode");return {ws:getComputedStyle(e).whiteSpace,sw:e.scrollWidth,cw:e.clientWidth,page:document.documentElement.scrollWidth};})()');
          ok(m.ws === 'pre' && m.sw > m.cw && m.page <= W, `${W} 代码题：不折行，长行在代码框里、整页不横向溢出`, m);
          // 在代码里的空填了字，这一行后面的代码还在同一行（空是 pre-wrap 时会被挤到下一行）
          await t.ev('(()=>{const b=document.querySelector("#qCode .blank-input");b.focus();})()');
          await t.send('Input.insertText', { text: 'navigation' }); await sleep(100);
          m = await t.ev('(()=>{const b=document.querySelector("#qCode .blank-input"),n=b.nextSibling,r=document.createRange();r.setStart(n,0);r.setEnd(n,1);return {b:Math.round(b.getBoundingClientRect().bottom),n:Math.round(r.getBoundingClientRect().bottom),v:b.value};})()');
          ok(m.v === 'navigation' && Math.abs(m.b - m.n) <= 4, `${W} 代码题：空里填了字，后面的代码不换行`, m);
          await t.ev('(()=>{const e=document.getElementById("qCode");e.scrollLeft=0;e.scrollIntoView({block:"center"});})()'); await sleep(100);
          await swipe(W * .7, y, W * .15, y + 3, 260);
          m = await t.ev('({sl:document.getElementById("qCode").scrollLeft,idx:__quiz.session.idx})');
          ok(m.sl > 0 && m.idx === idx, `${W} 代码题：在代码框里左划是滚代码、不翻页`, m);
          // 手指慢慢拖：头几下只挪 1~2 像素（落在翻页的死区里），代码框照样要能滚（死区里不许把滚动拦掉）
          // ⚠ 这条在无头 Chrome 里拦不出旧问题（把死区里的 scrollerWants 去掉它照样绿：Chrome 的触摸模拟不像 iOS 那样整次手势作废），只防「慢拖彻底坏掉」；真问题要 iPhone 真机看
          await t.ev('document.getElementById("qCode").scrollLeft=0'); await sleep(50);
          { const x0 = W * .7; await T('touchStart', x0, y); for (let k = 1; k <= 40; k++) { await T('touchMove', x0 - (k <= 4 ? k * 1.5 : 6 + (k - 4) * 5), y + 1); await sleep(16); } await T('touchEnd'); await sleep(600); }
          m = await t.ev('({sl:document.getElementById("qCode").scrollLeft,idx:__quiz.session.idx})');
          ok(m.sl > 0 && m.idx === idx, `${W} 代码题：手指慢慢拖也能滚代码框`, m);
          // 代码框滚到头再划也不翻页（2026-10-18 用户报：看长代码时左右滑误翻题，频率非常高）；从代码框外面划照常翻
          await t.ev('(()=>{const e=document.getElementById("qCode");e.scrollLeft=e.scrollWidth;})()'); await sleep(50);
          await swipe(W * .7, y, W * .15, y + 3, 180);
          const atEnd = await t.ev('__quiz.session.idx');
          await t.ev('document.getElementById("qCode").scrollLeft=0'); await sleep(50);
          await swipe(W * .25, y, W * .85, y + 3, 180);
          const atStart = await t.ev('__quiz.session.idx');
          const ty = await t.ev('(()=>{const e=document.querySelector(".qcard .q-tag");e.scrollIntoView({block:"center"});const r=e.getBoundingClientRect();return r.top+r.height/2;})()'); await sleep(100);
          await swipe(W * .75, ty, W * .2, ty + 3, 180);
          const outside = await t.ev('__quiz.session.idx');
          ok(atEnd === idx && atStart === idx && outside === idx + 1, `${W} 代码题：代码框滚到右头/左头再划都不翻页，从代码框外面划照常翻`, { idx, atEnd, atStart, outside });
        }
        // 从输入框起手：框没在编辑就照常翻页；正在输入时不翻（2026-10-15 用户报：翻译框那一大块滑不动）
        {
          await t.goto(BASE + 'english-translation/'); await t.ev('localStorage.clear()'); await t.goto(BASE + 'english-translation/');
          await t.ev('document.getElementById("startBtn").click()'); await sleep(200);
          const mid = () => t.ev('(()=>{const a=document.querySelector(".trans-area");a.scrollIntoView({block:"center",behavior:"instant"});const r=a.getBoundingClientRect();return r.top+r.height/2;})()');
          let y3 = await mid();
          await T('touchStart', W / 2, y3); await T('touchEnd'); await sleep(300);
          const tapFocus = await t.ev('document.activeElement===document.querySelector(".trans-area")');
          // 亲手点进去的：从框里左划不翻
          await swipe(W * .75, y3, W * .2, y3 + 4, 180);
          const tapped = await t.ev('__quiz.session.idx');
          await t.ev('document.activeElement.blur()');
          // 程序自动聚焦（「下一题」翻过来就是这样，iPhone 不弹键盘）：照常翻页
          y3 = await mid(); await t.ev('document.querySelector(".trans-area").focus()');
          await swipe(W * .75, y3, W * .2, y3 + 4, 180);
          const auto = await t.ev('__quiz.session.idx');
          // 自动聚焦后打过字：算在编辑，不翻
          y3 = await mid(); await t.ev('(()=>{const a=document.querySelector(".trans-area");a.focus();a.value="x";a.dispatchEvent(new Event("input",{bubbles:true}));})()');
          await swipe(W * .75, y3, W * .2, y3 + 4, 180);
          const typed = await t.ev('__quiz.session.idx');
          ok(tapFocus && tapped === 0 && auto === 1 && typed === 1, `${W} 翻译框：轻点能聚焦；点进去或打过字后从框里滑不翻，只是被自动聚焦时照常翻`, { tapFocus, tapped, auto, typed });
          await t.ev('document.activeElement.blur();__quiz.submitAnswer()'); await sleep(100);
          y3 = await mid();
          await swipe(W * .75, y3, W * .2, y3 + 4, 180);
          ok(await t.ev('__quiz.session.idx') === 2, `${W} 翻译框交卷锁住后，从框里左划照常翻页`, await t.ev('__quiz.session.idx'));
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
        // 题目区不许出现内部滚动：每个站每道题都量（2026-10-14 用户报：翻译题里「恢复」按钮伸出去 8px，题目区能横竖晃）
        // 例外：代码块 2026-10-18 起不折行，长行本来就该左右滑（用户要求），只量竖向
        {
          const bad = [];
          for (const s2 of SITES) {
            await t.goto(BASE + s2 + '/'); await t.ev('localStorage.clear()'); await t.goto(BASE + s2 + '/');
            const n = await t.ev('document.getElementById("startBtn").click();__quiz.session.queue.length'); await sleep(80);
            // 每 25 题一次调用：一次量完一整个站，机器忙时会撞上 CDP 的 20 秒超时
            for (let from = 0; from < n; from += 25) {
              bad.push(...await t.ev(`(()=>{const Q=__quiz,out=[];
                for(let i=${from};i<Math.min(${from + 25},Q.session.queue.length);i++){Q.session.idx=i;Q.renderQuestion();for(const id of ["qText","qCode"]){const el=document.getElementById(id),codeX=id==="qCode"&&getComputedStyle(el).whiteSpace==="pre";if(el.offsetParent&&((!codeX&&el.scrollWidth>el.clientWidth)||el.scrollHeight>el.clientHeight))out.push("${s2} "+id+" 第"+(i+1)+"题 "+el.scrollWidth+"/"+el.clientWidth+"×"+el.scrollHeight+"/"+el.clientHeight);}}
                return out;})()`));
            }
          }
          ok(bad.length === 0, `${W} 8 个站每道题：题目区没有横竖滚动`, bad);
          // 输入框字号 ≥16px：小于 16px 的输入框 iPhone 一点就把整页放大（2026-10-14 用户报）
          const fs = [];
          for (const s2 of ['web-design', 'os', 'english-vocab', 'english-translation']) {
            await t.goto(BASE + s2 + '/'); await t.ev('localStorage.clear()'); await t.goto(BASE + s2 + '/');
            fs.push(...await t.ev(`(async()=>{document.getElementById("startBtn").click();await new Promise(r=>setTimeout(r,80));const Q=__quiz,out=[];const i=Q.session.queue.findIndex(q=>q.type==="blank");if(i>=0){Q.session.idx=i;Q.renderQuestion();}
              document.querySelectorAll("#screen-quiz .blank-input").forEach(el=>{const f=parseFloat(getComputedStyle(el).fontSize);if(f<16)out.push("${s2} "+el.tagName+" "+f);});
              const wf=[...document.styleSheets].flatMap(ss=>[...ss.cssRules]).find(r=>r.selectorText===".wb-filter");if(!wf||parseFloat(wf.style.fontSize)<16)out.push("${s2} 错题筛选 "+(wf&&wf.style.fontSize));return out;})()`));
          }
          await t.goto(BASE); fs.push(...await t.ev('[...document.styleSheets].flatMap(ss=>[...ss.cssRules]).filter(r=>r.selectorText&&/input/.test(r.selectorText)&&r.style.fontSize&&parseFloat(r.style.fontSize)<16).map(r=>"首页 "+r.selectorText+" "+r.style.fontSize)'));
          ok(fs.length === 0, `${W} 输入框、下拉框字号都不小于 16px`, fs);
          await t.goto(BASE + 'mobile-app/'); await t.ev('localStorage.clear()'); await t.goto(BASE + 'mobile-app/');
          await t.ev('document.getElementById("startBtn").click()'); await sleep(150);
        }
        // 快速模式答对后立刻左划：只前进一题（以前自动跳题和滑动各算一次，连跳两题）
        {
          const y2 = await t.ev('(()=>{const r=document.querySelector(".qcard .q-tag").getBoundingClientRect();return r.top+r.height/2;})()');
          await t.ev('__quiz.pickOption(__quiz.session.queue[0].correct)');
          await swipe(W * .75, y2, W * .2, y2 + 4, 180);
          ok(await t.ev('__quiz.session.idx') === 1, `${W} 快速模式答对后马上左划：只到下一题，不连跳两题`, await t.ev('__quiz.session.idx'));
        }
        // 进度条下面那一行：背题、快速模式、题目总览三个入口都在屏幕里、互不重叠，也不压住左边的题号
        m = await t.ev(`(()=>{const ids=["quizProgressText","quizScoreText","reciteBtn","modeToggleBtn","overviewLink"].map(i=>document.getElementById(i).getBoundingClientRect());const W=document.documentElement.clientWidth;
          const out=ids.filter(r=>r.left<0||r.right>W).length;let hit=0;for(let a=0;a<ids.length;a++)for(let b=a+1;b<ids.length;b++){const p=ids[a],q=ids[b];if(p.left<q.right-1&&q.left<p.right-1&&p.top<q.bottom-1&&q.top<p.bottom-1)hit++;}return {out,hit};})()`);
        ok(m.out === 0 && m.hit === 0, `${W} 进度条下面一行的五样东西都在屏幕里、互不重叠`, m);
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
