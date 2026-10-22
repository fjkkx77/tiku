/* 刷题合集 · 多设备同步（tiku-sync.js）—— 把本站的存储接到存档同步件上（sync-core / sync-client）
   ─────────────────────────────────────────────────────────────
   设计稿：用户 2026-10-19 确认（复用日程卡片的 Upstash 库、快速模式/背题两个开关也同步、入口在首页 ⋯ 菜单）
   配方：feedback_device_sync_recipe.md；同步件是存档 references/组件_多设备同步 的逐字节副本

   这一层只做一件事：本站的数据原来是一个个 localStorage 键（整份错题本、整份练习记录……），
   同步要的是「一条条、每条有 id 和修改时间」的列表。所以：
     读（getLocal）：把各个键拆成一条条，按指纹（内容哈希）比上次，变了的记成「现在改的」，不见了的记成墓碑
     写（setLocal）：把合并后的列表拼回原来那些键，再通知页面重画
   页面原来的读写代码一行不用改，只在写存储的地方多喊一声 TikuSync.changed()。

   条目 id：
     n|<科目>       科目改的名字          f|<文件夹id>  文件夹（名字、置顶）     fo   文件夹的先后
     sf|<科目>      科目放在哪个文件夹    pin           置顶科目的先后            ord  全部科目的先后
     <前缀>|wb|<题号>  一道错题     <前缀>|h|<时间>  一条练习记录     <前缀>|d|<指纹>  做过的一道题
     <前缀>|prog       继续上次练习  <前缀>|em / |rc  快速模式 / 背题 开关
   不同步：首页哪些文件夹展开着、上次导出时间（只跟这台设备有关）、错题移出记号（本机推出来的） */
(function(){
  'use strict';

  /* 要和首页 index.html 里 SUBJECTS 的 prefix 一一对应（tests/sync.cjs 会核对） */
  const PREFIXES = ['webquiz', 'osquiz', 'rjgcquiz', 'mobileappquiz', 'listeningquiz', 'engreadingquiz', 'engvocabquiz', 'engtranslation', 'cet4vocabquiz'];
  const K = { names: 'tiku_custom_names', folders: 'tiku_folders', sf: 'tiku_subject_folder', pin: 'tiku_pinned', ord: 'tiku_order' };
  const META_KEY = 'tiku_sync_meta';
  const TOMB_MS = 120 * 24 * 3600 * 1000;   // 墓碑留 120 天（配方 §2.1）
  const HISTORY_MAX = 100;                   // 跟 quiz.js 的 updateHistory 一致

  /* 接口地址：GitHub Pages 跑不了函数，接口放在 Vercel（tk.wbztl.xyz）；在 Vercel 上打开时就是同源 */
  const SELF = document.currentScript && document.currentScript.src || '';
  const ROOT = SELF ? SELF.replace(/assets\/tiku-sync\.js(\?.*)?$/, '') : location.origin + '/';
  const API = window.TIKU_SYNC_API || (/(^|\.)github\.io$/i.test(location.hostname) ? 'https://tk.wbztl.xyz/api/sync' : ROOT + 'api/sync');
  const CROSS = (() => { try { return new URL(API, location.href).origin !== location.origin; } catch (e) { return false; } })();

  const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
  function readJSON(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }
  function rawGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function rawSet(k, s) { try { if (localStorage.getItem(k) === s) return false; localStorage.setItem(k, s); return true; } catch (e) { return false; } }
  function rawDel(k) { try { if (localStorage.getItem(k) === null) return false; localStorage.removeItem(k); return true; } catch (e) { return false; } }

  /* 内容指纹：只用来判断「这一条变没变」 */
  function hash(s) { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36) + '.' + s.length; }
  /* 指纹换成 [0,1) 里的一个数：两台设备上没动过的同一条设置内容不同时，靠它分出一致的胜负（都比 1 小，任何真改动都比它新） */
  const hashFrac = h => (parseInt(h, 36) % 1000003) / 1000003;

  function loadMeta() {
    const m = readJSON(META_KEY);
    return isObj(m) && isObj(m.items) ? m : { code: '', seeded: false, items: {} };
  }
  function saveMeta(m) { try { localStorage.setItem(META_KEY, JSON.stringify(m)); } catch (e) { /* 存不下就下次全量重算，不影响数据本身 */ } }

  /* 把现在存储里的东西拆成 Map(id → 值) */
  function current() {
    const m = new Map();
    const names = readJSON(K.names);
    if (isObj(names)) Object.keys(names).forEach(k => { if (typeof names[k] === 'string') m.set('n|' + k, names[k]); });
    const folders = readJSON(K.folders);
    if (Array.isArray(folders)) {
      const ids = [];
      folders.forEach(f => { if (isObj(f) && f.id && !m.has('f|' + f.id)) { m.set('f|' + f.id, f); ids.push(f.id); } });
      m.set('fo', ids);
    }
    const sf = readJSON(K.sf);
    if (isObj(sf)) Object.keys(sf).forEach(k => { if (sf[k] != null) m.set('sf|' + k, sf[k]); });
    const pin = readJSON(K.pin); if (Array.isArray(pin)) m.set('pin', pin);
    const ord = readJSON(K.ord); if (Array.isArray(ord)) m.set('ord', ord);
    PREFIXES.forEach(P => {
      const wb = readJSON(P + '_wrongbook');
      if (isObj(wb)) Object.keys(wb).forEach(q => { if (isObj(wb[q])) m.set(P + '|wb|' + q, wb[q]); });
      const hist = readJSON(P + '_history');
      if (Array.isArray(hist)) hist.forEach(h => { if (isObj(h) && h.date != null && !m.has(P + '|h|' + h.date)) m.set(P + '|h|' + h.date, h); });
      const done = readJSON(P + '_done');
      if (isObj(done)) Object.keys(done).forEach(f => m.set(P + '|d|' + f, 1));
      const prog = readJSON(P + '_inprogress'); if (isObj(prog)) m.set(P + '|prog', prog);
      const em = rawGet(P + '_exammode'); if (em === 'true' || em === 'false') m.set(P + '|em', em);
      const rc = rawGet(P + '_recite'); if (rc === 'true' || rc === 'false') m.set(P + '|rc', rc);
    });
    return m;
  }

  /* 这台设备第一次接上这个同步码时，本机已有的数据算「什么时候改的」：
     错题、练习记录、进度、做过的题自带时间，就用它（谁新用谁，逐条合）；
     设置类（文件夹、名字、顺序、开关）没有时间——云端已经有数据，就让云端的说了算（用一个比 1 还小的数），
     不然一台很久没用的电脑一接上，就会把手机上昨天才整理好的文件夹冲回旧样子 */
  function intrinsic(id, v) {
    let t = 0;
    if (id.indexOf('|wb|') > 0) t = Number(v.lastWrongAt);
    else if (id.indexOf('|h|') > 0) t = Number(v.date);
    else if (/\|prog$/.test(id)) t = Number(v.savedAt);
    else if (id.indexOf('|d|') > 0) return 1;
    return isFinite(t) && t > 0 ? t : null;
  }

  /* 刚从云端读到几条（同一次同步里，先读云端、再读本机）。-1＝还没读过：当作云端有数据，宁可让着云端也别冲掉它 */
  let lastPullCount = -1;

  function getLocal() {
    const meta = loadMeta(), items = meta.items, cur = current(), now = Date.now(), out = [];
    const seeding = !meta.seeded;
    let dirty = seeding;
    cur.forEach((v, id) => {
      const h = hash(JSON.stringify(v)), old = items[id];
      if (!old || old[0] !== h) {
        let t = now;
        if (!old && seeding) { const it = intrinsic(id, v); t = it != null ? it : (lastPullCount !== 0 ? hashFrac(h) : now); }
        items[id] = [h, t]; dirty = true;
      }
      out.push({ id: id, updatedAt: items[id][1], v: v });
    });
    Object.keys(items).forEach(id => {
      if (cur.has(id)) return;
      if (items[id][0] !== null) { items[id] = [null, now]; dirty = true; }       // 本机刚删掉的：记墓碑
      if (now - items[id][1] > TOMB_MS) { delete items[id]; dirty = true; return; }
      out.push({ id: id, updatedAt: items[id][1], deletedAt: items[id][1] });
    });
    if (seeding) meta.seeded = true;
    if (dirty) saveMeta(meta);
    return out;
  }

  /* 合并后的整份列表拼回各个键。只写真的变了的键，写了才通知页面重画 */
  function setLocal(list) {
    const meta = loadMeta(), items = meta.items, live = new Map(), dead = new Set(), stampOf = new Map();
    (list || []).forEach(e => {
      if (!e || !e.id) return;
      if (e.deletedAt) { dead.add(e.id); items[e.id] = [null, e.updatedAt || e.deletedAt]; }
      else { live.set(e.id, e.v); stampOf.set(e.id, e.updatedAt || 0); }
    });
    let changed = false;
    const put = (k, val, empty) => {
      if (empty && rawGet(k) === null) return;          // 本机原来就没有、合完也是空的：别平白多写一个键
      if (rawSet(k, JSON.stringify(val))) changed = true;
    };
    // 无原型对象：科目名、题号、指纹都是数据，普通 {} 遇到 "__proto__" 会出错（配方 §6.8）；JSON.stringify 照样能写
    const pick = pre => { const o = Object.create(null); live.forEach((v, id) => { if (id.indexOf(pre) === 0) o[id.slice(pre.length)] = v; }); return o; };

    const names = pick('n|'); put(K.names, names, !Object.keys(names).length);
    const fobj = pick('f|'), order = Array.isArray(live.get('fo')) ? live.get('fo') : [];
    const fl = order.filter(id => fobj[id]).map(id => fobj[id]);
    Object.keys(fobj).sort().forEach(id => { if (order.indexOf(id) < 0) fl.push(fobj[id]); });
    put(K.folders, fl, !fl.length && !live.has('fo'));
    const sf = pick('sf|'); put(K.sf, sf, !Object.keys(sf).length);
    ['pin', 'ord'].forEach(id => {
      if (Array.isArray(live.get(id))) put(K[id], live.get(id));
      else if (dead.has(id) && rawDel(K[id])) changed = true;
    });
    PREFIXES.forEach(P => {
      const wb = pick(P + '|wb|');
      // 别的设备移出了这道错题：本机也记一下移出时间，以后导入旧备份时它不会被放回来（跟本机自己移出一样）
      const curWb = readJSON(P + '_wrongbook'), removed = readJSON(P + '_wbremoved');
      const rm = isObj(removed) ? removed : {};
      let rmChanged = false;
      dead.forEach(id => {
        if (id.indexOf(P + '|wb|') !== 0) return;
        const q = id.slice((P + '|wb|').length);
        if (isObj(curWb) && curWb[q]) { rm[q] = Math.max(Number(rm[q]) || 0, items[id][1]); rmChanged = true; }
      });
      if (rmChanged) rawSet(P + '_wbremoved', JSON.stringify(rm));
      put(P + '_wrongbook', wb, !Object.keys(wb).length);
      const hist = []; live.forEach((v, id) => { if (id.indexOf(P + '|h|') === 0) hist.push(v); });
      hist.sort((a, b) => (Number(b.date) || 0) - (Number(a.date) || 0));
      put(P + '_history', hist.slice(0, HISTORY_MAX), !hist.length);
      const done = pick(P + '|d|'); Object.keys(done).forEach(f => { done[f] = 1; });
      put(P + '_done', done, !Object.keys(done).length);
      if (isObj(live.get(P + '|prog'))) put(P + '_inprogress', live.get(P + '|prog'));
      else if (dead.has(P + '|prog') && rawDel(P + '_inprogress')) changed = true;
      [['em', '_exammode'], ['rc', '_recite']].forEach(([s, suf]) => {
        const v = live.get(P + '|' + s);
        if (v === 'true' || v === 'false') { if (rawSet(P + suf, v)) changed = true; }
        else if (dead.has(P + '|' + s) && rawDel(P + suf)) changed = true;
      });
    });
    /* 修改记录只记**这台设备真存下来了的**（写完再读一遍）。存不下的——这台还是旧缓存的脚本、不认识新加的科目；
       值不合法；超过 100 条被挤掉的练习记录；存储满了——一律不记：记了的话下次读不到它，会被当成「本机删掉了」，
       墓碑一传，所有设备上都没了（/code-review 指出）。不记的话它只是这台设备上没有，云端那份照样留着 */
    const after = current();
    live.forEach((v, id) => {
      if (after.has(id)) items[id] = [hash(JSON.stringify(after.get(id))), stampOf.get(id)];
      else delete items[id];
    });
    saveMeta(meta);
    if (changed) { try { window.dispatchEvent(new Event('tiku-sync-applied')); } catch (e) { /* 老浏览器没有 Event 构造器：页面下次打开自然是新的 */ } }
  }

  /* 过期墓碑（删了 120 天以上）两头都滤掉：本机早就清了，云端那份不滤的话永远留着、每次同步都要再合一遍（/code-review 指出） */
  const fresh = list => (Array.isArray(list) ? list : []).filter(e => !(e && e.deletedAt && Date.now() - e.deletedAt > TOMB_MS));

  /* 包一层 fetch：读云端时记下云端有几条（getLocal 第一次接上同步码时要知道「云端是不是已经有数据」），顺带滤过期墓碑 */
  async function fetchWrap(url, init) {
    if (init && init.method === 'POST' && typeof init.body === 'string') {
      try { const b = JSON.parse(init.body); if (b && b.doc) { b.doc.items = fresh(b.doc.items); init = Object.assign({}, init, { body: JSON.stringify(b) }); } } catch (e) { /* 原样发 */ }
    }
    const r = await fetch(url, init);
    if (init && init.method && init.method !== 'GET') return r;
    let j = null; try { j = await r.json(); } catch (e) { j = null; }
    if (j && j.ok && j.doc) { j.doc.items = fresh(j.doc.items); lastPullCount = j.doc.items.length; }
    return { status: r.status, json: () => Promise.resolve(j) };
  }

  if (!window.SyncClient) return;   // 同步件没加载上（比如脚本 404）：页面照常用，只是没有同步
  const client = SyncClient.create({
    api: API, field: 'items', key: 'tiku_sync', debounce: 1000,
    getLocal: getLocal, setLocal: setLocal, fetch: fetchWrap,
    postType: CROSS ? 'text/plain;charset=UTF-8' : 'application/json'
  });
  /* 换了同步码（或第一次开）：本机的修改记录从头算，第一次同步时按上面 intrinsic 的规矩给已有数据定时间 */
  const enable0 = client.enable;
  client.enable = function (c) {
    const code = String(c == null ? '' : c).trim();
    if (SyncClient.CODE_RE.test(code) && loadMeta().code !== code) { saveMeta({ code: code, seeded: false, items: {} }); lastPullCount = -1; }
    return enable0(c);
  };

  /* 「什么时候改的」要按**改的那一刻**记，不能等到下次同步才发现：
     离线时、同步关着时改的东西，要是等联网/重新开同步那一刻才记时间，就会比别的设备真正更晚的改动还「新」，把它冲掉（/code-review 指出）。
     所以每次写存储（防抖 300ms）就扫一遍记下时间——只要这台设备接过同步码（第一次同步还没跑完时不扫，那时要按 intrinsic 的规矩定时间） */
  let stampTimer = 0, progTimer = 0;
  function stampNow() { clearTimeout(stampTimer); const m = loadMeta(); if (m.code && m.seeded) getLocal(); }
  /* 只是「继续上次练习」变了（填空时每打几个字就存一次草稿）：等停手 4 秒再传，免得一边打字一边整份上传、费流量。
     页面切走时这份等待立刻转成待传，跟着一起冲出去（下面的监听排在同步件自己的冲刷前面） */
  function progNow() { if (progTimer) { clearTimeout(progTimer); progTimer = 0; if (client.active()) client.schedule(); } }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') { stampNow(); progNow(); } });
  window.addEventListener('pagehide', () => { stampNow(); progNow(); });

  window.TikuSync = {
    client: client, api: API, PREFIXES: PREFIXES,
    /** 页面每次写了存储就喊一声（带上键名）：记下改动时间，防抖后同步 */
    changed: function (key) {
      if (key && /_wbremoved$/.test(key)) return;      // 移出记号不同步（本机推出来的）
      clearTimeout(stampTimer); stampTimer = setTimeout(stampNow, 300);
      if (!client.active()) return;
      if (key && /_inprogress$/.test(key)) { clearTimeout(progTimer); progTimer = setTimeout(progNow, 4000); return; }
      client.schedule();
    },
    _getLocal: getLocal, _setLocal: setLocal   // 给测试用
  };
  client.start();
})();
