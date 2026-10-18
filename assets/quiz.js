/* =====================================================================
   刷题站通用引擎 —— 8 个科目站共用这一份，改这里 = 8 个站一起改。
   以前每个站是一份完整拷贝，改着改着各自走样（同一个 bug 有的站修了有的没修），2026-10 合并成这一份。

   科目页只需要在引用本文件之前声明两样东西：
     const QUIZ = { title, subtitle, prefix, intro, catWord?, font?, wordlist?, normalize? }
     const QUESTIONS = [ ...题库... ]
   题目对象：
     单选 {type:"mcq", cat, text, options:{A,B,C,D}, correct}
     填空 {type:"blank", cat, text(用 {{}} 标空), code?, ans:[每空一项，| 分隔多个可接受答案], ordered?, vocab?}
       code    单独用代码块样式显示的片段，里面也可以有 {{}}（含 HTML 标签的大题必须放这里）
       多个空默认逐空按位置判（填错位置就是错）；例外用下面三个标记：
       unordered 整题几个空是并列的，不分先后
       anyOrder  只有其中几个空可以互换，如 [[13,14,15]]（序号从 0 数）
       seq       一个空里的几项有先后（如安全序列 Q,P,R）
       ordered   只影响参考答案的显示方式：(1)xx (2)yy
       vocab     翻译题：ans 是完整参考译文，输入框换成多行文本框；提交后自动跟参考译文严格比对
                 （只放过大小写、空格、标点，词一个不能差、顺序不能变），答错时标出差在哪几个词
       accept    翻译题：参考译文有几种写法时把每种完整写出来（ans 仍是显示用的那一句）
     没写 type 的按填空处理（操作系统站的老数据就没写）
   ===================================================================== */
(function(){
"use strict";

/* ===================== 配置 ===================== */
const CFG = Object.assign({
  title: document.title,
  subtitle: "错题本 · 练习记录",
  prefix: "quiz",            // localStorage 前缀：各站必须不同，否则数据互相覆盖
  intro: "",                 // 首页底部「题库共 N 题（…）」括号里的说明
  catWord: "章节",           // 分类叫什么（听力站叫「单元」）
  font: "",                  // "code"＝题里是真代码（等宽字体）/ "en"＝英语（系统 UI 字体）/ 空＝默认
  wordlist: false,           // code 字段是词表：只给英文单词加粗
  normalize: null,           // 自定义答案规范化函数（操作系统站有专用的）
  ansSep: "  /  "            // 多空参考答案之间的分隔符（操作系统站一直用「、」）
}, typeof QUIZ !== "undefined" ? QUIZ : {});
const Q = QUESTIONS;
Q.forEach((q,i)=>{ q.id = "q"+i; if(!q.type) q.type = "blank"; });
const QBYID = Object.create(null); Q.forEach(q=>{ QBYID[q.id] = q; });
const CATS = [...new Set(Q.map(q=>q.cat))];
const HAS_MCQ = Q.some(q=>q.type==="mcq");
const MASTER_STREAK = 3;                 // 错题要连续答对这么多次才移出错题本
const EXAM_AUTOADVANCE_DELAY = 260;      // 快速模式：选对后多久自动跳下一题

/* ===================== 页面骨架 ===================== */
function esc(s){ return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }
if(CFG.font) document.body.classList.add("font-"+CFG.font);
document.body.insertAdjacentHTML("afterbegin", `
<div id="ptrIndicator">
  <svg class="ptr-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"></line><polyline points="5 12 12 5 19 12"></polyline></svg>
  <svg class="ptr-spinner" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"></path></svg>
</div>
<div id="ptrTip"></div>
<div class="app">
  <div class="topbar">
  <header>
    <a class="home-btn" href="../" title="返回主页" aria-label="返回主页">🏠</a>
    <h1>${esc(CFG.title)}</h1>
    ${CFG.subtitle ? `<p>${esc(CFG.subtitle)}</p>` : ""}
    <p class="quiz-scope" id="quizScope"></p>
  </header>
  <nav>
    <button data-screen="home" class="active">开始练习</button>
    <button data-screen="wrongbook">错题本</button>
    <button data-screen="history">练习记录</button>
  </nav>
  </div>
  <main>

    <section class="screen active" id="screen-home">
      <div class="card resume-card" id="resumeCard" hidden>
        <div class="resume-title">📖 继续上次练习</div>
        <div class="resume-sub" id="resumeSub"></div>
        <div class="btn-row">
          <button class="btn secondary" id="resumeRestartBtn">重新练习</button>
          <button class="btn" id="resumeContinueBtn">继续练习</button>
        </div>
      </div>
      <div class="card">
        <div class="toplinks">
          <span id="selAll" role="button" tabindex="0">全选</span>
          <span id="selNone" role="button" tabindex="0">清空</span>
          <span id="selWrongOnly" role="button" tabindex="0">仅选有错题${esc(CFG.catWord)}</span>
        </div>
        <div class="cat-list" id="catList"></div>
      </div>
      <div class="card">
        <div style="font-size:14px;font-weight:bold;margin-bottom:6px;">出题方式</div>
        <div class="mode-row">
          <label><input type="radio" name="order" value="seq" checked>原始顺序</label>
          <label><input type="radio" name="order" value="random">随机顺序</label>
        </div>
        <label class="only-new"><input type="checkbox" id="onlyNew">只练没做过的题</label>
        <div class="btn-row">
          <button class="btn" id="startBtn">开始练习</button>
        </div>
        <div style="text-align:center;margin-top:10px;">
          <a class="back-link" href="../">← 返回刷题主界面</a>
        </div>
      </div>
      <div class="card" style="font-size:12px;color:var(--muted);text-align:center;">
        题库共 <b id="totalQCount">${Q.length}</b> 题${CFG.intro ? `（${esc(CFG.intro)}）` : ""}
      </div>
    </section>

    <section class="screen" id="screen-quiz">
      <div class="progress-wrap">
        <div class="progress-bar"><div class="progress-bar-fill" id="quizProgressFill"></div></div>
        <div class="progress-info">
          <div class="progress-left">
            <span id="quizProgressText"></span>
            <span id="quizScoreText"></span>
          </div>
          <div class="progress-right">
            <span class="mode-toggle" id="reciteBtn" role="button" tabindex="0"></span>
            ${HAS_MCQ ? `<span class="mode-toggle" id="modeToggleBtn" role="button" tabindex="0"></span>` : ""}
            <span class="ov-link" id="overviewLink" role="button" tabindex="0">题目总览</span>
          </div>
        </div>
      </div>
      <div class="card qcard">
        <div class="q-tag" id="qTag"></div>
        <div class="q-text" id="qText"></div>
        <div id="qCode" class="q-code" hidden></div>
        <div id="qBody"></div>
        <div class="answer-box" id="answerBox"></div>
        <footer class="qfoot">
          <button class="btn secondary" id="prevBtn">上一题</button>
          <button class="btn secondary" id="checkBtn">提交答案</button>
          <button class="btn" id="nextBtn">下一题</button>
        </footer>
      </div>
      <div class="btn-row">
        <button class="btn gray" id="quitQuizBtn">结束并查看结果</button>
      </div>
      <div class="key-hint">键盘：A–D 或 1–4 选选项 · 回车 提交 / 下一题 · ← → 切题</div>
    </section>

    <!-- 题目总览（右侧抽屉） -->
    <div class="ov-backdrop" id="ovBackdrop"></div>
    <section class="screen" id="screen-overview">
      <div class="ov-header-row">
        <div style="font-size:16px;font-weight:bold;">题目总览</div>
        <span class="ov-close" id="ovCloseBtn" role="button" tabindex="0" aria-label="关闭题目总览">&times;</span>
      </div>
      <div class="ov-legend">
        <span><span class="ov-dot cur"></span>当前</span>
        <span><span class="ov-dot right"></span>已答对</span>
        <span><span class="ov-dot wrong"></span>已答错</span>
        <span><span class="ov-dot"></span>未作答</span>
      </div>
      <div id="ovContent"></div>
      <div class="btn-row">
        <button class="btn gray" id="ovBackBtn">返回答题</button>
      </div>
    </section>

    <section class="screen" id="screen-result">
      <div class="card">
        <div style="text-align:center;font-size:16px;font-weight:bold;">本次练习结果</div>
        <div class="stat-grid">
          <div><b id="resTotal">0</b><span>总题数</span></div>
          <div><b id="resAnswered">0</b><span>已答</span></div>
          <div><b id="resUnanswered">0</b><span>未答</span></div>
        </div>
        <div class="stat-grid cols2">
          <div class="stat-click" id="resCorrectBox"><b id="resCorrect" style="color:var(--green)">0</b><span>答对（点击查看）</span></div>
          <div class="stat-click" id="resWrongBox"><b id="resWrong" style="color:var(--red)">0</b><span>答错（点击查看）</span></div>
        </div>
        <div class="stat-grid cols2 stat-highlight">
          <div><b id="resRate">0%</b><span>正确率</span></div>
          <div><b id="resTime">0分0秒</b><span>用时</span></div>
        </div>
        <div class="btn-row">
          <button class="btn secondary" id="backToQuizBtn">返回本次练习（继续查看/作答）</button>
        </div>
        <div class="btn-row">
          <button class="btn" id="retryAllBtn">重新练习（同范围）</button>
          <button class="btn secondary" id="retryWrongBtn">只练本次错题</button>
        </div>
        <div class="btn-row">
          <button class="btn gray" id="backHomeBtn">返回首页</button>
        </div>
      </div>
    </section>

    <!-- 答对/答错题目明细 -->
    <section class="screen" id="screen-resultlist">
      <div class="card">
        <div style="font-size:16px;font-weight:bold;margin-bottom:10px;" id="resultListTitle"></div>
        <div id="resultListBody"></div>
      </div>
      <div class="btn-row">
        <button class="btn gray" id="resultListBackBtn">返回结果</button>
      </div>
    </section>

    <section class="screen" id="screen-wrongbook">
      <div class="card" id="wrongbookSummary"></div>
      <div class="card" id="wrongbookList"></div>
    </section>

    <section class="screen" id="screen-history">
      <div class="card" id="historyList"></div>
      <div class="card" style="text-align:center;">
        <button class="btn gray" id="clearHistoryBtn">清空历史记录</button>
      </div>
    </section>

    <!-- 自定义确认弹窗（替代原生 confirm/alert，保证跨设备/浏览器样式一致） -->
    <div class="confirm-backdrop" id="confirmBackdrop">
      <div class="confirm-box">
        <div class="confirm-msg" id="confirmMsg"></div>
        <div class="confirm-btns">
          <button class="confirm-cancel" id="confirmCancelBtn">取消</button>
          <button class="confirm-ok" id="confirmOkBtn">确定</button>
        </div>
      </div>
    </div>

  </main>
</div>`);
const $ = id => document.getElementById(id);

/* ===================== 本地存储（key 沿用各站原来的名字，老数据照常可用） ===================== */
const LS_HISTORY = CFG.prefix+"_history", LS_WRONGBOOK = CFG.prefix+"_wrongbook",
      LS_EXAMMODE = CFG.prefix+"_exammode", LS_INPROGRESS = CFG.prefix+"_inprogress";
const LS_DONE = CFG.prefix+"_done", LS_RECITE = CFG.prefix+"_recite";
function lsGet(key){ try{ return localStorage.getItem(key); }catch(e){ return null; } }   // 浏览器禁用存储时一碰就抛错
function loadJSON(key,def){ try{ const v = JSON.parse(localStorage.getItem(key)); return v==null ? def : v; }catch(e){ return def; } }
let saveFailTold = false, toastTimer = null;
function toast(msg, ms){
  const tip = document.getElementById("ptrTip"); if(!tip) return;
  tip.textContent = msg; tip.classList.add("show");
  clearTimeout(toastTimer); toastTimer = setTimeout(()=>tip.classList.remove("show"), ms || 1800);
}
function saveJSON(key,val){
  try{ localStorage.setItem(key, JSON.stringify(val)); return true; }
  catch(e){
    // 存不进去（空间满了 / 存储被禁用）：必须让人知道，否则错题和进度悄悄丢了都不知道。一次打开只提示一回
    // 用不挡操作的提示条，不用确认弹窗：两者共用一个遮罩，正在问"确定要切换吗"时弹出来会替人把那个问题答成"确定"
    if(!saveFailTold){ saveFailTold = true; toast("⚠️ 浏览器存不进数据了（空间已满或存储被禁用），这次的错题和进度可能没保存。可以清理一下这个浏览器里别的网站数据", 6000); }
    return false;
  }
}
// 存储里的东西不一定是我们写的样子（被别的页面写坏、旧版本留下的）：只留认得的，别让一条坏数据把整页弄死
function cleanWrongbook(w){
  const out = {};
  if(w && typeof w === "object" && !Array.isArray(w)) Object.keys(w).forEach(id=>{ if(w[id] && typeof w[id] === "object") out[id] = w[id]; });
  return out;
}
function cleanHistory(h){ return Array.isArray(h) ? h.filter(x=>x && typeof x === "object") : []; }
function num(v){ v = Number(v); return isFinite(v) ? v : 0; }   // 存储里的数字拼进页面前一律过一遍，别把字符串当 HTML 插进去
let historyList = cleanHistory(loadJSON(LS_HISTORY, []));
let wrongbook = cleanWrongbook(loadJSON(LS_WRONGBOOK, {}));
let doneSet = loadJSON(LS_DONE, {}); if(!doneSet || typeof doneSet !== "object" || Array.isArray(doneSet)) doneSet = {};

/* 同一科目可能同时开着不止一个页面（两个标签页；或者按"返回"时浏览器把很久以前的旧页面原样恢复出来）。
   每个页面内存里都有一份错题本/记录，旧页面一保存就会把别的页面刚记的整份冲掉。
   所以：改之前先从存储重新读一遍，在最新的那份上改，再写回去。 */
function updateWrongbook(fn){ wrongbook = cleanWrongbook(loadJSON(LS_WRONGBOOK, {})); fn(wrongbook); return saveJSON(LS_WRONGBOOK, wrongbook); }
function updateHistory(fn){ historyList = cleanHistory(loadJSON(LS_HISTORY, [])); fn(historyList); if(historyList.length>100) historyList = historyList.slice(0,100); return saveJSON(LS_HISTORY, historyList); }
const FP = new Map(Q.map(q=>[q.id, fp(q)]));
// 从错题本移出过的题记个时间（连对 3 次、手动移出、清空）：导入一份更早的备份时，比这个时间旧的错题不再放回来
const LS_REMOVED = CFG.prefix+"_wbremoved";
function markRemoved(ids){ const m = loadJSON(LS_REMOVED, {}); const out = (m && typeof m === "object" && !Array.isArray(m)) ? m : {}; const now = Date.now(); ids.forEach(id=>{ out[id] = now; }); saveJSON(LS_REMOVED, out); }
function markDone(q){ doneSet = loadJSON(LS_DONE, {}) || {}; if(typeof doneSet !== "object" || Array.isArray(doneSet)) doneSet = {}; doneSet[fp(q)] = 1; saveJSON(LS_DONE, doneSet); }

/* 题目指纹：题号是按题库里的位置编的（q0、q1…），以后在题库中间插题/删题，
   老的错题记录和续练进度就会对到别的题上，而且没有任何提示。
   所以读的时候拿内容指纹对一下：对不上就按内容把它找回来；找不回来也不张冠李戴。 */
function fp(o){
  const s = (o.text||"") + "\u0001" + JSON.stringify(o.options || o.ans || "");
  let h = 5381; for(let i=0;i<s.length;i++) h = ((h<<5) + h + s.charCodeAt(i)) | 0;
  return (h>>>0).toString(36);
}
function relocateWrongbook(){
  const byFp = new Map();
  Q.forEach(q=>{ const f = fp(q); if(!byFp.has(f)) byFp.set(f, []); byFp.get(f).push(q.id); });
  const ids = Object.keys(wrongbook), out = {};
  const inPlace = id => QBYID[id] && fp(QBYID[id]) === fp(wrongbook[id]);
  ids.filter(inPlace).forEach(id=>{ out[id] = wrongbook[id]; });            // 先放位置没变的，搬家的不能挤掉它们
  let changed = false;
  ids.filter(id=>!inPlace(id)).forEach(id=>{
    const target = (byFp.get(fp(wrongbook[id])) || []).find(c=>!out[c]);
    if(target){ out[target] = wrongbook[id]; changed = true; }
    else if(!out[id]) out[id] = wrongbook[id];   // 题库里找不到这道题了（比如题目被改过字）：原样留着，不硬配
  });
  if(changed){ wrongbook = out; saveJSON(LS_WRONGBOOK, wrongbook); }
}
relocateWrongbook();

/* ===================== 判分 ===================== */
const normalize = typeof CFG.normalize === "function" ? CFG.normalize
  : s => (s||"").trim().toLowerCase().replace(/[\s;；]/g,"");
// iPhone 默认开「智能标点」，打 ' " 出来的是弯引号；判分前统一成直的
function straighten(s){ return String(s==null?"":s).replace(/[‘’]/g,"'").replace(/[“”]/g,'"'); }
// 「你写的内容里包含正确答案也算对」2026-10-18 起整个去掉了（用户定）：一整句乱写的话只要碰巧含「虚拟」就判对，
// 看着又是绿色，很矛盾。现在只认规范化后完全一致、题库里用 | 列出的几种写法、以及并列几项换顺序
// seq=true：这个空里的几项有先后（如安全序列 Q,P,R），不做"顺序无关"那一步
function isCorrect(userInput, acceptStr, seq){
  userInput = straighten(userInput);
  const u = normalize(userInput);
  if(!u) return false;
  for(const opt of straighten(acceptStr).split("|")){
    const o = normalize(opt);
    if(u === o) return true;
    if(seq) continue;
    // 顺序无关：按"和/、/，/,"拆开排序再比。必须先拆再 normalize（有的站 normalize 会把顿号逗号删掉）
    const splitRe = /[和、，,]/;
    const oParts = opt.split(splitRe).map(normalize).filter(Boolean).sort();
    const uParts = userInput.split(splitRe).map(normalize).filter(Boolean).sort();
    if(oParts.length>1 && oParts.length===uParts.length && oParts.every((p,i)=>p===uParts[i])) return true;
  }
  return false;
}
// 整体集合对得上就算对（贪心两两配对）——只给写了 unordered:true 的题用
function gradeBlanksSet(userInputs, expectedList, seq){
  const n = expectedList.length, used = new Array(n).fill(false), assignment = new Array(userInputs.length).fill(-1);
  // 先配"一字不差"的，再配宽松的：否则 line-height:24px 会先把 height:24px 那个空占掉（它"包含"后者），真正的 height:24px 反而没处放
  const exact = (u, acc)=>{ const x = normalize(straighten(u)); return !!x && straighten(acc).split("|").some(o=>normalize(o)===x); };
  [exact, (u, acc)=>isCorrect(u, acc, seq)].forEach(match=>{
    for(let i=0;i<userInputs.length;i++){
      if(assignment[i]!==-1) continue;
      for(let j=0;j<n;j++){
        if(!used[j] && match(userInputs[i], expectedList[j])){ used[j]=true; assignment[i]=j; break; }
      }
    }
  });
  return { allCorrect: assignment.length>0 && assignment.every(a=>a!==-1), assignment };
}
function gradeOrdered(userInputs, expectedList, seq){
  const assignment = expectedList.map((exp,i)=> isCorrect(userInputs[i]||"", exp, seq) ? i : -1);
  return { allCorrect: assignment.every(a=>a!==-1), assignment };
}
/* 一道填空题怎么判（页面提交和测试都走这一个入口）：
   默认逐空按位置判——填错位置就是错（2026-10 以前默认不分顺序，把答案填反也判全对）；
   unordered:true  整题几个空是并列的，不分先后（如"操作系统的特征是：__、__、__、__"）；
   anyOrder:[[13,14,15]]  只有这几个空之间可以互换（如同一个 CSS 选择器里的几条声明），其余仍按位置；
   seq:true  一个空里的几项有先后，不能换（如安全序列）。 */
/* 翻译题：严格对照参考译文（2026-10-14 用户要求，取代以前的"本人自评"）。
   只放过不改变译文本身的差别：大小写、空格多少、标点（含弯/直引号、破折号、连字符）；词一个不能差，顺序不能变。
   缩写也算不同的词：you're ≠ you are。参考译文有几种写法的，在题目上用 accept 列全。 */
const TRANS_WORD_RE = /[A-Za-z0-9'‘’]+/g;
function transTokens(s){ return (String(s==null?"":s).match(TRANS_WORD_RE) || []).map(w=>w.toLowerCase().replace(/['‘’]/g,"")).filter(Boolean); }
function transRefs(q){ return q.accept && q.accept.length ? q.accept : String((q.ans||[])[0]||"").split("|"); }
function gradeTranslation(q, text){
  const u = transTokens(text).join(" ");
  return !!u && transRefs(q).some(r=>transTokens(r).join(" ")===u);
}
// 最长公共子序列：标出你多写/写错的词（mine）和参考译文里你没写到的词（ref）
function transDiff(mine, ref){
  const a = transTokens(mine), b = transTokens(ref), n = a.length, m = b.length;
  const L = Array.from({length:n+1}, ()=>new Array(m+1).fill(0));
  for(let i=n-1;i>=0;i--) for(let j=m-1;j>=0;j--) L[i][j] = a[i]===b[j] ? L[i+1][j+1]+1 : Math.max(L[i+1][j], L[i][j+1]);
  const keepA = new Array(n).fill(false), keepB = new Array(m).fill(false);
  for(let i=0,j=0; i<n && j<m;){
    if(a[i]===b[j]){ keepA[i]=keepB[j]=true; i++; j++; }
    else if(L[i+1][j] >= L[i][j+1]) i++; else j++;
  }
  return { keepA, keepB, common: L[0][0] };
}
// 原样显示（保留标点），只把 keep[k] 为 false 的第 k 个词包上标记
function markWords(text, keep, cls){
  let k = 0, out = "", last = 0, m;
  const s = String(text||""), re = new RegExp(TRANS_WORD_RE.source, "g");
  while((m = re.exec(s))){
    if(!m[0].replace(/['‘’]/g,"")) continue;
    out += esc(s.slice(last, m.index)) + (keep[k] ? esc(m[0]) : `<mark class="${cls}">${esc(m[0])}</mark>`);
    last = m.index + m[0].length; k++;
  }
  return out + esc(s.slice(last));
}
function gradeQuestion(q, userInputs){
  if(q.vocab){ const ok = gradeTranslation(q, (userInputs||[])[0]); return { allCorrect: ok, assignment: [ok ? 0 : -1] }; }
  const key = q.ans || [];
  if(q.unordered) return gradeBlanksSet(userInputs, key, q.seq);
  const g = gradeOrdered(userInputs, key, q.seq);
  (q.anyOrder || []).forEach(group=>{
    const sub = gradeBlanksSet(group.map(i=>userInputs[i]||""), group.map(i=>key[i]), q.seq);
    group.forEach((i,k)=>{ g.assignment[i] = sub.assignment[k]===-1 ? -1 : group[sub.assignment[k]]; });
  });
  g.allCorrect = g.assignment.length>0 && g.assignment.every(a=>a!==-1);
  return g;
}

/* ===================== 小工具 ===================== */
function fmtTime(sec){ sec = Math.max(0, Math.round(sec||0)); const m=Math.floor(sec/60), s=sec%60; return m+"分"+s+"秒"; }
function fmtDate(ts){ const d=new Date(ts); return `${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`; }
function shuffle(arr){ for(let i=arr.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [arr[i],arr[j]]=[arr[j],arr[i]]; } return arr; }
function pct(a,b){ return b ? Math.round(a/b*100) : 0; }
function firstAns(a){ return String(a).split("|")[0]; }
function ansText(q, sep){
  if(q.type==="mcq") return `${q.correct}. ${(q.options||{})[q.correct]||""}`;
  const list = q.ans || [];
  return q.ordered && list.length>1 ? list.map((a,i)=>`(${i+1})${firstAns(a)}`).join("　") : list.map(firstAns).join(sep || CFG.ansSep);
}
/* 答题页的参考答案：每空一行、带编号（2026-10-19 用户报「a / b / c」一段里分不清哪个是哪一空）。
   传了 userInputs 就是判过分的：对的空编号绿、错的红，错的下面写「你填：…」；没传（背题）就只列答案。
   题库里用 | 列的其他写法只列跟第一种不止差空格的（Cal(Num1,Num2); 这种只是少个空格，列出来是噪音） */
function ansListHtml(q, userInputs, assignment, allCorrect){
  const list = q.ans || [], many = list.length > 1, judged = !!userInputs;
  const squash = s=>String(s).replace(/\s+/g, "");
  return `<ol class="ans-list">` + list.map((a,i)=>{
    const alts = String(a).split("|"), main = alts[0];
    const extra = alts.slice(1).filter((x,j,arr)=>squash(x)!==squash(main) && arr.findIndex(y=>squash(y)===squash(x))===j);
    const ok = judged ? (assignment ? assignment[i]!==-1 : allCorrect) : true;
    const mine = judged ? String(userInputs[i]||"").trim() : "";
    return `<li class="ans-row ${ok?"ok":"bad"}">${many ? `<span class="ans-no">${i+1}</span>` : ""}<div class="ans-body">`
      + `<span class="ans-main">${esc(main)}</span>`
      + (extra.length ? `<span class="ans-alt">也可写成 ${extra.map(x=>`<span class="v">${esc(x)}</span>`).join("、")}</span>` : "")
      + (ok ? "" : mine ? `<div class="ans-mine">你填：<s>${esc(mine)}</s></div>` : `<div class="ans-mine none">没填</div>`)
      + `</div></li>`;
  }).join("") + `</ol>`;
}
// 提交后给题里每一空前面挂上编号，跟下面参考答案的编号对上（只有一空的题不挂）
function numberBlanks(inputs, assignment, allCorrect){
  if(inputs.length < 2) return;
  inputs.forEach((inp,i)=>{
    const prev = inp.previousElementSibling;
    if(prev && prev.classList.contains("blank-no")) prev.remove();
    const ok = assignment ? assignment[i]!==-1 : allCorrect;
    inp.insertAdjacentHTML("beforebegin", `<span class="blank-no${ok?"":" bad"}" data-no="${i+1}" aria-hidden="true"></span>`);
  });
}
// 复习/错题列表里展示的题干：代码块一起带上；没有题干的（听力题）就把选项列出来
function plainText(q){
  let t = (q.text||"").replace(/\{\{\}\}/g,"____");
  if(q.code) t += (t?"\n":"") + q.code.replace(/\{\{\}\}/g,"____");
  if(!q.text && q.options) t = Object.keys(q.options).map(L=>`${L}. ${q.options[L]}`).join("\n");
  return t;
}
// 词表框：只给英文单词和【标题】加粗；中文释义保持常规字重（微软雅黑没有 600，会被取整成粗体）
function styleWordlist(raw){
  let out = "", last = 0, m; const re = /(【[^】]*】)|([A-Za-z][A-Za-z'-]*)/g;
  while((m = re.exec(raw))){ out += esc(raw.slice(last, m.index)) + `<span class="wl-bold">${esc(m[0])}</span>`; last = re.lastIndex; }
  return out + esc(raw.slice(last));
}

/* 自定义弹窗：替代原生 confirm/alert。原生弹窗长什么样由浏览器/微信内核决定，各设备不一致。
   showConfirm(msg) → Promise<是否点了确定>；showAlert(msg) 只有一个「知道了」 */
function showConfirm(msg, opt){
  opt = opt || {};
  return new Promise(resolve=>{
    $("confirmMsg").textContent = msg;
    const bd = $("confirmBackdrop"), ok = $("confirmOkBtn"), cancel = $("confirmCancelBtn");
    ok.textContent = opt.ok || "确定";
    cancel.hidden = !!opt.alertOnly;
    const before = document.activeElement;
    bd.classList.add("show");
    try{ ok.focus({preventScroll:true}); }catch(e){}
    function done(r){ bd.classList.remove("show"); try{ if(before && before.focus && document.contains(before)) before.focus({preventScroll:true}); }catch(e){} ok.removeEventListener("click", onOk); cancel.removeEventListener("click", onCancel); resolve(r); }
    function onOk(){ done(true); } function onCancel(){ done(false); }
    ok.addEventListener("click", onOk); cancel.addEventListener("click", onCancel);
  });
}
function showAlert(msg){ return showConfirm(msg, { ok:"知道了", alertOnly:true }); }
function isActive(id){ const n=$(id); return !!n && n.classList.contains("active"); }
function hasShow(id){ const n=$(id); return !!n && n.classList.contains("show"); }

/* ===================== 屏幕切换 ===================== */
function showScreen(name){
  document.querySelectorAll(".screen").forEach(s=>s.classList.remove("active"));
  $("ovBackdrop").classList.remove("show");
  $("screen-"+name).classList.add("active");
  document.querySelectorAll("nav button").forEach(b=>b.classList.toggle("active", b.dataset.screen===name));
  document.body.classList.toggle("quizzing", name==="quiz");
  // 答题时标题下面写「正在练习 · 范围」，让人一眼知道在刷哪一科、哪部分（2026-10-15 用户嫌答题页顶栏太窄、看不出在刷什么）
  $("quizScope").textContent = (name==="quiz" && session && session.scopeLabel) ? "正在练习 · " + session.scopeLabel : "";
  if(name==="quiz") timerResume(); else timerPause();
  syncBackEntry(name);
  if(name==="wrongbook") renderWrongbook();
  if(name==="history") renderHistory();
}
document.querySelectorAll("nav button").forEach(b=>b.addEventListener("click", async ()=>{
  if(isActive("screen-quiz")){
    keepDraftNow();
    if(!await showConfirm("你正在刷题中，确定要切换到其他页面吗？\n放心，当前进度（包括这道题已经填的内容）已自动保存，可以稍后在「开始练习」页点击「继续上次练习」找回。")) return;
  }
  if(b.dataset.screen==="home") renderCatList();
  showScreen(b.dataset.screen);
}));

/* 手机上的"返回"（安卓返回键、iPhone 从左边缘右滑）：以前会直接离开整个科目站。
   现在离开首页时往浏览器历史里垫一条，按返回 = 先关总览抽屉 → 再回到本站首页，第三次才是真的离开。
   进度本来就是实时保存的，所以回首页不用再问。 */
let backArmed = false, backSilent = false;
function syncBackEntry(name){
  if(!window.history || !history.pushState) return;
  if(name !== "home" && !backArmed){ try{ history.pushState({ tikuInner: 1 }, ""); backArmed = true; }catch(e){} }
  else if(name === "home" && backArmed){ backArmed = false; backSilent = true; try{ history.back(); }catch(e){ backSilent = false; } }
}
window.addEventListener("popstate", ()=>{
  if(backSilent){ backSilent = false; return; }          // 是我们自己为了撤掉那一条而退的，不用处理
  if(!backArmed) return;
  if(hasShow("confirmBackdrop") || isActive("screen-overview")){
    // 有浮层：这次返回只用来关浮层，把垫的那一条补回去
    if(hasShow("confirmBackdrop")) ($("confirmCancelBtn").hidden ? $("confirmOkBtn") : $("confirmCancelBtn")).click(); else closeOverview();
    try{ history.pushState({ tikuInner: 1 }, ""); }catch(e){ backArmed = false; }
    return;
  }
  backArmed = false;
  clearAutoAdvance(); keepDraftNow();
  renderCatList(); showScreen("home");
});
// 答题中点左上角🏠：和旁边三个标签一样先问一句（进度是保存了的，只是别让人被误触带走）
function leaveTo(href){ if(backArmed){ backArmed = false; location.replace(href); } else location.href = href; }
document.querySelector(".home-btn").addEventListener("click", async e=>{
  const href = e.currentTarget.href;
  if(!isActive("screen-quiz")){ if(backArmed){ e.preventDefault(); leaveTo(href); } return; }
  e.preventDefault();
  keepDraftNow();
  if(await showConfirm("你正在刷题中，确定要回到刷题主界面吗？\n放心，当前进度（包括这道题已经填的内容）已自动保存，下次点「继续上次练习」接着做。")) leaveTo(href);
});

/* ===================== 首页：章节选择 ===================== */
function renderCatList(){
  // 重画时保留用户已经取消勾选的章节（旧版一回首页就全部重置成勾选）
  const unchecked = new Set([...document.querySelectorAll(".catChk")].filter(c=>!c.checked).map(c=>c.value));
  $("catList").innerHTML = CATS.map(cat=>{
    const inCat = Q.filter(q=>q.cat===cat), cnt = inCat.length;
    const dcnt = inCat.filter(isDone).length;
    const wcnt = Object.values(wrongbook).filter(w=>w.cat===cat).length;
    return `<label>
      <input type="checkbox" class="catChk" value="${esc(cat)}"${unchecked.has(cat) ? "" : " checked"}>
      ${esc(cat)}
      <span class="cat-count">${cnt}题${dcnt?` · 做过${dcnt}`:""}${wcnt?` · <span class="badge-cnt">${wcnt}错</span>`:""}</span>
    </label>`;
  }).join("");
  renderResumeCard();
}
function isDone(q){ return !!doneSet[FP.get(q.id)]; }
function checkedCats(){ return [...document.querySelectorAll(".catChk:checked")].map(c=>c.value); }
$("selAll").onclick = ()=>document.querySelectorAll(".catChk").forEach(c=>c.checked=true);
$("selNone").onclick = ()=>document.querySelectorAll(".catChk").forEach(c=>c.checked=false);
$("selWrongOnly").onclick = ()=>{
  const wrongCats = new Set(Object.values(wrongbook).map(w=>w.cat));
  if(!wrongCats.size){ showAlert("错题本里还没有错题，没有可选的" + CFG.catWord + "。"); return; }   // 旧版会悄悄把所有勾都清掉
  document.querySelectorAll(".catChk").forEach(c=>c.checked = wrongCats.has(c.value));
};
$("startBtn").onclick = ()=>{
  const cats = checkedCats();
  if(!cats.length){ showAlert("请至少选择一个" + CFG.catWord); return; }
  let pool = Q.filter(q=>cats.includes(q.cat)), label = cats.length===CATS.length ? `全部${CFG.catWord}` : cats.join("、");
  if($("onlyNew").checked){
    pool = pool.filter(q=>!isDone(q)); label += "（没做过的）";
    if(!pool.length){ showAlert("选中的" + CFG.catWord + "里，每道题你都做过了。\n去掉「只练没做过的题」就能再练一遍。"); return; }
  }
  startQuiz(pool, label, true);
};

/* ===================== 练习会话 ===================== */
let session = null;   // {queue, idx, answers[], elapsed(毫秒), scopeLabel, historyDate?}
let selectedOpt = null;
let activeSince = null;

/* 用时只算真正停在答题页上的时间：切到别的页、锁屏、关掉页面期间都不算。
   旧版存的是「开始时刻」，隔一天再点「继续上次练习」，用时会把隔的这一整天都算进去。 */
function elapsedNow(){ return session ? (session.elapsed||0) + (activeSince ? Date.now()-activeSince : 0) : 0; }
function timerPause(){ if(session && activeSince){ session.elapsed = elapsedNow(); activeSince = null; } }
function timerResume(){ if(session && !activeSince && document.visibilityState !== "hidden") activeSince = Date.now(); }
document.addEventListener("visibilitychange", ()=>{
  if(document.visibilityState === "hidden"){ if(activeSince){ timerPause(); saveProgress(); } }
  else { refreshFromStorage(); if(isActive("screen-quiz")) timerResume(); }
});
// 从"返回"恢复出来的旧页面（往返缓存）、别的页面改了存储：都重新读一遍，别拿内存里的旧数据接着用
window.addEventListener("pageshow", e=>{ if(e.persisted) refreshFromStorage(); });
window.addEventListener("storage", e=>{
  if(!e.key) return refreshFromStorage();                    // 整个存储被清空
  if(e.key === LS_INPROGRESS) return checkStale();           // 别的页面在答题（每打几个字就会存一次草稿）：只看要不要让位，不重画
  if([LS_WRONGBOOK, LS_HISTORY, LS_DONE].includes(e.key)) refreshFromStorage();
});
function refreshFromStorage(){
  wrongbook = cleanWrongbook(loadJSON(LS_WRONGBOOK, {}));
  historyList = cleanHistory(loadJSON(LS_HISTORY, []));
  doneSet = loadJSON(LS_DONE, {}) || {};
  if(checkStale()) return;
  if(isActive("screen-home")) renderCatList();
  if(isActive("screen-wrongbook")) renderWrongbook();
  if(isActive("screen-history")) renderHistory();
}
function checkStale(){
  if(session && !session.finished && isActive("screen-quiz") && someoneElseIsNewer()){
    // 这场练习在别的页面里已经往后做了（或者已经开了新的）：这一页是旧的，再答下去只会把新进度盖掉
    session = null; activeSince = null; clearAutoAdvance();
    renderCatList(); showScreen("home");
    showAlert("这场练习在另一个页面里有更新的进度，这一页是旧的。\n已回到首页，点「继续上次练习」接着做。");
    return true;
  }
  return false;
}

/* ===================== 继续上次练习（进行中的进度实时存 localStorage） ===================== */
// 存档上带「是哪个页面存的（sid）」和「什么时候存的」：别的页面存过更新的，就轮不到这一页去覆盖
const PAGE_ID = Math.random().toString(36).slice(2) + Date.now().toString(36);
function someoneElseIsNewer(){
  const s = loadJSON(LS_INPROGRESS, null);
  return !!(s && s.sid && session && s.sid !== session.sid && num(s.savedAt) > num(session.savedAt));
}
function saveProgress(){
  if(!session || session.finished) return;
  if(someoneElseIsNewer()) return;
  session.savedAt = Date.now();
  saveJSON(LS_INPROGRESS, {
    ids: session.queue.map(q=>q.id), fps: session.queue.map(fp),
    answers: session.answers, drafts: session.drafts || {}, idx: session.idx, elapsed: elapsedNow(),
    scopeLabel: session.scopeLabel, historyDate: session.historyDate || null,
    sid: session.sid, savedAt: session.savedAt
  });
}
function clearProgress(){ try{ localStorage.removeItem(LS_INPROGRESS); }catch(e){} }
function loadSaved(){
  const s = loadJSON(LS_INPROGRESS, null);
  if(!s || !Array.isArray(s.ids) || !Array.isArray(s.answers)) return null;
  const queue = s.ids.map(id=>QBYID[id]);
  const bad = queue.some(q=>!q) || (Array.isArray(s.fps) && queue.some((q,i)=>fp(q)!==s.fps[i]));
  if(bad || typeof s.idx!=="number" || s.idx<0 || s.idx>=queue.length){ clearProgress(); return null; }   // 题库改过、对不上：作废，不硬凑
  return { queue, saved: s };
}
function renderResumeCard(){
  const r = loadSaved(), card = $("resumeCard");
  if(!r){ card.hidden = true; return; }
  const { queue, saved } = r;
  $("resumeSub").textContent = `已完成 ${saved.answers.filter(Boolean).length}/${queue.length} 题 · 范围：${saved.scopeLabel}`;
  card.hidden = false;
  $("resumeContinueBtn").onclick = ()=>{
    // 老版本存的是 startTime 而不是 elapsed：没法知道中间离开了多久，只好从 0 接着计
    session = { queue, idx: saved.idx, answers: saved.answers, drafts: (saved.drafts && typeof saved.drafts==="object") ? saved.drafts : {},
      elapsed: saved.elapsed||0, scopeLabel: saved.scopeLabel, historyDate: saved.historyDate||null, sid: newSid(), savedAt: Date.now() };
    activeSince = null;
    showScreen("quiz"); renderQuestion();
  };
  // 「重新练习」会丢掉已经答过的进度，和「继续练习」又紧挨着：答过题就先问一句（「开始练习」那边本来就会问）
  $("resumeRestartBtn").onclick = async ()=>{
    const n = saved.answers.filter(Boolean).length;
    if(n && !await showConfirm(`这场练习已经答了 ${n}/${queue.length} 题。\n重新练习会从第 1 题开始，已答的进度会清掉，确定吗？\n（错题本里的记录不受影响）`)) return;
    startQuiz(queue, saved.scopeLabel, false);
  };
}
let sidCounter = 0;
function newSid(){ return PAGE_ID + "-" + (++sidCounter); }

async function startQuiz(questionPool, scopeLabel, confirmOverwrite){
  if(confirmOverwrite){
    const r = loadSaved();
    if(r && r.saved.answers.some(Boolean)){
      if(!await showConfirm(`上次的练习还没做完（已答 ${r.saved.answers.filter(Boolean).length}/${r.queue.length} 题）。\n开始新的练习会覆盖它，确定吗？`)) return;
    }
  }
  const random = (document.querySelector('input[name="order"]:checked')||{}).value === "random";
  // 单选题和填空题各自成一段、永远不穿插（来回切换"点选项"和"打字"两种操作很割裂）；随机只在题型内部打乱
  const mcq = questionPool.filter(q=>q.type==="mcq"), blank = questionPool.filter(q=>q.type!=="mcq");
  if(random){ shuffle(mcq); shuffle(blank); }
  const pool = mcq.concat(blank);
  activeSince = null;
  session = { queue: pool, idx: 0, answers: new Array(pool.length).fill(null), drafts: {}, elapsed: 0, scopeLabel, sid: newSid(), savedAt: Date.now() };
  showScreen("quiz"); renderQuestion();
}
function currentQ(){ return session.queue[session.idx]; }
function sessionStats(){
  let correct=0, wrong=0;
  session.answers.forEach(a=>{ if(a){ a.allCorrect ? correct++ : wrong++; } });
  return { correct, wrong, answered: correct+wrong, total: session.queue.length };
}
function renderStats(){
  const s = sessionStats();
  $("quizProgressText").textContent = `${session.idx+1}/${s.total}`;
  $("quizProgressFill").style.width = `${(session.idx+1)/s.total*100}%`;   // 旧版是 idx/total，到最后一题也到不了满格
  $("quizScoreText").textContent = `对${s.correct} 错${s.wrong} · 已答${s.answered} 未答${s.total-s.answered}`;
}

/* ===================== 快速模式（单选题选中即提交，选对自动跳题） ===================== */
let examMode = HAS_MCQ && (lsGet(LS_EXAMMODE) ?? "true") === "true";   // 存的是字符串，必须显式比较
let autoAdvanceTimer = null;
function applyModeToggleUI(){
  const btn = $("modeToggleBtn"); if(!btn) return;
  btn.textContent = examMode ? "⚡快速模式" : "✍️手动模式";
  btn.classList.toggle("manual", !examMode);
}
function clearAutoAdvance(){ if(autoAdvanceTimer){ clearTimeout(autoAdvanceTimer); autoAdvanceTimer = null; } }
function scheduleAutoAdvance(idxAtSubmit){
  clearAutoAdvance();
  autoAdvanceTimer = setTimeout(()=>{
    autoAdvanceTimer = null;
    if(session && isActive("screen-quiz") && session.idx===idxAtSubmit && session.idx < session.queue.length-1){ session.idx++; renderQuestion(); }
  }, EXAM_AUTOADVANCE_DELAY);
}
if($("modeToggleBtn")){
  $("modeToggleBtn").onclick = ()=>{
    examMode = !examMode;
    try{ localStorage.setItem(LS_EXAMMODE, examMode ? "true" : "false"); }catch(e){}
    applyModeToggleUI();
  };
  applyModeToggleUI();
}

/* ===================== 背题模式（直接看答案，不计对错、不进错题本） ===================== */
let recite = lsGet(LS_RECITE) === "true";
function applyReciteUI(){
  const btn = $("reciteBtn");
  btn.textContent = recite ? "📖背题中" : "📖背题";
  btn.classList.toggle("manual", !recite);
  document.body.classList.toggle("reciting", recite);
}
$("reciteBtn").onclick = ()=>{
  recite = !recite;
  try{ localStorage.setItem(LS_RECITE, recite ? "true" : "false"); }catch(e){}
  applyReciteUI();
  if(session && isActive("screen-quiz")) renderQuestion();
};
applyReciteUI();

/* ===================== 出题 ===================== */
function blankHtml(q, idx){
  // 手机别自作主张：不要首字母大写、不要自动改词、不要拼写检查（代码和单词会被改坏）
  const noFix = `autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false"`;
  if(q.vocab) return `<textarea class="blank-input trans-area" data-idx="${idx}" rows="5" placeholder="请在此输入英语翻译…" ${noFix}></textarea><span class="reset-size-btn">⇕ 恢复</span>`;
  return `<span class="blank-input" role="textbox" aria-label="第${idx+1}空" data-idx="${idx}" contenteditable="${EDITABLE}" inputmode="text" ${noFix}></span>`;
}
function blankInputs(){ return [...document.querySelectorAll("#qText .blank-input, #qCode .blank-input")]; }
/* 填空的空＝题干里的一条横线（2026-10-18 用户看对比图选的 B）：以前是单行 <input>，最宽 22 个字，
   长一点的中文/英文就截在框里看不全。换成可编辑的行内 span：随字变长、到行尾自动折行，像纸质卷子。
   补上 value / disabled 两个属性，判分、草稿、测试照旧按输入框的用法读写。 */
const EDITABLE = (()=>{ try{ const d = document.createElement("span"); d.contentEditable = "plaintext-only"; return d.contentEditable==="plaintext-only" ? "plaintext-only" : "true"; }catch(e){ return "true"; } })();
function initBlank(el){
  if(el.tagName!=="SPAN" || "value" in el) return;
  // 空着或只剩空格时挂 is-empty，显示占位横线（:empty 认不出只剩空格的，那样会缩成一小截点不着）
  const sync = ()=>{ el.classList.toggle("is-empty", !el.textContent.trim()); };
  Object.defineProperty(el, "value", { get(){ return el.textContent.replace(/[\r\n]+/g, " "); }, set(v){ el.textContent = v==null ? "" : String(v); sync(); } });
  Object.defineProperty(el, "disabled", {
    get(){ return el.getAttribute("contenteditable")==="false"; },
    set(v){ el.setAttribute("contenteditable", v ? "false" : EDITABLE); el.setAttribute("aria-disabled", v ? "true" : "false"); }
  });
  // 空里不许换行：拖进来的多行文字、拦漏了的回车最后都在这里收成一行（删光后浏览器留的 <br> 也一并清掉）
  el.addEventListener("input", ()=>{
    if(el.querySelector("*") || /[\r\n]/.test(el.textContent)){
      el.textContent = el.innerText.replace(/[\r\n]+/g, " ").replace(/ $/, "");
      if(document.activeElement===el) focusBlank(el);
    }
    sync();
  });
  // 粘贴只要纯文字，多行并成一行
  el.addEventListener("paste", e=>{
    e.preventDefault();
    const t = ((e.clipboardData || window.clipboardData).getData("text") || "").replace(/[\r\n]+/g, " ");
    document.execCommand("insertText", false, t);
  });
  sync();
}
const AUTO_FOCUS = window.matchMedia ? matchMedia("(hover:hover) and (pointer:fine)") : { matches: true };
// 程序聚焦（翻到下一题、回车跳下一空）：光标放在已填内容的末尾，不放开头；下一空在屏幕外/键盘后面时滚过去
function focusBlank(el){
  el.focus();
  if(el.tagName!=="SPAN") return;
  const r = document.createRange(); r.selectNodeContents(el); r.collapse(false);
  const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
}
/* 还没提交的内容也要记下来：以前换一题、滑一下、切个标签，填到一半的十几个空就全没了 */
let draftTimer = null;
function keepDraft(){
  if(!session || session.answers[session.idx]) return;
  const q = currentQ();
  if(q.type==="mcq"){ if(selectedOpt) session.drafts[session.idx] = { opt: selectedOpt }; }
  else {
    const vals = blankInputs().map(i=>i.value);
    if(vals.some(v=>v)) session.drafts[session.idx] = vals; else delete session.drafts[session.idx];
  }
  clearTimeout(draftTimer); draftTimer = setTimeout(saveProgress, 400);
}
function keepDraftNow(){ if(session && isActive("screen-quiz")){ keepDraft(); clearTimeout(draftTimer); saveProgress(); } }
function renderQuestion(){
  clearAutoAdvance();
  if(!session.drafts) session.drafts = {};
  const q = currentQ(), saved = session.answers[session.idx], draft = session.drafts[session.idx];
  selectedOpt = saved && saved.selectedOpt ? saved.selectedOpt : null;
  $("qTag").textContent = q.cat;
  $("prevBtn").disabled = session.idx===0;
  const textEl = $("qText"), codeEl = $("qCode"), body = $("qBody"), box = $("answerBox");
  box.className = "answer-box"; box.innerHTML = "";
  body.innerHTML = "";
  let n = 0;
  // 题干一律先转义再插空位：原题文字里的 <a>、<script> 不能被浏览器当成真标签解析
  if(q.type!=="mcq" && (q.text||"").includes("{{}}")) textEl.innerHTML = esc(q.text).replace(/\{\{\}\}/g, ()=>blankHtml(q, n++));
  else textEl.textContent = q.text || "";
  if(q.code){
    codeEl.hidden = false;
    if(q.type!=="mcq" && q.code.includes("{{}}")) codeEl.innerHTML = esc(q.code).replace(/\{\{\}\}/g, ()=>blankHtml(q, n++));
    else if(CFG.wordlist) codeEl.innerHTML = styleWordlist(q.code.replace(/\{\{\}\}/g,"______"));
    else codeEl.textContent = q.code.replace(/\{\{\}\}/g,"______");
  } else { codeEl.hidden = true; codeEl.textContent = ""; }
  const showOnly = recite && !saved;   // 背题：只看不答

  if(q.type==="mcq"){
    body.innerHTML = `<div class="opt-list">` + Object.keys(q.options).map(L=>
      `<div class="opt-row" data-letter="${esc(L)}"><div class="opt-label">${esc(L)}.</div><div class="opt-text">${esc(q.options[L])}</div></div>`).join("") + `</div>`;
    if(saved){
      markOptions(q, saved.selectedOpt);
      if(!(examMode && saved.allCorrect)) showAnswerBoxMcq(q, saved.allCorrect, saved.selectedOpt);
    } else if(showOnly){
      markOptions(q, null);
      box.className = "answer-box show right";
      box.innerHTML = `<b>答案：</b><span class="correct-ans">${esc(q.correct)}. ${esc(q.options[q.correct])}</span>`;
    } else {
      body.querySelectorAll(".opt-row").forEach(el=>el.addEventListener("click", ()=>pickOption(el.dataset.letter)));
      if(draft && draft.opt && q.options[draft.opt] !== undefined){
        selectedOpt = draft.opt;
        body.querySelectorAll(".opt-row").forEach(o=>o.classList.toggle("selected", o.dataset.letter===selectedOpt));
      }
    }
  } else {
    const inputs = blankInputs();
    inputs.forEach(initBlank);
    if(saved){
      inputs.forEach((inp,i)=>{
        inp.value = (saved.userInputs||[])[i] || "";
        inp.classList.add(saved.assignment && saved.assignment[i]!==-1 ? "correct" : "wrong");
        inp.disabled = true;
      });
      if(!q.vocab) numberBlanks(inputs, saved.assignment, saved.allCorrect);
      showAnswerBoxBlank(q, saved.allCorrect, saved.self, saved.userInputs, saved.assignment);
    } else {
      if(Array.isArray(draft)) inputs.forEach((inp,i)=>{ inp.value = draft[i] || ""; });
      inputs.forEach((inp,i)=>{
        const enter = ()=>{ if(i<inputs.length-1) focusBlank(inputs[i+1]); else if(!recite) submitAnswer(); };
        inp.addEventListener("input", keepDraft);
        inp.addEventListener("keydown", e=>{
          if(e.key!=="Enter" || e.isComposing || e.keyCode===229) return;   // 中文输入法按回车是在选字，不是要提交
          if(inp.tagName==="TEXTAREA" && !(e.ctrlKey||e.metaKey)) return;    // 翻译框里回车是换行；Ctrl/⌘+回车才提交
          e.preventDefault();
          enter();
        });
        // 横线空里的换行：安卓键盘的回车 keydown 是 229 拦不到，要在这里拦，当成回车（跳下一空/交卷）
        if(inp.tagName==="SPAN") inp.addEventListener("beforeinput", e=>{
          if(e.inputType!=="insertParagraph" && e.inputType!=="insertLineBreak") return;
          e.preventDefault();
          if(!e.isComposing) enter();
        });
      });
      if(showOnly){
        box.className = "answer-box show right";
        if(q.vocab) box.innerHTML = `参考译文：<span class="real">${esc(ansText(q))}</span>`;
        else { numberBlanks(inputs, null, true); box.innerHTML = `<div class="ans-head">参考答案</div>` + ansListHtml(q); }
      }
      // 只在电脑上（有鼠标）自动聚焦第一空，方便直接打字。手机上不聚焦：点「下一题」时 iPhone 会把键盘直接弹出来，
      // 题还没看完就让人输入（2026-10-18 用户报）；想填的时候点一下横线就好
      // 滑动翻页时卡片是藏着的，这时也不聚焦；背题时也不抢焦点
      else if(inputs[0] && AUTO_FOCUS.matches && document.querySelector("#screen-quiz .qcard").style.visibility !== "hidden") focusBlank(inputs[0]);
    }
  }
  document.querySelectorAll("#qText .reset-size-btn").forEach(b=>{ b.onclick = ()=>{ b.previousElementSibling.style.height = ""; }; });
  $("checkBtn").hidden = !!saved || showOnly;
  updateNextBtn();
  renderStats();
  saveProgress();
}
function markOptions(q, picked){
  $("qBody").querySelectorAll(".opt-row").forEach(el=>{
    const L = el.dataset.letter;
    el.classList.add("disabled");
    el.classList.toggle("selected", L===picked);
    if(L===q.correct) el.classList.add("opt-correct");
    else if(L===picked) el.classList.add("opt-wrongpick");
  });
}
function pickOption(L){
  if(!session || session.answers[session.idx] || recite) return;
  const q = currentQ();
  selectedOpt = L;
  $("qBody").querySelectorAll(".opt-row").forEach(o=>o.classList.toggle("selected", o.dataset.letter===L));
  if(examMode){
    const right = L===q.correct;
    submitAnswer();
    if(right) scheduleAutoAdvance(session.idx);
  } else keepDraft();
}
function updateNextBtn(){
  const isLast = session.idx === session.queue.length-1, b = $("nextBtn");
  b.textContent = isLast ? "已是最后一题" : "下一题";
  b.disabled = isLast;
}
function showAnswerBoxMcq(q, allCorrect, userOpt){
  const box = $("answerBox");
  box.className = "answer-box show " + (allCorrect ? "right" : "wrong");
  box.innerHTML = `<b>我的答案：</b><span class="my-ans${allCorrect?"":" wrong-color"}">${userOpt ? esc(userOpt) : "未作答"}</span>`
    + `　　<b>正确答案：</b><span class="correct-ans">${esc(q.correct)}. ${esc(q.options[q.correct])}</span>`;
}
function showAnswerBoxBlank(q, allCorrect, self, userInputs, assignment){
  const box = $("answerBox");
  box.className = "answer-box show " + (allCorrect ? "right" : "wrong");
  if(q.vocab){
    if(self){   // 2026-10-14 以前是本人自评，那时的记录照原样显示
      box.innerHTML = (allCorrect ? `✔ 你判定：译对了。` : `✘ 你判定：没译对。`) + ` 参考译文：<span class="real correct-ans">${esc(ansText(q))}</span>`;
    } else if(allCorrect){
      box.innerHTML = `✔ 跟参考译文一致。 参考译文：<span class="real correct-ans">${esc(ansText(q))}</span>`;
    } else {
      const mine = (userInputs||[])[0] || "";
      // 有几种写法时，拿最接近的那种来标
      const ref = transRefs(q).map(r=>({ r, d: transDiff(mine, r) })).sort((x,y)=>y.d.common-x.d.common)[0];
      box.innerHTML = `<div>✘ 跟参考译文不一致${mine.trim() ? "" : "（没有作答）"}</div>`
        + (mine.trim() ? `<div class="trans-line"><b>你的译文：</b>${markWords(mine, ref.d.keepA, "tw-extra")}</div>` : "")
        + `<div class="trans-line"><b>参考译文：</b><span class="real">${markWords(ref.r, ref.d.keepB, "tw-miss")}</span></div>`
        + (mine.trim() ? `<div class="trans-legend"><mark class="tw-extra">红色</mark> 参考译文里没有的词　<mark class="tw-miss">黄底</mark> 你漏掉或写错的词（大小写、标点不算错）</div>` : "");
    }
  } else {
    const n = (q.ans||[]).length, inputs = userInputs || [];
    const right = assignment ? assignment.filter(x=>x!==-1).length : (allCorrect ? n : 0);
    const score = n > 1 && !allCorrect ? `<span class="ans-score">${n} 空对了 ${right} 空</span>` : "";
    box.innerHTML = `<div class="ans-head">${allCorrect ? "✔ 回答正确" : "✘ 回答有误"}${score}</div>`
      + `<div class="ans-cap">参考答案${q.unordered ? "（不分先后）" : ""}</div>` + ansListHtml(q, inputs, assignment, allCorrect);
  }
}
function submitAnswer(){
  if(!session || session.answers[session.idx] || recite) return;   // 已经交过的题不能再交一次（防连点重复记错题）
  const q = currentQ();
  let record;
  if(q.type==="mcq"){
    const allCorrect = selectedOpt===q.correct;
    markOptions(q, selectedOpt);
    if(!(examMode && allCorrect)) showAnswerBoxMcq(q, allCorrect, selectedOpt);
    record = { allCorrect, selectedOpt };
  } else {
    const inputs = blankInputs();
    const userInputs = inputs.map(inp=>inp.value);
    if(inputs.includes(document.activeElement)) document.activeElement.blur();   // 横线空锁住时焦点不会自己走（不像 <input disabled>），先收键盘
    inputs.forEach(inp=>{ inp.disabled = true; });
    const g = gradeQuestion(q, userInputs);
    inputs.forEach((inp,i)=>{ inp.classList.add(g.assignment[i]!==-1 ? "correct" : "wrong"); });
    if(!q.vocab) numberBlanks(inputs, g.assignment, g.allCorrect);
    showAnswerBoxBlank(q, g.allCorrect, false, userInputs, g.assignment);
    record = { allCorrect: g.allCorrect, userInputs, assignment: g.assignment };
  }
  recordAnswer(q, record);
}
function recordAnswer(q, record){
  session.answers[session.idx] = record;
  delete session.drafts[session.idx];
  // 错题本：答错就记一笔；已在错题本里的题要连续答对 3 次才移出，中途错一次清零。
  // 先从存储读最新的那份再改（见 updateWrongbook）
  updateWrongbook(wb=>{
    if(record.allCorrect){
      if(wb[q.id]){
        wb[q.id].correctStreak = num(wb[q.id].correctStreak) + 1;
        if(wb[q.id].correctStreak >= MASTER_STREAK){ delete wb[q.id]; markRemoved([q.id]); }
      }
    } else {
      wb[q.id] = { cat:q.cat, type:q.type, text:q.text||"", code:q.code||"", options:q.options||null, correct:q.correct||null, ans:q.ans||null,
        ordered:!!q.ordered, vocab:q.vocab||null, wrongCount:num((wb[q.id]||{}).wrongCount)+1, correctStreak:0, lastWrongAt:Date.now() };
    }
  });
  markDone(q);
  $("checkBtn").hidden = true;
  updateNextBtn();
  renderStats();
  saveProgress();
}
$("checkBtn").onclick = submitAnswer;
$("prevBtn").onclick = ()=>{ if(session.idx>0){ keepDraft(); session.idx--; renderQuestion(); } };
$("nextBtn").onclick = ()=>{ if(session.idx < session.queue.length-1){ keepDraft(); session.idx++; renderQuestion(); } };
$("quitQuizBtn").onclick = async ()=>{
  const s = sessionStats(), left = s.total - s.answered;
  keepDraft();
  if(await showConfirm(left ? `还有 ${left} 题没答，确定结束本次练习并查看结果吗？` : "确定结束本次练习并查看结果吗？")) finishQuiz();
};

/* ===================== 题目总览 ===================== */
function openOverview(){ $("screen-overview").classList.add("active"); $("ovBackdrop").classList.add("show"); renderOverview(); }   // 先显示再渲染：不可见时滚不到当前题
function closeOverview(){ $("screen-overview").classList.remove("active"); $("ovBackdrop").classList.remove("show"); }
$("overviewLink").onclick = openOverview;
$("ovBackBtn").onclick = closeOverview;
$("ovCloseBtn").onclick = closeOverview;
$("ovBackdrop").onclick = closeOverview;
// 大数字 = 在本次练习里的位置；两种题型都有时，小数字 = 在本题型里是第几题
function renderOverviewGrid(indices, withSub){
  return `<div class="ov-grid">` + indices.map((i,local)=>{
    const a = session.answers[i];
    let cls = ""; if(i===session.idx) cls += " cur"; if(a) cls += a.allCorrect ? " right" : " wrong";
    return `<div class="ov-item${cls}" data-idx="${i}"><span class="ov-num">${i+1}</span>${withSub ? `<span class="ov-sub">·${local+1}</span>` : ""}</div>`;
  }).join("") + `</div>`;
}
function renderOverview(){
  const mcqIdx = [], blankIdx = [];
  session.queue.forEach((q,i)=>(q.type==="mcq" ? mcqIdx : blankIdx).push(i));
  const both = mcqIdx.length>0 && blankIdx.length>0;
  let html = "";
  if(mcqIdx.length) html += `<div class="ov-section-title">${both?"一、":""}单选题（${mcqIdx.length}题）</div>` + renderOverviewGrid(mcqIdx, both);
  if(blankIdx.length) html += `<div class="ov-section-title">${both?"二、":""}填空题（${blankIdx.length}题）</div>` + renderOverviewGrid(blankIdx, both);
  const c = $("ovContent"); c.innerHTML = html;
  c.querySelectorAll(".ov-item").forEach(el=>el.addEventListener("click", ()=>{
    keepDraft(); session.idx = parseInt(el.dataset.idx, 10); closeOverview(); showScreen("quiz"); renderQuestion();
  }));
  const cur = c.querySelector(".ov-item.cur"); if(cur && cur.scrollIntoView) cur.scrollIntoView({block:"center"});
}

/* ===================== 结果页 ===================== */
function finishQuiz(){
  clearAutoAdvance();
  timerPause();
  const s = sessionStats(), durationSec = Math.round(elapsedNow()/1000);
  const rate = pct(s.correct, s.answered);       // 正确率 = 答对 / 已答。旧版除以总题数：答 1 题对 1 题显示 1%
  // 一题没答就结束：不记练习记录（以前会记一条"对0 错0 正确率 –"）
  if(s.answered || session.historyDate){
    const entry = { date: session.historyDate || Date.now(), scope: session.scopeLabel, total: s.total, correct: s.correct, wrong: s.wrong, rate, durationSec };
    // 从结果页「返回本次练习」接着答再结束：更新同一条记录，而不是再记一条
    updateHistory(list=>{
      const at = list.findIndex(h=>h.date===entry.date);
      if(at>=0) list[at] = entry; else { list.push(entry); list.sort((a,b)=>num(b.date)-num(a.date)); }
    });
    session.historyDate = entry.date;
  }
  session.finished = true;
  if(!someoneElseIsNewer()) clearProgress();
  $("resTotal").textContent = s.total;
  $("resAnswered").textContent = s.answered;
  $("resUnanswered").textContent = s.total - s.answered;
  $("resCorrect").textContent = s.correct;
  $("resWrong").textContent = s.wrong;
  $("resRate").textContent = s.answered ? rate+"%" : "–";
  $("resTime").textContent = fmtTime(durationSec);
  showScreen("result");
}
$("backToQuizBtn").onclick = ()=>{ session.finished = false; session.savedAt = Date.now(); showScreen("quiz"); renderQuestion(); };
$("retryAllBtn").onclick = ()=>startQuiz(session.queue, session.scopeLabel, false);
$("retryWrongBtn").onclick = ()=>{
  const list = session.queue.filter((q,i)=>session.answers[i] && !session.answers[i].allCorrect);
  if(!list.length){ showAlert("本次没有错题，太棒了！"); return; }
  startQuiz(list, "本次错题重练", false);
};
$("backHomeBtn").onclick = ()=>{ renderCatList(); showScreen("home"); };

function renderResultList(wantCorrect){
  $("resultListTitle").textContent = wantCorrect ? "答对的题目" : "答错的题目";
  const items = [];
  session.queue.forEach((q,i)=>{ const a = session.answers[i]; if(a && a.allCorrect===wantCorrect) items.push({q,a}); });
  const body = $("resultListBody");
  if(!items.length){ body.innerHTML = `<div class="empty">没有符合条件的题目</div>`; return; }
  body.innerHTML = items.map(({q,a})=>{
    let yours;
    if(q.type==="mcq") yours = a.selectedOpt ? `${a.selectedOpt}. ${q.options[a.selectedOpt]}` : "未作答";
    else yours = (a.userInputs||[]).map(v=>v.trim() ? v : "（未填）").join("、");
    return `<div class="review-item">
      <div class="qtext">${esc(plainText(q))}</div>
      <div class="your-ans" style="color:${a.allCorrect?"var(--green)":"var(--red)"}">你的答案：${esc(yours)}</div>
      <div class="correct-ans-line">${q.vocab?"参考译文":"正确答案"}：${esc(ansText(q, "、"))}</div>
    </div>`;
  }).join("");
}
$("resCorrectBox").onclick = ()=>{ renderResultList(true); showScreen("resultlist"); };
$("resWrongBox").onclick = ()=>{ renderResultList(false); showScreen("resultlist"); };
$("resultListBackBtn").onclick = ()=>showScreen("result");

/* ===================== 错题本 ===================== */
let wbFilter = "";   // 只看某一章的错题；空 = 全部
function renderWrongbook(){
  const all = Object.entries(wrongbook).map(([id,w])=>({id, ...w}));
  const summary = $("wrongbookSummary"), list = $("wrongbookList");
  if(!all.length){ summary.innerHTML = `<div class="empty">暂无错题，继续保持！</div>`; list.hidden = true; list.innerHTML = ""; return; }
  const cats = [...new Set(all.map(it=>it.cat))];
  if(!cats.includes(wbFilter)) wbFilter = "";
  const items = wbFilter ? all.filter(it=>it.cat===wbFilter) : all;
  list.hidden = false;
  summary.innerHTML = `
    <div style="margin-bottom:10px;">共 <b>${all.length}</b> 道错题${wbFilter ? `，当前只看「${esc(wbFilter)}」的 <b>${items.length}</b> 道` : ""}</div>
    ${cats.length>1 ? `<select class="wb-filter" id="wbFilterSel" aria-label="按${esc(CFG.catWord)}筛选错题"><option value="">全部${esc(CFG.catWord)}（${all.length}）</option>${cats.map(c=>`<option value="${esc(c)}"${c===wbFilter?" selected":""}>${esc(c)}（${all.filter(it=>it.cat===c).length}）</option>`).join("")}</select>` : ""}
    <div class="btn-row">
      <button class="btn" id="practiceWrongBtn">${wbFilter ? "练习这些错题" : "练习全部错题"}</button>
      <button class="btn gray" id="clearWrongbookBtn">清空错题本</button>
    </div>`;
  if($("wbFilterSel")) $("wbFilterSel").onchange = e=>{ wbFilter = e.target.value; renderWrongbook(); };
  $("practiceWrongBtn").onclick = ()=>{
    const pool = items.map(it=>QBYID[it.id]).filter(Boolean);
    if(!pool.length){ showAlert("这些错题在当前题库里都找不到了（题库可能更新过），没法练习。"); return; }
    startQuiz(pool, wbFilter ? `错题本练习（${wbFilter}）` : "错题本练习", true);
  };
  $("clearWrongbookBtn").onclick = async ()=>{
    if(await showConfirm("确定清空错题本吗？所有错题记录都会被清除，此操作不可恢复。")){
      markRemoved(Object.keys(cleanWrongbook(loadJSON(LS_WRONGBOOK, {})))); wrongbook = {}; saveJSON(LS_WRONGBOOK, wrongbook); wbFilter = ""; renderWrongbook();
    }
  };
  items.sort((a,b)=>num(b.lastWrongAt)-num(a.lastWrongAt));
  list.innerHTML = items.map(it=>{
    const streak = num(it.correctStreak);
    return `<div class="wrong-item">
      <div class="top"><span>${esc(it.cat)}</span><span>错${num(it.wrongCount)||1}次 · ${it.lastWrongAt ? fmtDate(num(it.lastWrongAt)) : ""}</span></div>
      <div class="qtext">${esc(plainText(it))}</div>
      <div class="ans">${it.vocab?"参考译文":"答案"}：${esc(ansText(it))}</div>
      <div class="note">已连续答对 ${streak}/${MASTER_STREAK} 次${streak>0 ? `，再连续答对${MASTER_STREAK-streak}次将自动从错题本移除` : ""}<button class="wb-remove" data-id="${esc(it.id)}">移出错题本</button></div>
    </div>`;
  }).join("");
  list.querySelectorAll(".wb-remove").forEach(b=>{ b.onclick = async ()=>{
    if(!await showConfirm("把这道题移出错题本吗？")) return;
    updateWrongbook(wb=>{ delete wb[b.dataset.id]; }); markRemoved([b.dataset.id]); renderWrongbook();
  }; });
}

/* ===================== 练习记录 ===================== */
function renderHistory(){
  const list = $("historyList");
  if(!historyList.length){ list.innerHTML = `<div class="empty">还没有练习记录，快去开始第一次练习吧～</div>`; return; }
  list.innerHTML = historyList.map(h=>{
    const correct = num(h.correct), wrong = num(h.wrong), answered = correct + wrong;   // 老记录存的 rate 是"答对/总题数"，这里统一按已答重算
    return `<div class="history-item">
      <div class="top"><span>${fmtDate(num(h.date))}</span><span>用时 ${fmtTime(num(h.durationSec))}</span></div>
      <div>${esc(h.scope)} · 共${num(h.total)}题 · 对<b style="color:var(--green)">${correct}</b> 错<b style="color:var(--red)">${wrong}</b> · 正确率 <b>${answered ? pct(correct, answered)+"%" : "–"}</b></div>
    </div>`;
  }).join("");
}
$("clearHistoryBtn").onclick = async ()=>{
  if(await showConfirm("确定清空所有练习记录吗？此操作不可恢复。")){ historyList = []; saveJSON(LS_HISTORY, historyList); renderHistory(); }
};

/* ===================== 键盘快捷键（电脑上用）：A-D/1-4 选项，回车提交/下一题，←→ 切题，Esc 关总览 ===================== */
document.addEventListener("keydown", e=>{
  // 弹窗开着：Esc = 取消，回车 = 确定；别的键一律不往下传（以前回车会再点一次弹窗背后的那个按钮）
  if(hasShow("confirmBackdrop")){
    if((e.key==="Enter" || e.key===" ") && e.target.closest && e.target.closest(".confirm-box button")) return;   // 焦点在「取消」上按回车就是取消
    if(e.key==="Escape"){ ($("confirmCancelBtn").hidden ? $("confirmOkBtn") : $("confirmCancelBtn")).click(); e.preventDefault(); }
    else if(e.key==="Enter"){ $("confirmOkBtn").click(); e.preventDefault(); }
    return;
  }
  const t = e.target, onBtn = t.closest && t.closest("button, a, [role=button]");
  // 文字做的按钮（题目总览、全选……）用 Tab 走到以后，回车/空格 = 点它
  if(onBtn && onBtn.getAttribute("role")==="button" && (e.key==="Enter" || e.key===" ")){ onBtn.click(); e.preventDefault(); return; }
  if(e.key==="Escape" && isActive("screen-overview")){ closeOverview(); return; }
  if(!session || !isActive("screen-quiz") || isActive("screen-overview")) return;
  // 填空的空是可编辑的 span（2026-10-18 起）：在空里打字时回车、←→ 归输入，不当快捷键
  if(e.ctrlKey || e.metaKey || e.altKey || (t.closest && t.closest("input, textarea, select, [contenteditable]:not([contenteditable='false'])"))) return;
  // 焦点停在某个按钮上时，回车/空格归那个按钮自己；其余快捷键照常（以前鼠标点过「下一题」后字母键和方向键全部失灵）
  if(onBtn && (e.key==="Enter" || e.key===" ")) return;
  const q = currentQ(), answered = !!session.answers[session.idx];
  const k = e.key.length===1 ? e.key.toUpperCase() : e.key;
  if(q.type==="mcq" && !answered){
    const letters = Object.keys(q.options);
    const L = /^[1-9]$/.test(k) ? letters[+k-1] : (letters.includes(k) ? k : null);
    if(L){ pickOption(L); e.preventDefault(); return; }
  }
  if(k==="Enter"){ if(!answered && !recite) submitAnswer(); else $("nextBtn").click(); e.preventDefault(); }
  else if(k==="ArrowRight"){ $("nextBtn").click(); e.preventDefault(); }
  else if(k==="ArrowLeft"){ $("prevBtn").click(); e.preventDefault(); }
});

/* ===================== 初始化 ===================== */
renderCatList();

/* ===================== 下拉刷新 ===================== */
/* 配方：起手死区防误触 → 出死区后方向一锤定音 → 阈值按屏高推导（小屏上手指行程占比才不会偏重） */
function setupPullToRefresh(){
  const el = $("ptrIndicator"); if(!el) return;
  const DEADZONE = 16;    // 起手死区：按下瞬间手指会抖，这几像素不算下拉
  const DAMPING  = 0.42;  // 阻尼系数：手指位移 × 它 = 指示器位移
  const MAX_PULL = 120;   // 再往下拉指示器也不动了
  const threshold = ()=>Math.min(100, Math.max(56, window.innerHeight * 0.1));
  let startX=0, startY=0, pulling=false, locked=false, distance=0, refreshing=false, tipTimer=null, unlockTimer=null;
  // 有浮层、或正在答题时都不接管手势（以后每加一个浮层，都要回来这里补一条）
  function blocked(){
    if(isActive("screen-quiz")) return true;         // 答题中：刷新会把人踢回首页，还没提交的输入会丢
    if(isActive("screen-overview")) return true;     // 题目总览抽屉自己要能滚
    if(hasShow("ovBackdrop")) return true;
    if(hasShow("confirmBackdrop")) return true;
    return false;
  }
  function paint(d){
    distance = d; el.classList.remove("ptr-animate");
    el.style.transform = "translateY("+d+"px)";
    el.style.opacity = Math.min(1, d/(threshold()*0.8));
    el.classList.toggle("ptr-ready", d >= threshold());
  }
  function reset(animate){
    distance = 0; el.classList.toggle("ptr-animate", !!animate);
    el.style.transform = "translateY(0)"; el.style.opacity = "0";
    el.classList.remove("ptr-ready","ptr-loading");
  }
  function showTip(msg){
    const tip = $("ptrTip"); if(!tip) return;
    tip.textContent = msg; tip.classList.add("show");
    clearTimeout(tipTimer); tipTimer = setTimeout(()=>tip.classList.remove("show"), 1800);
  }
  function doRefresh(){
    // 页面没有 Service Worker：断网时 location.reload() 会变成浏览器错误页，改成重读本地数据 + 重绘
    if(navigator.onLine === false){
      refreshFromStorage();
      showTip("当前没有网络，已重新载入本地数据"); reset(true); refreshing = false; return;
    }
    try{ sessionStorage.setItem("ptr-fired", String(Date.now())); }catch(err){}
    // GitHub Pages 给 css/js 缓存 10 分钟，直接 reload 只会重新校验 HTML，拿到的还是旧样式/旧脚本。
    // 先把同源的样式表和脚本强制校验一遍再刷新（下拉刷新配方 v1.7）
    const urls = [...document.querySelectorAll('link[rel="stylesheet"][href],script[src]')]
      .map(n=>n.href||n.src).filter(u=>{ try{ return new URL(u).origin===location.origin; }catch(e){ return false; } });
    let gone = false; const go = ()=>{ if(!gone){ gone = true; location.reload(); } };
    setTimeout(go, 2500);
    Promise.all(urls.map(u=>fetch(u, {cache:"no-cache"}).catch(()=>{}))).then(go);
  }
  document.addEventListener("touchstart", e=>{
    if(refreshing || blocked() || e.touches.length!==1 || window.scrollY>0){ pulling = false; return; }
    startX = e.touches[0].clientX; startY = e.touches[0].clientY; pulling = true; locked = false;
  }, {passive:true});
  document.addEventListener("touchmove", e=>{
    // 刷新中锁住滚动：iOS Safari 发起重新加载后、新页面画出来之前会冻结绘制，
    // 这时还能滑，滑出来的区域是一片空白（下拉刷新配方 v1.8）
    if(refreshing){ e.preventDefault(); return; }
    if(!pulling) return;
    const dx = e.touches[0].clientX-startX, dy = e.touches[0].clientY-startY;
    if(!locked){
      if(Math.abs(dy)<DEADZONE && Math.abs(dx)<DEADZONE) return;              // 还在死区，继续观察
      if(dy<=0 || Math.abs(dx)>Math.abs(dy)){ pulling = false; return; }      // 上滑/横滑，这一次整个弃权
      locked = true;
    }
    // 下拉到一半改主意往上滑：把控制权交还给页面，否则页面会卡住不动
    if(dy<=0 || window.scrollY>0){ pulling = false; locked = false; reset(true); return; }
    paint(Math.min((dy-DEADZONE)*DAMPING, MAX_PULL));
    e.preventDefault();
  }, {passive:false});
  document.addEventListener("touchend", ()=>{
    if(!pulling || !locked || refreshing){ pulling = false; locked = false; return; }
    pulling = false; locked = false;
    if(distance < threshold()){ reset(true); return; }
    refreshing = true;
    el.classList.add("ptr-animate","ptr-loading");
    el.style.transform = "translateY("+threshold()+"px)";
    setTimeout(doRefresh, 260);   // 留一下 spinner 再动手，否则直接白屏像卡死
    // 兜底：重新加载被取消或一直卡着时，10 秒后解锁，别让页面永远滑不动
    clearTimeout(unlockTimer);
    unlockTimer = setTimeout(()=>{ if(refreshing){ refreshing = false; reset(true); } }, 10000);
  }, {passive:true});
  // 触摸被系统打断（来电、系统手势）：收回指示器、不触发刷新（旧版没处理，指示器会停在半空）
  document.addEventListener("touchcancel", ()=>{ if(pulling && !refreshing){ pulling = false; locked = false; reset(true); } }, {passive:true});
}
setupPullToRefresh();

/* ===================== 左右滑动切题 ===================== */
/* 手指往左划 = 下一题，往右划 = 上一题。
   手感沿用《学期课表》日期面板那套验证过的物理（Apple《Designing Fluid Interfaces》WWDC18 session 803）：
   ① 拖动时同步写 transform，1:1 跟手（不经 requestAnimationFrame，排队到下一帧就慢半拍）；到头用 iOS 橡皮筋
   ② 松手用"动量投影"决定翻不翻：位置 + 速度×499 过了半张卡就翻（快甩短距离也翻，慢拖要过半）
   ③ 落位动画继承松手那一刻的速度：弹簧曲线采成关键帧交给 Web Animations 播，留在合成器上
   ④ 动画随时可被抓住：新手势从卡片此刻的真实位置接着走，绝不吞掉
   翻页时把旧题克隆成一张"快照"顺着手势滑走，新题紧跟在它后面进来，看上去是一整条轨道。
   不在拖动途中预渲染下一题：那要调用 renderQuestion，会冲掉当前题还没提交的选择和输入。
   翻页调用「上一题/下一题」按钮自己的 onclick，行为与点按钮完全一致。 */
function setupSwipeNav(){
  const screen = $("screen-quiz");
  const card = screen && screen.querySelector(".qcard");
  if(!card) return;
  const LOCK_DIST2 = 25;     // 动够 5px（这里是平方）才判方向——Swiper 的 threshold
  const TOUCH_ANGLE = 45;    // 与水平方向夹角 ≤45° 才算横滑——Swiper 的 touchAngle
  const EDGE = 28;           // 屏幕左右边缘留给浏览器的前进/返回手势
  const LONGPRESS = 500;     // 按住这么久才开始动 = 想选文字
  const PROJECT = 0.998 / (1 - 0.998);   // UIScrollView 默认减速率 0.998 → 速度(px/ms) × 499 = 惯性还能走多远
  const GAP = 16;            // 旧题快照和新题之间的缝
  const SPRING_RESPONSE = 0.4, SPRING_DAMPING = 0.86;   // SwiftUI .snappy 那一档
  const SPRING_HZ = 240;     // 关键帧采样率
  const SPRING_MAX_MS = 620, MAX_OVERSHOOT = 14;        // 过冲按像素封顶，不按比例
  const reduceMQ = window.matchMedia ? matchMedia("(prefers-reduced-motion: reduce)") : null;
  // 快照要叠在卡片原位上，得有个定位参照；卡片滑出屏幕时也不能撑出横向滚动条
  if(getComputedStyle(screen).position === "static") screen.style.position = "relative";
  const app = document.querySelector(".app"); if(app) app.style.overflowX = "clip";
  let cardX = 0, liveAnim = null, pending = false;
  let tracking = false, locked = false, startX = 0, startY = 0, startT = 0;
  let hsFrom = null;   // 这一下是从代码框这类横向滚动区域起手的：只归它滚，不翻页
  let baseX = 0, pos = 0, W = 1, lastX = 0, lastT = 0, vel = 0, guardUntil = 0;
  // 以后每加一个浮层，都要回来这里补一条（和下拉刷新的 blocked() 同理）
  function blocked(){
    if(!isActive("screen-quiz")) return true;
    if(isActive("screen-overview") || hasShow("ovBackdrop")) return true;
    if(hasShow("confirmBackdrop")) return true;
    return false;
  }
  function canGo(d){ return d>0 ? session.idx < session.queue.length-1 : session.idx > 0; }
  // 手指下面有能横向滚、而且这个方向还没滚到头的区域（长代码行等）→ 让它自己滚
  function inHScroller(target){
    for(let n = target; n && n !== card; n = n.parentElement){
      if(n.scrollWidth <= n.clientWidth+1) continue;
      const ox = getComputedStyle(n).overflowX;
      if(ox==="auto" || ox==="scroll") return true;
    }
    return false;
  }
  function scrollerWants(target, d){
    for(let n = target; n && n !== card; n = n.parentElement){
      if(n.scrollWidth <= n.clientWidth+1) continue;
      const ox = getComputedStyle(n).overflowX;
      if(ox!=="auto" && ox!=="scroll") continue;
      if(d>0 && n.scrollLeft+n.clientWidth < n.scrollWidth-1) return true;
      if(d<0 && n.scrollLeft > 1) return true;
    }
    return false;
  }
  const reduced = ()=>!!(reduceMQ && reduceMQ.matches);
  const isHorizontal = (dx,dy)=>Math.atan2(Math.abs(dy),Math.abs(dx))*180/Math.PI <= TOUCH_ANGLE;
  // iOS 橡皮筋：b = (1 - 1/(x·c/d + 1))·d，c = 0.55。越拉越紧，而不是一上手就打固定折扣
  function rubber(off, dim){ const x = Math.abs(off), b = (1 - 1/((x*0.55/dim)+1))*dim; return off<0 ? -b : b; }
  function setX(el, px){ el.style.transform = px ? "translate3d("+px+"px,0,0)" : ""; }
  function liveX(){ return liveAnim ? new DOMMatrixReadOnly(getComputedStyle(card).transform).m41 : cardX; }
  // 带初速度的弹簧，采样成 0→1 的进度序列。distance = 起点 − 终点（px），velocity = 松手速度（px/ms）
  function springPts(distance, velocity){
    const w0 = 2*Math.PI/SPRING_RESPONSE, z = SPRING_DAMPING, wd = w0*Math.sqrt(1-z*z), step = 1/SPRING_HZ;
    const sample = v0=>{
      const B = (v0 + z*w0)/wd, out = [];
      for(let i=0;;i++){
        const t = i*step; if(t >= SPRING_MAX_MS/1000) break;
        const u = Math.exp(-z*w0*t)*(Math.cos(wd*t) + B*Math.sin(wd*t));
        out.push(1-u); if(t>0.1 && Math.abs(u)<0.002) break;
      }
      return out;
    };
    const over = a=>(Math.max.apply(null,a)-1)*Math.abs(distance);
    const v0 = distance ? (velocity*1000)/distance : 0;
    let pts = sample(v0);
    if(over(pts) > MAX_OVERSHOOT){           // 0 速度一定不过冲，二分找一个刚好不超的初速度
      let lo = 0, hi = v0;
      for(let i=0;i<8;i++){ const mid = (lo+hi)/2, c = sample(mid); if(over(c) > MAX_OVERSHOOT) hi = mid; else { lo = mid; pts = c; } }
    }
    pts[pts.length-1] = 1;                   // 最后一点钉死，保证精确落位
    return { ms: Math.round(Math.max(120, (pts.length-1)*step*1000)), pts };
  }
  // 用 Web Animations 逐关键帧播（每段普通 linear）：带点的 CSS linear() 会让 Safari 把动画踢回主线程
  function animateX(el, from, to, sp, done){
    setX(el, to);
    if(!el.animate){                         // 老浏览器：退回 CSS 过渡
      el.style.transition = "transform "+sp.ms+"ms cubic-bezier(.05,.7,.1,1)";
      const t = setTimeout(()=>{ el.style.transition = ""; if(done) done(); }, sp.ms+20);
      return { cancel(){ clearTimeout(t); el.style.transition = ""; } };
    }
    const a = el.animate(sp.pts.map((p,i)=>({ offset: i/(sp.pts.length-1), transform: "translate3d("+(from+(to-from)*p)+"px,0,0)" })),
      { duration: sp.ms, easing: "linear", fill: "both" });
    a.onfinish = ()=>{ a.cancel(); if(done) done(); };
    return a;
  }
  // 把卡片正在跑的动画就地停住，停在当前视觉位置（Apple：动画要从屏幕上的真实位置接着走）
  function stopLive(){
    if(!liveAnim) return cardX;
    const x = liveX(); liveAnim.cancel(); liveAnim = null; cardX = x; setX(card, x);
    return x;
  }
  function tidy(){ if(!liveAnim && !locked) card.style.willChange = ""; }
  function settleLive(from, v){
    stopLive(); cardX = 0;
    if(reduced() || !from){ setX(card, 0); tidy(); return; }
    card.style.willChange = "transform";
    liveAnim = animateX(card, from, 0, springPts(from, v), ()=>{ liveAnim = null; tidy(); });
  }
  // 旧题快照：克隆当前卡片，叠在原位，去掉 id（不能有重复 id）和交互
  function makeGhost(){
    const g = card.cloneNode(true);
    const src = card.querySelectorAll("input,textarea,select"), dst = g.querySelectorAll("input,textarea,select");
    src.forEach((el,i)=>{ if(dst[i]) dst[i].value = el.value; });   // 敲的字是 value 属性，克隆带不过去
    g.removeAttribute("id"); g.querySelectorAll("[id]").forEach(el=>el.removeAttribute("id"));
    g.classList.remove("qcard");                                    // 别让 querySelector(".qcard") 找到它
    g.setAttribute("aria-hidden","true"); g.inert = true;
    Object.assign(g.style, { position:"absolute", margin:"0", boxSizing:"border-box", pointerEvents:"none",
      left: card.offsetLeft+"px", top: card.offsetTop+"px", width: card.offsetWidth+"px", willChange:"transform" });
    card.parentNode.insertBefore(g, card.nextSibling);
    return g;
  }
  // 松手这一帧只做轻活（拍快照、让旧题带着手指速度滑走），下一帧再换题；新题动画和快照钉在同一个时钟上。
  // 先放后换：要是先换题再起动画，手指一抬卡片会先顿一下，速度交接就断了
  function commit(d, from, v){
    const w = card.offsetWidth + GAP, btn = $(d>0 ? "nextBtn" : "prevBtn");
    if(reduced()){ cardX = 0; setX(card, 0); tidy(); btn.onclick(); return; }
    const sp = springPts(from + d*w, v);     // 旧题和新题同一条弹簧、同一个起速
    const ghost = makeGhost(), t0 = performance.now();
    const ga = animateX(ghost, from, -d*w, sp, ()=>ghost.remove());
    // 卡片本体此刻还显示着旧题：先藏起来挪到快照后面，换好题再现身（藏着的输入框不会被自动聚焦，不误弹键盘）
    card.style.visibility = "hidden";
    cardX = 0; setX(card, from + d*w);
    pending = true;
    const swap = ()=>{
      pending = false;
      try{ btn.onclick(); } finally { card.style.visibility = ""; }
      card.style.willChange = "transform";
      liveAnim = animateX(card, from + d*w, 0, sp, ()=>{ liveAnim = null; tidy(); });
      const la = liveAnim;
      if(la.currentTime !== undefined) la.currentTime = Math.min(sp.ms, performance.now()-t0);
      if(ga.ready) ga.ready.then(()=>{ if(liveAnim===la && ga.startTime!=null) la.startTime = ga.startTime; });
    };
    // 等"这一帧画完、快照动画已经交给合成器"再换题：光用 rAF 会插在快照开动之前；rAF 里再套 setTimeout(0) 两边都稳
    requestAnimationFrame(()=>setTimeout(swap, 0));
  }
  let editingField = null, pointerField = null, pointerAt = 0;
  const FIELD_SEL = "input, textarea, select, [contenteditable]:not([contenteditable='false'])";
  // 时间从抬手算：焦点是松手那一下给的，按得久一点也不能被当成程序自动聚焦
  // 已经被自动聚焦的框再点一下不会有 focusin（iPhone 上这一下才弹键盘），所以轻点（手指没怎么动）已聚焦的框也算
  // pointerTap 每次按下先清掉：在框里拖动时浏览器会接管，只发 pointercancel 不发 pointerup，不清的话会沿用上一次轻点
  let px = 0, py = 0, pointerTap = false;
  document.addEventListener("pointerdown", e=>{ pointerField = e.target.closest ? e.target.closest(FIELD_SEL) : null; pointerAt = Date.now(); px = e.clientX; py = e.clientY; pointerTap = false; }, true);
  document.addEventListener("pointerup", e=>{
    pointerAt = Date.now();
    pointerTap = Math.abs(e.clientX-px) < 10 && Math.abs(e.clientY-py) < 10;
    if(pointerTap && pointerField && pointerField === document.activeElement) editingField = pointerField;
  }, true);
  document.addEventListener("focusin", e=>{ editingField = (pointerTap && e.target === pointerField && Date.now()-pointerAt < 1500) ? e.target : null; }, true);
  document.addEventListener("input", e=>{ if(e.target === document.activeElement) editingField = e.target; }, true);
  document.addEventListener("focusout", e=>{ if(e.target === editingField) editingField = null; }, true);
  screen.addEventListener("touchstart", e=>{
    tracking = false; locked = false; hsFrom = null;
    if(pending || blocked() || e.touches.length!==1) return;
    const t = e.touches[0];
    if(t.clientX < EDGE || t.clientX > document.documentElement.clientWidth-EDGE) return;
    // 正在输入的框里起手是想挪光标/选字，不翻页；框没在编辑（没聚焦，或交卷后锁住了）就照常翻页——
    // 以前只要从输入框起手一律不翻，翻译题的大文本框占了卡片一大块，那块怎么滑都没反应（2026-10-15 用户报）
    // 「在编辑」要看是不是本人点进去的/打过字：用「下一题」翻过来时程序会自动聚焦第一个框，iPhone 上不弹键盘，那不算
    const field = e.target.closest(FIELD_SEL);
    if(field && field === editingField && field === document.activeElement && !field.disabled) return;
    // 从能横着滚的区域（代码框）起手：这一下整个归它滚，滚到头也不翻页。以前滚到头再划就翻题，
    // 看长代码时左右来回滑，误翻的频率非常高（2026-10-18 用户报）。想翻页从代码框外面划，或点按钮
    if(inHScroller(e.target)){ hsFrom = e.target; startX = t.clientX; startY = t.clientY; return; }
    baseX = stopLive();                       // 动画半路被抓住：就地停住，从这儿接着拖
    pos = baseX;
    startX = lastX = t.clientX; startY = t.clientY;
    startT = lastT = e.timeStamp || Date.now();
    vel = 0; W = card.offsetWidth + GAP; tracking = true;
  }, {passive:true});
  screen.addEventListener("touchmove", e=>{
    // 代码框已经滚到头、还往外划：拦下来。不拦的话浏览器会拿去当「返回上一页」（Chrome 实测整页退回去了）或带着整页晃
    if(hsFrom){
      const t = e.touches[0], mx = t.clientX-startX, my = t.clientY-startY;
      if(e.cancelable && e.touches.length===1 && Math.abs(mx)>Math.abs(my) && !scrollerWants(hsFrom, mx<0 ? 1 : -1)) e.preventDefault();
      return;
    }
    if(!tracking) return;
    if(e.touches.length!==1){ tracking = false; locked = false; settleLive(liveX(), 0); return; }
    const t = e.touches[0], mx = t.clientX-startX, my = t.clientY-startY;
    if(!locked){
      if(mx*mx + my*my < LOCK_DIST2){
        // 死区里就要拦：iOS 一旦开始自己处理这次触摸，后面的 touchmove 就拦不住了
        // 但代码框这类自己能横着滚的区域不拦，否则手指慢慢拖时代码框根本滚不动（2026-10-18 代码题改成不折行后）
        if(Math.abs(mx)>Math.abs(my) && e.cancelable && !scrollerWants(e.target, mx<0 ? 1 : -1)) e.preventDefault();
        return;
      }
      const now0 = e.timeStamp || Date.now();
      if(!isHorizontal(mx,my) || now0-startT > LONGPRESS || scrollerWants(e.target, mx<0 ? 1 : -1)){
        tracking = false;                     // 竖划/选文字/让内容自己滚：整次交出去
        if(cardX) settleLive(cardX, 0);       // 如果是从半路抓住的，别把卡片晾在半路
        return;
      }
      locked = true; card.style.willChange = "transform";
      clearAutoAdvance();
    }
    if(e.cancelable) e.preventDefault();
    // 速度只看最近一小段并做平滑：整段平均会被"先慢后甩"拉低，单点又太抖
    const now = e.timeStamp || Date.now(), dt = now-lastT;
    if(dt>0){ vel = vel*0.4 + ((t.clientX-lastX)/dt)*0.6; lastX = t.clientX; lastT = now; }
    let p = baseX + mx;
    if(p<0 && !canGo(1)) p = rubber(p, W);
    else if(p>0 && !canGo(-1)) p = rubber(p, W);
    pos = p; cardX = p; setX(card, p);        // 同步写，不排队到下一帧
  }, {passive:false});
  function end(e){
    if(!tracking) return;
    tracking = false;
    if(!locked){ if(cardX) settleLive(cardX, 0); return; }   // 半路抓住后只是轻点了一下：回到原位
    locked = false;
    guardUntil = Date.now() + 350;
    const now = (e && e.timeStamp) || Date.now();
    if(now-lastT > 100) vel = 0;              // 停住再松手不算甩
    if(e && e.type==="touchcancel"){ settleLive(pos, 0); return; }   // 被系统打断（来电、手势）只回位
    const projected = pos + vel*PROJECT, d = projected<0 ? 1 : -1;
    if(canGo(d) && Math.abs(projected) > W/2) commit(d, pos, vel);   // 最后一题往左划只回弹，交卷必须走按钮
    else settleLive(pos, vel);
  }
  screen.addEventListener("touchend", end, {passive:true});
  screen.addEventListener("touchcancel", end, {passive:true});
  // 滑完之后浏览器可能补发一次 click：只吞卡片里的、350ms 自己过期，别误伤下一次真点击
  card.addEventListener("click", e=>{ if(Date.now() < guardUntil){ e.stopPropagation(); e.preventDefault(); } }, true);
}
setupSwipeNav();

/* 给自动化测试留的口子（页面逻辑不依赖它） */
window.__quiz = {
  get session(){ return session; }, set session(v){ session = v; },
  renderQuestion, finishQuiz, showScreen, openOverview, closeOverview, startQuiz, submitAnswer, pickOption,
  isCorrect, gradeBlanksSet, gradeOrdered, gradeQuestion, normalize, fp, elapsedNow, refreshFromStorage,
  get wrongbook(){ return wrongbook; }, get history(){ return historyList; }, CFG
};

/* 离线也能刷：注册一个只做"断网时用上次存下来的页面"的缓存（见仓库根目录 sw.js） */
if("serviceWorker" in navigator && /^https?:$/.test(location.protocol)){
  window.addEventListener("load", ()=>{ navigator.serviceWorker.register("../sw.js").catch(()=>{}); });
}
})();
