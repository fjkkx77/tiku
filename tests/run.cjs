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
      const got = await c.ev(`(()=>{const Q=__quiz;return ${JSON.stringify(snap[s])}.map(t=>{const q=QUESTIONS[t.q];const key=q.vocab||q.ans;return (q.ordered?Q.gradeOrdered(t.in,key):Q.gradeBlanksSet(t.in,key)).allCorrect;});})()`);
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
    r = await c.ev(`(async()=>{const Q=__quiz;Q.showScreen("home");document.getElementById("resumeContinueBtn").click();await new Promise(r=>setTimeout(r,300));Q.finishQuiz();return Q.history[0].durationSec;})()`);
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
    r = await c.ev(`(async()=>{${start}const t=document.querySelector(".trans-area");t.value="a "+Q.session.queue[0].vocab[0];t.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true}));const a=!!Q.session.answers[0];t.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",ctrlKey:true,bubbles:true}));return {a,b:!!Q.session.answers[0]&&Q.session.answers[0].allCorrect};})()`);
    ok(!r.a && r.b, '翻译框：回车换行不提交，Ctrl+回车提交', r);
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
    console.log('2. 逻辑检查完成');

    /* ---------- 3. 手势 + 4. 版面 ---------- */
    c.close();
    for (const W of [320, 390, 430]) {
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
