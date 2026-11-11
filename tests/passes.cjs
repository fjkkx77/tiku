// 刷完几遍（2026-11-11 用户要的）：完整刷完一个分类（一天 / 一个 DAY）记一遍，快捷入口卡片和开始练习页上显示。
//   tests/run.cjs 会调它；单独跑不了（要 run.cjs 起的静态服务器）。多设备同步那几条在 tests/sync.cjs。
const { open, sleep } = require('./cdp.cjs');

async function runPasses(BASE, ok) {
  const p = await open(390, 844, 1);
  try {
    /* ---------- 1. 算法本身（assets/passes.js） ---------- */
    await p.goto(BASE + 'lijing-daily-vocab/'); await p.ev('localStorage.clear()'); await p.goto(BASE + 'lijing-daily-vocab/');
    let r = await p.ev(`(()=>{const P=TikuPasses,S={"A":3,"B":2,"甲、乙":2};
      const q=[{id:"a1",cat:"A"},{id:"a2",cat:"A"},{id:"a3",cat:"A"},{id:"b1",cat:"B"},{id:"b2",cat:"B"}];
      const all=i=>true;
      const H=(scope,total,c,w,date)=>({date:date||1000,scope,total,correct:c,wrong:w});
      return {
        full:P.fullCats(q,all,S).sort().join(),
        partB:P.fullCats(q,i=>i!==4,S).join(),                                   // B 少答一题
        dup:P.fullCats([q[0],q[0],q[1]],all,S).join(),                           // 同一题出现两次不能凑数
        h1:P.fromHistory([H("A",3,2,1)],S,"全部日期").join(),                     // 一个分类、全答了（错的也算）
        h2:P.fromHistory([H("A、B",5,5,0)],S,null).join(),                        // 两个分类一起
        h3:P.fromHistory([H("全部日期",7,7,0)],S,"全部日期").sort().join(),        // 全选
        h3home:P.fromHistory([H("全部日期",7,7,0)],S,/^全部/).sort().join(),        // 首页：不知道叫法，按「全部」开头认
        early1:P.fromHistory([H("全部日期",3,3,0)],S,"全部日期").join(),             // 当时只有 A 一个分类（11-12 用户报的）
        early2:P.fromHistory([H("全部DAY",5,4,1)],S,/^全部/).join(),                // 当时只有 A、B
        early3:P.fromHistory([H("全部日期",4,4,0)],S,"全部日期").join(),             // 前几个凑不出 4：不认
        h4:P.fromHistory([H("A（没做过的）",3,3,0)],S,null).join(),                // 只练没做过的、正好是整个分类
        no1:P.fromHistory([H("A（没做过的）",2,2,0)],S,null).join(),               // 只练没做过的、只剩 2 题
        no2:P.fromHistory([H("A",3,2,0)],S,null).join(),                          // 没答完
        no3:P.fromHistory([H("A（不会的）",3,3,0)],S,null).join(),
        no4:P.fromHistory([H("本次错题重练",3,3,0)],S,null).join(),
        no5:P.fromHistory([H("A",4,4,0)],S,null).join(),                          // 题数对不上（后来改过题库）
        no6:P.fromHistory([{date:"x",scope:"A",total:3,correct:3,wrong:0},null,"坏"],S,null).join(),
        dun:P.fromHistory([H("甲、乙",2,2,0)],S,null).join()                       // 分类名自己带「、」
      };})()`);
    ok(r.full === 'A,B' && r.partB === 'A' && r.dup === '', '刷完几遍：一次练习里分类的题全答了才算（少一题不算、同一题重复不能凑数）', r);
    ok(r.h1 === '1000|A' && r.h2 === '1000|A,1000|B' && r.h3 === '1000|A,1000|B,1000|甲、乙' && r.h3home === '1000|A,1000|B,1000|甲、乙' && r.early1 === '1000|A' && r.early2 === '1000|A,1000|B' && r.early3 === '' && r.h4 === '1000|A' && r.dun === '1000|甲、乙',
      '刷完几遍：从练习记录补以前的——单个分类、几个一起、全选（按当时有几个分类算）、只练没做过的（正好整个分类）都认得', r);
    ok(!r.no1 && !r.no2 && !r.no3 && !r.no4 && !r.no5 && !r.no6, '刷完几遍：没答完、只练一部分、不会的、错题重练、题数对不上、坏数据都不认', r);

    /* ---------- 2. 科目页：真刷一遍 ---------- */
    const finishDay = (cat, skip) => p.ev(`(async()=>{const w=ms=>new Promise(r=>setTimeout(r,ms));const Q=__quiz;
      Q.showScreen("home");await w(30);
      document.querySelectorAll(".catChk").forEach(c=>c.checked=c.value===${JSON.stringify(cat)});document.getElementById("startBtn").click();await w(60);
      if(document.getElementById("confirmBackdrop").classList.contains("show")){document.getElementById("confirmOkBtn").click();await w(60);}
      const q=Q.session.queue;for(let i=0;i<q.length;i++){if(i===${skip == null ? -1 : skip})continue;Q.session.idx=i;Q.renderQuestion();Q.pickOption(i%3?q[i].correct:"ABCD".replace(q[i].correct,"")[0]);}
      Q.finishQuiz();await w(20);return q.length;})()`);
    const cnt = cat => p.ev(`TikuPasses.counts("lijingdailyvocabquiz")[${JSON.stringify(cat)}]||0`);
    await finishDay('11月9日', 5);
    r = { n: await cnt('11月9日'), hist: await p.ev('__quiz.history.length') };
    ok(r.n === 0 && r.hist === 1, '科目页：少答一题就交卷 → 有练习记录、但不算刷完', r);
    const n9 = await finishDay('11月9日');
    r = { n: await cnt('11月9日'), size: await p.ev('__quiz.CAT_SIZE["11月9日"]'), n9 };
    ok(r.n === 1 && r.size === n9, '科目页：一天的题全答完（有错的）→ 记 1 遍', r);
    // 结果页「返回本次练习」再结束：同一次练习，不多记
    await p.ev(`(async()=>{document.getElementById("backToQuizBtn").click();await new Promise(r=>setTimeout(r,40));__quiz.finishQuiz();return 1;})()`);
    ok(await cnt('11月9日') === 1, '科目页：从结果页「返回本次练习」再结束 → 还是 1 遍');
    // 结果页「本次错题重练」：只是一部分题，不算
    await p.ev(`(async()=>{document.getElementById("retryWrongBtn").click();await new Promise(r=>setTimeout(r,60));const Q=__quiz,q=Q.session.queue;
      for(let i=0;i<q.length;i++){Q.session.idx=i;Q.renderQuestion();Q.pickOption(q[i].correct);}Q.finishQuiz();return q.length;})()`);
    ok(await cnt('11月9日') === 1, '科目页：错题重练答完 → 不算刷完一遍');
    await sleep(5); await finishDay('11月9日');
    // 两天一起勾：两天各记一遍
    r = await p.ev(`(async()=>{const w=ms=>new Promise(r=>setTimeout(r,ms));const Q=__quiz;Q.showScreen("home");await w(30);
      document.querySelectorAll(".catChk").forEach(c=>c.checked=c.value==="11月10日"||c.value==="11月11日");document.getElementById("startBtn").click();await w(60);
      const q=Q.session.queue;for(let i=0;i<q.length;i++){Q.session.idx=i;Q.renderQuestion();Q.pickOption(q[i].correct);}Q.finishQuiz();await w(20);
      document.getElementById("backHomeBtn").click();await w(30);   // 结果页「返回首页」：真实路径，会重画分类列表
      const row=c=>[...document.querySelectorAll("#catList label")].find(l=>l.querySelector(".catChk").value===c).querySelector(".cat-count").textContent;
      return {r9:row("11月9日"),r10:row("11月10日"),r8:row("11月8日")};})()`);
    r.n10 = await cnt('11月10日'); r.n11 = await cnt('11月11日'); r.n9 = await cnt('11月9日');
    ok(r.n9 === 2 && r.n10 === 1 && r.n11 === 1, '科目页：两天一起勾、都答完 → 各记 1 遍；11月9日 刷了两次是 2 遍', r);
    ok(/^✓ 刷完 2 遍 · /.test(r.r9) && /^✓ 刷完 1 遍 · /.test(r.r10) && !/刷完/.test(r.r8), '开始练习页：每天后面显示「✓ 刷完 N 遍」，没刷完过的不显示', r);
    // 别的科目（选单词）各算各的
    ok(await p.ev(`Object.keys(TikuPasses.counts("lijingdailychoosequiz")).length`) === 0, '刷完几遍按科目分开：选意思刷完不算到选单词上');

    /* ---------- 3. 首页卡片 ---------- */
    await p.goto(BASE);
    const badge = k => `(document.querySelector('[data-key="${k}"] .pass-badge')||{}).textContent||""`;
    r = await p.ev(`({d9:${badge('lijing-daily-2026-11-09')},d10:${badge('lijing-daily-2026-11-10')},d8:${badge('lijing-daily-2026-11-08')},whole:${badge('lijing-daily-vocab')}})`);
    ok(r.d9 === '✓ 刷完 2 遍' && r.d10 === '✓ 刷完 1 遍' && r.d8 === '' && r.whole === '', '首页：每天的卡片标题右边「✓ 刷完 N 遍」，没刷完过的、整科的卡片不显示', r);
    // 以前刷完的（功能上线前的练习记录）：不用点进科目页，首页就补上；四级 DAY 也一样
    r = await p.ev(`(()=>{localStorage.removeItem("lijingdailyvocabquiz_passes");localStorage.removeItem("cet4vocabquiz_passes");
      localStorage.setItem("lijingdailyvocabquiz_history",JSON.stringify([{date:1700000000001,scope:"11月8日",total:30,correct:25,wrong:5},{date:1700000000002,scope:"11月8日",total:30,correct:10,wrong:3}]));
      localStorage.setItem("cet4vocabquiz_history",JSON.stringify([{date:1700000000003,scope:"DAY 2",total:116,correct:116,wrong:0}]));
      render();return {d8:${badge('lijing-daily-2026-11-08')},day2:${badge('cet4-vocab-day2')},day3:${badge('cet4-vocab-day3')}};})()`);
    ok(r.d8 === '✓ 刷完 1 遍' && r.day2 === '✓ 刷完 1 遍' && r.day3 === '', '首页：以前的练习记录里答完的那次补成 1 遍（没答完的那次不算），四级 DAY 卡片也有', r);
    // 2026-11-12 用户截图：头两天只有 11月8日 一天，那时刷完的记录范围是「全部日期」、30 题 → 11月8日 要亮；之后两天一起刷的「全部日期」60 题 → 8、9 日各一遍
    r = await p.ev(`(()=>{localStorage.removeItem("lijingdailyvocabquiz_passes");
      localStorage.setItem("lijingdailyvocabquiz_history",JSON.stringify([{date:1700000000011,scope:"全部日期",total:30,correct:26,wrong:4},{date:1700000000012,scope:"全部日期",total:60,correct:50,wrong:10}]));
      render();return {d8:${badge('lijing-daily-2026-11-08')},d9:${badge('lijing-daily-2026-11-09')},d10:${badge('lijing-daily-2026-11-10')}};})()`);
    ok(r.d8 === '✓ 刷完 2 遍' && r.d9 === '✓ 刷完 1 遍' && r.d10 === '', '首页：只有一天时记成「全部日期」的那次也认得（按当时有几天算）', r);
    await p.goto(BASE + 'lijing-daily-vocab/'); await p.ev('localStorage.removeItem("lijingdailyvocabquiz_passes")'); await p.goto(BASE + 'lijing-daily-vocab/');
    r = await p.ev(`(()=>{const c=TikuPasses.counts("lijingdailyvocabquiz");return [c["11月8日"]||0,c["11月9日"]||0,c["11月10日"]||0];})()`);
    ok(JSON.stringify(r) === '[2,1,0]', '科目页：同样认得「全部日期」按当时的天数算', r);
    // 还原成上面那组记录，下面验备份的那条不受这里影响
    await p.ev(`(()=>{localStorage.setItem("lijingdailyvocabquiz_history",JSON.stringify([{date:1700000000001,scope:"11月8日",total:30,correct:25,wrong:5},{date:1700000000002,scope:"11月8日",total:30,correct:10,wrong:3}]));
      localStorage.setItem("lijingdailyvocabquiz_passes",JSON.stringify({"1700000000001|11月8日":1}));})()`);
    await p.goto(BASE);

    /* ---------- 4. 导出 / 导入备份带上遍数（合并＝并集） ---------- */
    r = await p.ev(`(async()=>{const w=ms=>new Promise(r=>setTimeout(r,ms));
      // 备份里放一条练习记录推不出来的（只能靠合并带回来；推得出来的那条导入后首页也会从记录里补，验不出合并）
      const ps=JSON.parse(localStorage.lijingdailyvocabquiz_passes);ps["1600000000000|11月10日"]=1;localStorage.lijingdailyvocabquiz_passes=JSON.stringify(ps);
      let blob=null;const orig=URL.createObjectURL;URL.createObjectURL=b=>{blob=b;return orig.call(URL,b);};exportBackup();await w(50);const text=await blob.text();
      const has=Object.keys(JSON.parse(text).items).includes("lijingdailyvocabquiz_passes");
      localStorage.setItem("lijingdailyvocabquiz_passes",JSON.stringify({"1800000000000|11月11日":1}));localStorage.removeItem("lijingdailyvocabquiz_history");
      const p=importBackup(new File([text],"b.json"));await w(60);document.getElementById("confirmOkBtn").click();await p;
      return {has,keys:Object.keys(JSON.parse(localStorage.lijingdailyvocabquiz_passes)).sort()};})()`);
    ok(r.has && JSON.stringify(r.keys) === '["1600000000000|11月10日","1700000000001|11月8日","1800000000000|11月11日"]', '导出备份带上遍数；导入时跟本机的取并集', r);

    /* ---------- 5. 清空练习记录 → 遍数清零 ---------- */
    await p.goto(BASE + 'lijing-daily-vocab/');
    r = await p.ev(`(async()=>{const w=ms=>new Promise(r=>setTimeout(r,ms));__quiz.showScreen("history");document.getElementById("clearHistoryBtn").click();await w(60);
      const msg=document.getElementById("confirmMsg")?document.getElementById("confirmMsg").textContent:document.getElementById("confirmBackdrop").textContent;
      document.getElementById("confirmOkBtn").click();await w(60);return {msg,ls:localStorage.getItem("lijingdailyvocabquiz_passes")};})()`);
    ok(/刷完几遍.*清零/.test(r.msg) && r.ls === null, '清空练习记录：确认框写明遍数一起清零，清完遍数没了', r);
    if (p.errors.length) ok(false, '刷完几遍：页面 JS 异常', p.errors);
  } finally { p.close(); }

  /* ---------- 6. 版面：320 宽、第 3 层文件夹里、两位数遍数，标记不挤出卡片、不折行 ---------- */
  for (const W of [320, 390, 430]) {
    const c = await open(W, 800, 1);
    try {
      await c.goto(BASE); await c.ev('localStorage.clear()');
      await c.ev(`(()=>{localStorage.setItem("tiku_folders",JSON.stringify([{id:"x1",name:"第一层"},{id:"x2",name:"第二层",parent:"x1"},{id:"x3",name:"第三层",parent:"x2"}]));
        localStorage.setItem("tiku_subject_folder",JSON.stringify({"cet4-choose-day15":"x3","lijing-daily-2026-11-11":"x3"}));
        localStorage.setItem("tiku_expanded_folders",JSON.stringify(["x1","x2","x3"]));
        const o={};for(let i=0;i<12;i++)o[(1700000000000+i)+"|DAY 15"]=1;localStorage.setItem("cet4choosequiz_passes",JSON.stringify(o));
        localStorage.setItem("lijingdailyvocabquiz_passes",JSON.stringify({"1700000000000|11月11日":1}));})()`);
      await c.goto(BASE); await sleep(300);
      const m = await c.ev(`(()=>{const out=[];["cet4-choose-day15","lijing-daily-2026-11-11"].forEach(k=>{const card=document.querySelector('.folder-card[data-fid="x3"] [data-key="'+k+'"]');
          if(!card){out.push({k,missing:true});return;}
          const b=card.querySelector(".pass-badge"),n=card.querySelector(".name"),cr=card.getBoundingClientRect(),br=b.getBoundingClientRect(),nr=n.getBoundingClientRect();
          out.push({k,text:b.textContent,cardW:Math.round(cr.width),inside:br.right<=cr.right-15.5&&br.left>=nr.right,oneLine:br.height<24,nameLines:Math.round(nr.height/parseFloat(getComputedStyle(n).lineHeight||22))});});
        return {out,overflow:document.documentElement.scrollWidth>innerWidth};})()`);
      ok(!m.overflow && m.out.every(x => !x.missing && x.inside && x.oneLine), `版面 ${W}：第 3 层文件夹里的卡片，「✓ 刷完 12 遍」在卡片里、在名字右边、不折行，页面不横向溢出`, m);
    } finally { c.close(); }
  }
}
module.exports = { runPasses };
