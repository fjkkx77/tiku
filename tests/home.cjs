// 汇总首页（index.html）的回归测试：2026-10-16 加的置顶、排序、左滑、长按拖动、学习情况、⋯ 菜单、底部面板，以及旧数据兼容。
// 外观是原来的（用户看过 iOS 风格改版后决定回到原界面，只保留新逻辑和交互）。
//   单独跑：node tests/home.cjs        （tests/run.cjs 也会调它）
// 关键几条在故意改坏的版本上看过它变红（见提交说明）。
const path = require('path');
const { open, sleep } = require('./cdp.cjs');

const W8 = 'const w=ms=>new Promise(r=>setTimeout(r,ms));';
const ROWS = 'document.querySelectorAll("#list .item[data-key]")';
// 页面上看到的结构：[[组名, [科目 key…]]…]——置顶 / 各文件夹 / 未分组（收起的文件夹里的卡片也算，按 DOM 顺序）
const LAYOUT = `(()=>{const out=[],L=document.getElementById("list");const pin=[...L.querySelectorAll(":scope > .item.pinned")].map(r=>r.dataset.key);if(pin.length)out.push(["置顶",pin]);
  L.querySelectorAll(":scope > .folder-card").forEach(f=>out.push([f.querySelector(".folder-name").textContent,[...f.querySelectorAll(".item[data-key]")].map(r=>r.dataset.key)]));
  const loose=[...L.querySelectorAll(":scope > .item:not(.pinned)")].map(r=>r.dataset.key);if(loose.length)out.push(["未分组",loose]);return out;})()`;
const REAL = `localStorage.setItem("tiku_folders",JSON.stringify([{id:"f1",name:"第二学期"}]));
  localStorage.setItem("tiku_subject_folder",JSON.stringify({"web-design":"f1",os:"f1","software-engineering":"f1","mobile-app":"f1","english-listening":"f1","english-reading":"f1","english-vocab":"f1","english-translation":"f1"}));
  localStorage.setItem("tiku_expanded_folders",'["f1"]');`;
// #list 的直接子元素：小标题写成「#标题」，科目写 key，文件夹写「F:名字」
const SEQ = `[...document.getElementById("list").children].map(n=>n.matches(".sec-label")?"#"+n.textContent:n.matches(".folder-card")?"F:"+n.querySelector(".folder-name").textContent:n.dataset.key)`;
const DESC = k => `document.querySelector('.item[data-key="${k}"] .desc').textContent`;

async function runHome(BASE, ok) {
  /* ---------- 逻辑（390 宽） ---------- */
  const c = await open(390, 844, 1);
  const reset = async (js) => { await c.goto(BASE); await c.ev('localStorage.clear();sessionStorage.clear();' + (js || '') + ';1'); await c.goto(BASE); };
  try {
    // 题数：首页清单里写的 total 必须等于科目页题库的题数（「已做」封顶靠它）
    {
      await c.goto(BASE);
      const totals = await c.ev('SUBJECTS.map(s=>[s.key,s.href,s.total])');
      const bad = [];
      for (const [k, href, t] of totals) {
        await c.goto(BASE + href.replace(/^\.\//, ''));
        const n = await c.ev('QUESTIONS.length');
        if (n !== t) bad.push(k + ' 首页写 ' + t + '，题库 ' + n);
      }
      ok(!bad.length, '首页：每科总题数和科目页题库一致', bad);
    }
    // 坏数据不把首页弄坏
    for (const [k, v] of [['tiku_pinned', '{坏'], ['tiku_pinned', 'null'], ['tiku_pinned', '[1,"不存在","os","os"]'], ['tiku_order', '"x"'], ['tiku_order', '["os","os",null]'],
                          ['tiku_folders', '[{"id":"f1","name":"甲"},{"id":"f1","name":"甲2"}]'], ['webquiz_wrongbook', '[1,2]'], ['webquiz_done', '"x"']]) {
      await reset(`localStorage.setItem(${JSON.stringify(k)},${JSON.stringify(v)})`);
      const r = await c.ev(`({n:${ROWS}.length,keys:[...${ROWS}].map(r=>r.dataset.key)})`);
      ok(r.n === 8 && new Set(r.keys).size === 8 && !c.errors.length, `首页：存储项 ${k}=${v} 坏了也照常显示 8 科、不重复`, r);
    }
    // 学习情况：接在原来的「题型，N题」后面；超过题库的封顶；没练过写「还没练过」
    await reset(`localStorage.setItem("osquiz_wrongbook",JSON.stringify({a:{},b:{},c:{}}));localStorage.setItem("osquiz_done",JSON.stringify({x:1,y:1,z:1,u:1}));
      localStorage.setItem("mobileappquiz_done",JSON.stringify(Object.fromEntries(Array.from({length:30},(_,i)=>["k"+i,1]))));`);
    {
      const r = await c.ev(`({os:${DESC('os')},mob:${DESC('mobile-app')},web:${DESC('web-design')}})`);
      ok(r.os === '填空题，85题 · 错题 3 · 已做 4' && r.mob === '单选题，10题（第1次+第2次作业） · 没有错题 · 已做 10' && r.web === '单选+填空混合，90题 · 还没练过',
        '首页：卡片第二行＝原来的题型题数 + 错题数和已做题数（超过题库的封顶）', r);
    }
    {
      await c.ev('localStorage.setItem("osquiz_wrongbook",JSON.stringify({a:{}}));window.dispatchEvent(new PageTransitionEvent("pageshow",{persisted:true}))');
      ok(await c.ev(DESC('os')) === '填空题，85题 · 错题 1 · 已做 4', '首页：从科目页返回时重新读学习情况');
    }
    // 你现在的数据（一个文件夹装着 8 科 + 改过的名字）原样显示
    await reset(REAL + 'localStorage.setItem("tiku_custom_names",JSON.stringify({os:"OS 期末"}))');
    {
      const r = await c.ev(LAYOUT);
      const name = await c.ev(`document.querySelector('.item[data-key="os"] .name').textContent`);
      const btns = await c.ev(`document.querySelectorAll("#list .item button").length`);
      ok(r.length === 1 && r[0][0] === '第二学期' && r[0][1].length === 8 && name === 'OS 期末' && btns === 0, '首页：旧数据（文件夹、改过的名字、展开状态）原样显示；科目卡片上不再有 ✏️ 📁 还原（左滑「更多」里有）', { r, name, btns });
    }
    // 置顶：排到最上面、带 📌、离开原文件夹；取消后回到原文件夹原位置
    {
      await c.ev('togglePin("software-engineering")'); await sleep(50);
      const a = await c.ev(LAYOUT);
      const seq = await c.ev(SEQ);
      const tag = seq[0] === '#📌 置顶' && seq[1] === 'software-engineering' && seq[2] === '#全部' && !(await c.ev('!!document.querySelector(".pin-tag")'));
      await c.ev('togglePin("os")'); await sleep(50);
      const b = await c.ev(LAYOUT);
      await c.ev('togglePin("software-engineering");togglePin("os")'); await sleep(50);
      const d = await c.ev(LAYOUT);
      ok(a[0][0] === '置顶' && JSON.stringify(a[0][1]) === '["software-engineering"]' && tag && !a[1][1].includes('software-engineering') && a[1][1].length === 7
        && JSON.stringify(b[0][1]) === '["software-engineering","os"]'
        && d.length === 1 && JSON.stringify(d[0][1]) === '["web-design","os","software-engineering","mobile-app","english-listening","english-reading","english-vocab","english-translation"]',
        '置顶：进「📌 置顶」分区（下面是「全部」）并离开原文件夹；按置顶先后排；取消后回到原文件夹原位置、分区标题消失', { a, b, d, tag, seq, after: await c.ev(SEQ + '.filter(x=>x[0]==="#")') });
      ok((await c.ev(SEQ + '.filter(x=>x[0]==="#")')).length === 0, '没有置顶时不显示分区小标题');
      ok(await c.ev('document.querySelector(".folder-card .folder-count").textContent') === '(8)', '置顶：文件夹标题的数量只数里面显示的');
    }
    // 排序写回：没进文件夹的那几张换位，只动它们占着的位置，文件夹里的科目先后不变
    await reset(`localStorage.setItem("tiku_folders",JSON.stringify([{id:"f1",name:"甲"}]));localStorage.setItem("tiku_subject_folder",JSON.stringify({os:"f1","mobile-app":"f1"}));localStorage.setItem("tiku_expanded_folders",'["f1"]')`);
    {
      const r = await c.ev(`(()=>{const rows=[...document.querySelectorAll("#list > .item:not(.pinned)")];const last=rows.pop();rows.unshift(last);
        reorderSubjects(rows.map(r=>r.dataset.key));render();   // 拖动松手走的就是这个函数
        return {lay:${LAYOUT},order:JSON.parse(localStorage.getItem("tiku_order"))};})()`);
      ok(r.order.indexOf('os') === 1 && r.order.indexOf('mobile-app') === 3 && r.lay[1][1][0] === 'english-translation', '排序：换位只改这一组占着的位置（文件夹里的科目位置不动）', r);
    }
    // 文件夹展开/收起记住；空文件夹也能收起再展开（收起动画 0.32 秒）
    await reset(`localStorage.setItem("tiku_folders",JSON.stringify([{id:"f1",name:"甲"},{id:"f2",name:"乙"}]));localStorage.setItem("tiku_subject_folder",JSON.stringify({os:"f1"}))`);
    {
      const st = () => c.ev(`[...document.querySelectorAll(".folder-card")].map(s=>s.classList.contains("open")&&!s.querySelector(".folder-fold").hidden)`);
      const first = await st();
      await c.ev('document.querySelectorAll(".folder-header")[0].click()'); await sleep(450); await c.goto(BASE);
      const opened = await st();
      await c.ev('document.querySelectorAll(".folder-header")[0].click()'); await sleep(450); await c.goto(BASE);
      const closed = await st();
      await c.ev('document.querySelectorAll(".folder-header")[1].click()'); await sleep(450);
      const e1 = await st();
      await c.ev('document.querySelectorAll(".folder-header")[1].click()'); await sleep(450);
      const e2 = await st();
      ok(JSON.stringify([first, opened, closed, e1, e2]) === '[[false,false],[true,false],[false,false],[false,true],[false,false]]',
        '文件夹：展开/收起重新打开后照上次的样子；空文件夹也能收起再展开', { first, opened, closed, e1, e2 });
      // 收起途中再点一下（动画没播完）：以最后一次为准
      await c.ev('document.querySelectorAll(".folder-header")[0].click()'); await sleep(60);
      await c.ev('document.querySelectorAll(".folder-header")[0].click()'); await sleep(450);
      ok(JSON.stringify(await st()) === '[false,false]', '文件夹：展开动画没播完又点收起，最后是收起的');
    }
    // 新建文件夹（⋯ 菜单 → 面板）：输入法选字时回车不创建；名字为空「创建」不可点
    await reset();
    {
      const r = await c.ev(`(async()=>{${W8}document.getElementById("topMoreBtn").click();await w(30);const labels=[...document.querySelectorAll(".menu .it")].map(b=>b.textContent);document.getElementById("menuNewFolder").click();await w(80);
        const i=document.querySelector("#sheet input");const okBtn=document.querySelector("#sheet .b1");const empty=okBtn.disabled;i.value="期末";i.dispatchEvent(new Event("input"));
        i.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",isComposing:true,bubbles:true}));const composing=document.querySelectorAll(".folder-card").length;
        i.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true}));await w(30);
        return {labels,empty,composing,made:document.querySelectorAll(".folder-card").length,sheet:!!document.getElementById("sheet"),menu:!!document.querySelector(".menu"),name:document.querySelector(".folder-name").textContent};})()`);
      ok(JSON.stringify(r.labels) === '["新建文件夹","选择多个","导出备份","导入备份"]' && r.empty && r.composing === 0 && r.made === 1 && !r.sheet && !r.menu && r.name === '期末',
        '⋯ 菜单四项；新建文件夹：空名不可点、输入法选字时回车不创建、正常回车创建并关面板', r);
    }
    // 「更多」→ 重命名：点下去的同一刻输入框就聚焦（不能等：iPhone 只认手势里的 focus，晚了不弹键盘）；没改不可点、去掉首尾空格、还原
    {
      const r = await c.ev(`(async()=>{${W8}const card=()=>document.querySelector('.item[data-key="os"]');
        openSubjectSheet("os");await w(30);document.getElementById("actRename").click();
        const i=document.querySelector("#sheet input");const focusedNow=document.activeElement===i;
        const okb=document.querySelector("#sheet .b1");const same=okb.disabled;
        i.value="  OS 复习  ";i.dispatchEvent(new Event("input"));okb.click();await w(30);const renamed=card().querySelector(".name").textContent;
        openSubjectSheet("os");await w(30);document.getElementById("actReset").click();await w(30);const back=card().querySelector(".name").textContent;
        openSubjectSheet("os");await w(30);document.getElementById("actMove").click();await w(60);[...document.querySelectorAll("#sheet .opt")].find(b=>b.textContent.includes("期末")).click();await w(30);
        const moved=${LAYOUT};
        openSubjectSheet("os");await w(30);document.getElementById("actMove").click();await w(60);document.getElementById("actMoveOut").click();await w(30);
        document.getElementById("topMoreBtn").click();await w(30);document.getElementById("menuNewFolder").click();const nf=document.activeElement===document.querySelector("#sheet input");closeSheet();
        return {focusedNow,nf,same,renamed,back,moved,out:${LAYOUT}};})()`);
      ok(r.focusedNow && r.nf, '点「重命名」「新建文件夹」的同一刻输入框已聚焦（手机上才会直接弹键盘）', r);
      ok(r.same && r.renamed === 'OS 复习' && r.back === '操作系统', '重命名：没改不可点、去掉首尾空格；「还原原名」恢复', r);
      ok(r.moved[0][0] === '期末' && JSON.stringify(r.moved[0][1]) === '["os"]' && r.out.length === 2 && r.out[1][1].includes('os'), '移到文件夹 / 移出文件夹', { moved: r.moved, out: r.out });
    }
    // 文件夹置顶：排到其他文件夹前面、带 📌；文件夹拖动只在同样置顶/不置顶的之间换位，写回只动它们占着的位置
    {
      const r = await c.ev(`(async()=>{${W8}const fs=loadFolders();fs.push({id:"x1",name:"乙"},{id:"x2",name:"丙"});saveFolders(fs);render();
        const names=()=>[...document.querySelectorAll("#list > .folder-card .folder-name")].map(n=>n.textContent);
        const before=names();toggleFolderPin("x2");await w(30);const pinned=names(),seq=${SEQ},tag=seq[0]==="#📌 置顶"&&seq[1]==="F:丙"&&seq[2]==="#全部";
        reorderFolders([fs[0].id,"x1"].reverse());render();const swapped=names(),arr=loadFolders().map(f=>f.id);
        toggleFolderPin("x2");await w(30);return {before,pinned,tag,swapped,arr,after:names()};})()`);
      ok(JSON.stringify(r.before) === '["期末","乙","丙"]' && JSON.stringify(r.pinned) === '["丙","期末","乙"]' && r.tag && JSON.stringify(r.swapped) === '["丙","乙","期末"]' && r.arr[2] === 'x2' && JSON.stringify(r.after) === '["乙","期末","丙"]',
        '文件夹置顶：进「📌 置顶」分区，取消后回原位；换位只动参与的那几个的位置', r);
    }
    // 底部不再有导出/导入按钮（⋯ 菜单里有），说明文字指向 ⋯
    ok(await c.ev('!document.querySelector(".backup-link")&&document.querySelector(".backup-note").textContent.includes("⋯")'), '底部：导出/导入只在 ⋯ 菜单里，说明文字指过去');
    // 左滑「更多」面板：置顶、改名后可还原、改回原名就不存自定义
    {
      const r = await c.ev(`(async()=>{${W8}openSubjectSheet("os");await w(30);const labels=[...document.querySelectorAll("#sheet .opt")].map(b=>b.textContent);document.getElementById("actRename").click();await w(80);
        const i=document.querySelector("#sheet input");i.value="新名";i.dispatchEvent(new Event("input"));document.querySelector("#sheet .b1").click();await w(30);
        openSubjectSheet("os");await w(30);const hasReset=!!document.getElementById("actReset");document.getElementById("actRename").click();await w(80);
        const i2=document.querySelector("#sheet input");i2.value="操作系统";i2.dispatchEvent(new Event("input"));document.querySelector("#sheet .b1").click();await w(30);
        const cleared=!("os" in JSON.parse(localStorage.getItem("tiku_custom_names")||"{}"));
        openSubjectSheet("os");await w(30);document.getElementById("actPin").click();await w(30);
        return {labels,hasReset,cleared,pinned:loadPinned()};})()`);
      ok(JSON.stringify(r.labels) === '["置顶","重命名","移到文件夹…"]' && r.hasReset && r.cleared && JSON.stringify(r.pinned) === '["os"]', '「更多」面板：置顶 / 重命名 / 移到文件夹；改过名才出现还原；改回原名不存自定义', r);
      await c.ev('togglePin("os")');
    }
    // 删除文件夹（左滑「删除」走的就是 deleteFolder）：正中确认框（取消不删），确定后科目回到外面
    {
      const r = await c.ev(`(async()=>{${W8}saveFolders(loadFolders().filter(f=>f.name==="期末"));render();applyMove(["os","web-design"],document.querySelector(".folder-card").dataset.fid);await w(20);
        const fid=document.querySelector(".folder-card").dataset.fid;const noTrash=!document.querySelector(".folder-card .danger");
        deleteFolder(fid);await w(50);
        const asked=document.getElementById("confirmBackdrop").classList.contains("show"),msg=document.getElementById("confirmMsg").textContent;document.getElementById("confirmCancelBtn").click();await w(30);
        const kept=document.querySelectorAll(".folder-card").length;
        deleteFolder(fid);await w(50);document.getElementById("confirmOkBtn").click();await w(50);
        return {noTrash,asked,msg,kept,left:document.querySelectorAll(".folder-card").length,lay:${LAYOUT},map:localStorage.getItem("tiku_subject_folder")};})()`);
      ok(r.noTrash && r.asked && r.msg.includes('期末') && r.kept === 1 && r.left === 0 && r.lay.length === 1 && r.lay[0][1].length === 8 && r.map === '{}',
        '删除文件夹：标题行没有 🗑️；先确认（文案带名字），取消不删；确定后科目全部回来', r);
    }
    // 选择多个（原来的批量整理）：点卡片是勾选不是跳转；移到新建的文件夹；完成后退出
    await reset();
    {
      const r = await c.ev(`(async()=>{${W8}document.getElementById("topMoreBtn").click();await w(30);document.getElementById("menuSelect").click();await w(30);
        const href=location.href;const rows=document.querySelectorAll("#list .item[data-key]");rows[0].click();rows[2].click();rows[2].click();rows[3].click();await w(30);
        const cnt=document.getElementById("batchCount").textContent,stay=location.href===href,moreHidden=document.getElementById("topMoreBtn").hidden,cb=document.querySelectorAll(".batch-checkbox.checked").length;
        document.getElementById("batchMoveBtn").click();await w(50);document.getElementById("actMoveNew").click();await w(80);
        const i=document.querySelector("#sheet input");i.value="一起";i.dispatchEvent(new Event("input"));document.querySelector("#sheet .b1").click();await w(50);
        return {cnt,stay,moreHidden,cb,lay:${LAYOUT},bar:getComputedStyle(document.getElementById("batchBar")).display,batch:batchMode,more:document.getElementById("topMoreBtn").hidden};})()`);
      ok(r.cnt === '已选 2 项' && r.stay && r.moreHidden && r.cb === 2 && r.lay[0][0] === '一起' && JSON.stringify(r.lay[0][1]) === '["web-design","mobile-app"]' && r.bar === 'none' && !r.batch && !r.more,
        '选择多个：点卡片是勾选不跳转，移到新建文件夹后自动退出', r);
    }
    // 备份清单带上置顶和排序
    {
      const r = await c.ev('backupKeys()');
      ok(r.includes('tiku_pinned') && r.includes('tiku_order') && !r.includes('tiku_expanded_folders') && !r.includes('tiku_last_export'), '导出备份：带上置顶和排序（展开状态、上次导出时间不带）');
    }
    // 上次导出时间
    {
      const r = await c.ev(`(async()=>{${W8}localStorage.setItem("osquiz_history","[]");const o=URL.createObjectURL;URL.createObjectURL=()=>"blob:x";HTMLAnchorElement.prototype.click=function(){};
        const before=document.getElementById("lastExport").textContent;exportBackup();await w(20);const now=document.getElementById("lastExport").textContent;
        localStorage.setItem("tiku_last_export",String(Date.now()-3*86400000));render();const three=document.getElementById("lastExport").textContent;URL.createObjectURL=o;return {before,now,three};})()`);
      ok(r.before === '上次导出：从未' && r.now === '上次导出：今天' && r.three === '上次导出：3 天前', '底部显示上次导出备份是什么时候', r);
    }
    // 电脑上右键科目 = 「更多」面板；Esc 关掉
    await reset();
    {
      const r = await c.ev(`(async()=>{${W8}const row=document.querySelector('.item[data-key="os"]');const rc=row.getBoundingClientRect();
        row.dispatchEvent(new MouseEvent("contextmenu",{bubbles:true,cancelable:true,clientX:rc.left+20,clientY:rc.top+10}));await w(30);
        const t=document.querySelector("#sheet h2")&&document.querySelector("#sheet h2").textContent;document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}));await w(30);return {t,closed:!document.getElementById("sheet")};})()`);
      ok(r.t === '操作系统' && r.closed, '电脑：右键科目打开「更多」面板，Esc 关闭', r);
    }
    if (c.errors.length) ok(false, '首页逻辑：页面 JS 异常', c.errors);
  } finally { c.close(); }

  /* ---------- 手势 + 版面（真触摸，320 / 390 / 430） ---------- */
  for (const W of process.env.TIKU_QUICK ? [390] : [320, 390, 430]) {
    const t = await open(W, 800, 2);
    const T = (type, pts) => t.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
    const move = async (x0, y0, x1, y1, ms) => { const k = Math.max(4, Math.round(ms / 16));
      for (let i = 1; i <= k; i++) { await T('touchMove', [{ x: x0 + (x1 - x0) * i / k, y: y0 + (y1 - y0) * i / k }]); await sleep(16); } };
    const swipe = async (x0, y0, x1, y1, ms) => { await T('touchStart', [{ x: x0, y: y0 }]); await move(x0, y0, x1, y1, ms); await T('touchEnd', []); await sleep(450); };
    // 卡片上一个不落在按钮上的点：描述文字那一行
    const spot = sel => t.ev(`(()=>{const el=document.querySelector(${JSON.stringify(sel)});el.scrollIntoView({block:"center",behavior:"instant"});const d=(el.querySelector(".desc")||el).getBoundingClientRect(),r=el.getBoundingClientRect();return [d.left+Math.min(60,d.width/2),d.top+d.height/2,r.height];})()`);
    const reset = async (js) => { await t.goto(BASE); await t.ev('localStorage.clear();sessionStorage.clear();' + (js || '') + ';1'); await t.goto(BASE); };
    try {
      // 长名字也不横向溢出
      await reset(REAL + 'localStorage.setItem("tiku_custom_names",JSON.stringify({os:"一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十ABCDEFGHIJ"}));localStorage.setItem("tiku_pinned",\'["mobile-app"]\')');
      let m = await t.ev('({sw:document.documentElement.scrollWidth,over:[...document.querySelectorAll("#list .item")].filter(r=>r.scrollWidth>r.clientWidth+1).length})');
      ok(m.sw <= W && m.over === 0, `${W} 首页无横向溢出（含 40 字长名字）`, m);
      // 可点范围：右上角 ⋯ 44×44；卡片和文件夹上的小按钮 36×36
      m = await t.ev(`(()=>{const a=document.getElementById("topMoreBtn").getBoundingClientRect();return {top:[Math.round(a.width),Math.round(a.height)],btns:document.querySelectorAll("#list button").length};})()`);
      ok(m.top[0] >= 44 && m.top[1] >= 44 && m.btns === 0, `${W} 右上角 ⋯ 可点范围 44×44；列表里没有小图标按钮（操作都在左滑里）`, m);
      // 标题在 ⋯ 旁边仍然居中、不被它压住
      m = await t.ev(`(()=>{const h=document.querySelector("header h1").getBoundingClientRect(),rg=document.createRange();rg.selectNodeContents(document.querySelector("header p"));const p=rg.getBoundingClientRect(),b=document.getElementById("topMoreBtn").getBoundingClientRect(),W=document.documentElement.clientWidth;return {mid:Math.round(h.left+h.width/2-W/2),hit:p.right>b.left+6&&p.bottom>b.top&&p.top<b.bottom};})()`);
      ok(Math.abs(m.mid) <= 1 && !m.hit, `${W} 头部标题居中、副标题不压到 ⋯`, m);
      // 左滑一张卡：露出「更多」「置顶」；点「置顶」生效
      let [x, y] = await spot('.item[data-key="os"]');
      await swipe(W * 0.8, y, W * 0.25, y + 3, 220);
      m = await t.ev('[...document.querySelectorAll(".lsw-acts.is-open .lsw-btn")].map(b=>b.textContent)');
      ok(JSON.stringify(m) === '["更多","置顶"]', `${W} 左滑科目露出「更多」「置顶」`, m);
      const pinXY = await t.ev('(()=>{const r=[...document.querySelectorAll(".lsw-acts.is-open .lsw-btn")][1].getBoundingClientRect();return [r.left+r.width/2,r.top+r.height/2];})()');
      await T('touchStart', [{ x: pinXY[0], y: pinXY[1] }]); await T('touchEnd', []); await sleep(600);
      ok(JSON.stringify(await t.ev('loadPinned()')) === '["mobile-app","os"]', `${W} 点左滑的「置顶」生效`, await t.ev('loadPinned()'));
      // 左滑开着时点紧挨着的下一张：只收回，不跳转（不能 scrollIntoView：页面一滚左滑就收回了）
      [x, y] = await spot('.item[data-key="web-design"]');
      await swipe(W * 0.8, y, W * 0.25, y + 3, 220);
      const href0 = await t.ev('location.href');
      ok(await t.ev('swipe.isOpen()'), `${W} （前提）左滑开着`);
      [x, y] = await t.ev(`(()=>{const r=document.querySelector('.item[data-key="english-listening"] .desc').getBoundingClientRect();return [r.left+40,r.top+r.height/2];})()`);
      await T('touchStart', [{ x, y }]); await T('touchEnd', []); await sleep(500);
      ok(await t.ev('location.href') === href0 && !(await t.ev('swipe.isOpen()')), `${W} 左滑开着时点别的科目：只收回，不跳进去`);
      // 文件夹标题行左滑：露出「置顶」「删除」；点「删除」弹确认框（取消不删）；点「置顶」生效
      {
        await reset(REAL);
        await t.ev('document.querySelector(".folder-header").click()'); await sleep(450);   // 先收起（用户截图里是收起状态）
        const fy = await t.ev(`(()=>{const r=document.querySelector('.folder-header .folder-name').getBoundingClientRect();return r.top+r.height/2;})()`);
        await swipe(W * 0.8, fy, W * 0.2, fy + 3, 220);
        const labels = await t.ev('[...document.querySelectorAll(".lsw-acts.is-open .lsw-btn")].map(b=>b.textContent)');
        const del = await t.ev('(()=>{const r=[...document.querySelectorAll(".lsw-acts.is-open .lsw-btn")][2].getBoundingClientRect();return [r.left+r.width/2,r.top+r.height/2];})()');
        await T('touchStart', [{ x: del[0], y: del[1] }]); await T('touchEnd', []); await sleep(500);
        const asked = await t.ev('document.getElementById("confirmBackdrop").classList.contains("show")');
        await t.ev('document.getElementById("confirmCancelBtn").click()'); await sleep(400);
        const kept = await t.ev('document.querySelectorAll(".folder-card").length');
        await swipe(W * 0.8, fy, W * 0.2, fy + 3, 220);
        const pin = await t.ev('(()=>{const r=[...document.querySelectorAll(".lsw-acts.is-open .lsw-btn")][1].getBoundingClientRect();return [r.left+r.width/2,r.top+r.height/2];})()');
        await T('touchStart', [{ x: pin[0], y: pin[1] }]); await T('touchEnd', []); await sleep(600);
        const pinned = await t.ev('!!loadFolders()[0].pinned&&document.getElementById("list").firstElementChild.textContent==="📌 置顶"');
        // 「重命名」：打开改名面板，输入框当场聚焦
        const fy2 = await t.ev(`(()=>{const r=document.querySelector('.folder-header .folder-name').getBoundingClientRect();return r.top+r.height/2;})()`);
        await swipe(W * 0.8, fy2, W * 0.15, fy2 + 3, 220);
        const rn = await t.ev('(()=>{const r=[...document.querySelectorAll(".lsw-acts.is-open .lsw-btn")][0].getBoundingClientRect();return [r.left+r.width/2,r.top+r.height/2];})()');
        await T('touchStart', [{ x: rn[0], y: rn[1] }]); await T('touchEnd', []); await sleep(500);
        const renamer = await t.ev('!!document.querySelector("#sheet input")&&document.activeElement===document.querySelector("#sheet input")&&document.querySelector("#sheet h2").textContent==="重命名文件夹"');
        await t.ev('closeSheet()');
        ok(JSON.stringify(labels) === '["重命名","置顶","删除"]' && asked && kept === 1 && pinned && renamer, `${W} 文件夹标题左滑：重命名 / 置顶 / 删除（删除先确认，重命名当场聚焦）`, { labels, asked, kept, pinned, renamer });
      }
      // 长按拖动：文件夹里第一张往下拖过一张 → 换位，松手不跳转
      await reset(REAL);
      let h = (await spot('.item[data-key="os"]'))[2];
      [x, y] = await spot('.item[data-key="web-design"]');
      await T('touchStart', [{ x, y }]); await sleep(600);
      const lifted = await t.ev('drag.active()');
      await move(x, y, x, y + h * 1.3, 300); await sleep(60);
      await T('touchEnd', []); await sleep(900);
      m = await t.ev(`({lay:${LAYOUT},url:location.pathname})`);
      ok(lifted && m.lay[0][1][0] === 'os' && m.lay[0][1][1] === 'web-design' && !/web-design/.test(m.url), `${W} 长按 0.45 秒拿起，往下拖一张松手 → 换位且不跳进科目`, { lifted, m });
      ok(JSON.stringify(await t.ev('JSON.parse(localStorage.getItem("tiku_order")).slice(0,2)')) === '["os","web-design"]', `${W} 拖动后的顺序存下来了`);
      // 按住时手指一动（在滚页面）就不算长按
      [x, y] = await spot('.item[data-key="mobile-app"]');
      await T('touchStart', [{ x, y }]); await move(x, y, x, y - 40, 120); await sleep(600);
      ok(!(await t.ev('drag.active()')), `${W} 按下就滑动：是在滚页面，不会拿起`);
      await T('touchEnd', []); await sleep(300);
      // 在页面顶部长按置顶的卡往下拖：换位，且不能把下拉刷新拉出来
      await reset(`localStorage.setItem("tiku_pinned",'["os","web-design"]')`);
      await t.ev('window.scrollTo(0,0);window.__alive=1');
      [x, y] = await t.ev(`(()=>{const r=document.querySelector('.item[data-key="os"] .desc').getBoundingClientRect();return [r.left+40,r.top+r.height/2];})()`);
      h = await t.ev(`document.querySelector('.item[data-key="web-design"]').getBoundingClientRect().height`);
      await T('touchStart', [{ x, y }]); await sleep(600);
      await move(x, y, x, y + h * 1.3, 300);
      const ptr = await t.ev('document.getElementById("ptrIndicator").style.opacity||"0"');
      await T('touchEnd', []); await sleep(900);
      ok(+ptr === 0 && await t.ev('window.__alive===1') && JSON.stringify(await t.ev('loadPinned()')) === '["web-design","os"]', `${W} 置顶的卡长按往下拖：换位，且不触发下拉刷新`, { ptr, pinned: await t.ev('loadPinned()') });
      // 长按文件夹标题：整个文件夹换位，松手不当成点击（不展开）
      await reset(`localStorage.setItem("tiku_folders",JSON.stringify([{id:"a",name:"甲"},{id:"b",name:"乙"}]));localStorage.setItem("tiku_subject_folder",JSON.stringify({os:"a","web-design":"b"}))`);
      h = await t.ev(`document.querySelector('.folder-card[data-fid="b"]').getBoundingClientRect().height`);
      [x, y] = await t.ev(`(()=>{const r=document.querySelector('.folder-card[data-fid="a"] .folder-name').getBoundingClientRect();return [r.left+r.width/2,r.top+r.height/2];})()`);
      await T('touchStart', [{ x, y }]); await sleep(600);
      await move(x, y, x, y + h * 1.3, 300); await sleep(60);
      await T('touchEnd', []); await sleep(900);
      m = { order: await t.ev('loadFolders().map(f=>f.id).join("")'), open: await t.ev(`document.querySelector('.folder-card[data-fid="a"]').classList.contains("open")`) };
      ok(m.order === 'ba' && !m.open, `${W} 长按文件夹标题拖动：整个文件夹换位，松手不展开`, m);
      // 点卡片 = 进入科目
      await reset();
      [x, y] = await spot('.item[data-key="mobile-app"]');
      await T('touchStart', [{ x, y }]); await T('touchEnd', []); await sleep(1200);
      ok(/\/mobile-app\/$/.test(await t.ev('location.pathname')), `${W} 点科目进入科目页`);
      // 面板开着时在面板上 / 遮罩上上下滑：后面的主页不许跟着滚（2026-10-16 用户 iPhone 报的穿透）
      {
        await reset(REAL);
        await t.ev('window.scrollTo(0,300)'); await sleep(200);
        const y0 = await t.ev('scrollY');
        await t.ev('openSubjectSheet("os")'); await sleep(450);
        const g = await t.ev('(()=>{const r=document.getElementById("sheet").getBoundingClientRect();return [r.left+r.width/2,r.top+r.height/2,r.top];})()');
        await swipe(g[0], g[1], g[0], g[1] - 200, 260);          // 在面板上往上推
        await swipe(W / 2, g[2] - 120, W / 2, g[2] - 320, 260);   // 在遮罩上往上推
        await swipe(W / 2, 80, W / 2, 260, 260);                   // 在遮罩上往下拉
        const y1 = await t.ev('scrollY'), still = await t.ev('!!document.getElementById("sheet")');
        await t.ev('closeSheet()');
        ok(y0 > 0 && y1 === y0 && still, `${W} 面板开着时上下滑：背景主页不跟着滚`, { y0, y1, still });
      }
      // 键盘弹出：面板底边抬到键盘上方（headless 没有真键盘，用假的 visualViewport 模拟键盘占掉 300px）
      {
        const r = await t.ev(`(async()=>{const w=ms=>new Promise(r=>setTimeout(r,ms));const H=innerHeight;
          const fake=Object.assign(new EventTarget(),{height:H-300,offsetTop:0,width:innerWidth});
          Object.defineProperty(window,"visualViewport",{configurable:true,get:()=>fake});
          openSubjectSheet("os");await w(30);document.getElementById("actRename").click();await w(450);
          const inp=document.querySelector("#sheet input").getBoundingClientRect(),sh=document.getElementById("sheet").getBoundingClientRect();
          const out={H,inputBottom:Math.round(inp.bottom),sheetBottom:Math.round(sh.bottom),visible:H-300};
          document.activeElement.blur();await w(120);out.afterBlur=Math.round(document.getElementById("sheet").getBoundingClientRect().bottom);
          closeSheet();delete window.visualViewport;return out;})()`);
        ok(r.sheetBottom <= r.visible + 1 && r.inputBottom <= r.visible && r.afterBlur >= r.H - 1, `${W} 键盘弹出时面板抬到键盘上面、输入框露出来；收起键盘面板落回底部`, r);
      }
      // 底部面板往下拉关闭
      await reset();
      await t.ev('openSubjectSheet("os")'); await sleep(400);
      const sh = await t.ev('(()=>{const r=document.getElementById("sheet").getBoundingClientRect();return [r.left+r.width/2,r.top+30];})()');
      await swipe(sh[0], sh[1], sh[0], sh[1] + 260, 260); await sleep(300);
      ok(!(await t.ev('!!document.getElementById("sheet")')), `${W} 底部面板往下拉关闭`);
      // 顶部下拉照样能刷新（没有浮层时，从卡片上起手也行）
      await t.ev('window.scrollTo(0,0);window.__alive=1;sessionStorage.clear()');
      [x, y] = await t.ev(`(()=>{const r=document.querySelector('#list .item .desc').getBoundingClientRect();return [r.left+40,r.top+r.height/2];})()`);
      await swipe(x, y, x, y + 400, 350); await sleep(900);
      ok(await t.ev('typeof window.__alive==="undefined"'), `${W} 首页从卡片上起手下拉 → 刷新`);
      // ⋯ 菜单在屏幕内；开着时下拉不刷新
      await t.ev('document.getElementById("topMoreBtn").click();window.__alive=1'); await sleep(300);
      m = await t.ev('(()=>{const r=document.querySelector(".menu").getBoundingClientRect();return {l:r.left,r:r.right,W:document.documentElement.clientWidth};})()');
      ok(m.l >= 0 && m.r <= m.W, `${W} ⋯ 菜单整个在屏幕里`, m);
      await swipe(W / 2, 30, W / 2, 400, 350); await sleep(600);
      ok(await t.ev('window.__alive===1'), `${W} 菜单开着时下拉不刷新`);
      if (t.errors.length) ok(false, `${W} 首页手势：页面 JS 异常`, t.errors);
    } finally { t.close(); }
  }
}

module.exports = { runHome };

if (require.main === module) {
  const http = require('http'), fs = require('fs');
  const ROOT = path.resolve(__dirname, '..');
  const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json' };
  let pass = 0, fail = 0;
  const ok = (cond, name, detail) => { cond ? pass++ : fail++; if (!cond) console.log('  ✗ ' + name + (detail !== undefined ? '  → ' + JSON.stringify(detail) : '')); };
  const srv = http.createServer((q, s) => {
    let f = path.join(ROOT, decodeURIComponent(new URL(q.url, 'http://x').pathname));
    if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
    fs.readFile(f, (e, d) => { if (e) { s.writeHead(404); return s.end('404'); } s.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' }); s.end(d); });
  });
  srv.listen(0, '127.0.0.1', async () => {
    try { await runHome('http://127.0.0.1:' + srv.address().port + '/', ok); }
    catch (e) { console.error('FAIL', e); fail++; }
    srv.close();
    console.log(fail ? `FAIL  通过 ${pass}，失败 ${fail}` : `PASS  ${pass} 条全部通过`);
    process.exit(fail ? 1 : 0);
  });
}
