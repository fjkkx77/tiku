/* 刷题合集 · 刷完几遍（passes.js）—— 2026-11-11 用户要的：完整刷完一个分类（一天 / 一个 DAY）的卡片上显示「✓ 刷完 N 遍」
   ─────────────────────────────────────────────────────────────
   首页（index.html）和科目页（quiz.js）都用它，算法只有这一份。

   什么算「刷完一遍」（用户 2026-11-11 定，按我推荐的）：
     一次练习里，这个分类的题**全部在这次练习里、全部答了**，到结果页就记一遍；答错的也算。
     一次勾几个分类一起练，每个都答完就各记一遍。只练了一部分（错题重练、不会的、只练没做过的且不是整个分类）不算。

   存哪：<科目前缀>_passes = { "<那次练习的记录时间>|<分类>": 1, ... }
     · 键用练习记录的时间（historyDate）：同一次练习从结果页「返回本次练习」再结束，还是同一个键，不会多记
     · 不放进练习记录 _history 里数：那边每科只留最近 100 条，天数多了旧的会被挤掉，遍数会越刷越少
     · 多设备同步按一条条走（tiku-sync.js 的 <前缀>|ps|<键>），取并集；导出备份也带上（合并＝并集）
     · 清空练习记录时一起清零（quiz.js clearHistoryBtn）

   以前的练习也补上（fromHistory）：功能上线前已经刷完的，从练习记录里认出来——
     记录只存了「范围」文字、总题数、对错数，没存题号，所以只认得出这种：
     范围是一个或几个分类名（「、」隔开，可带「（没做过的）」），或「全部<分类叫法>」；
     总题数正好等于这几个分类的题数之和，而且对 + 错 = 总题数（全答了）。
     「全部」要按**当时**有哪些分类算（2026-11-12 用户报：每日单词头两天只有 11月8日 一天，那时从 11月8日 卡片进去刷，
     范围也记成「全部日期」；按现在的 4 天 119 题去比，30 题对不上，就没认出来）。分类都是往后加的（每日单词按日期、
     四级按 DAY），当时的「全部」就是现在的前 k 个：找前 k 个题数之和正好等于总题数的那个 k（题数都是正数，最多一个 k）。 */
(function(){
  'use strict';
  const SUFFIX = '_passes';
  const SEP = '|';
  const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
  const num = v => { v = Number(v); return isFinite(v) ? v : 0; };

  function keyOf(date, cat) { return String(date) + SEP + cat; }
  function catOf(k) { const i = k.indexOf(SEP); return i > 0 ? k.slice(i + 1) : null; }
  function valid(k) { const i = k.indexOf(SEP); return i > 0 && /^\d+$/.test(k.slice(0, i)) && k.length > i + 1; }

  function load(prefix) {
    let v = null; try { v = JSON.parse(localStorage.getItem(prefix + SUFFIX)); } catch (e) { v = null; }
    const out = {};
    if (isObj(v)) Object.keys(v).forEach(k => { if (valid(k)) out[k] = 1; });
    return out;
  }
  /* 每个分类刷完几遍：{ 分类: 遍数 } */
  function counts(prefix) {
    const o = load(prefix), c = {};
    Object.keys(o).forEach(k => { const cat = catOf(k); c[cat] = (c[cat] || 0) + 1; });
    return c;
  }
  /* 加几条（已有的不重复记）。真加了才写存储、才喊同步；返回加了几条 */
  function add(prefix, keys) {
    const o = load(prefix); let n = 0;
    (keys || []).forEach(k => { if (valid(k) && !o[k]) { o[k] = 1; n++; } });
    if (!n) return 0;
    try { localStorage.setItem(prefix + SUFFIX, JSON.stringify(o)); } catch (e) { return 0; }
    if (window.TikuSync) window.TikuSync.changed(prefix + SUFFIX);
    return n;
  }
  function clear(prefix) {
    try { if (localStorage.getItem(prefix + SUFFIX) === null) return; localStorage.removeItem(prefix + SUFFIX); } catch (e) { return; }
    if (window.TikuSync) window.TikuSync.changed(prefix + SUFFIX);
  }

  /* 这一次练习刷完了哪些分类。queue：这次练习的题（每题有 id、cat），answered(i)：第 i 题答了没有，sizes：{分类: 题库里的题数} */
  function fullCats(queue, answered, sizes) {
    const got = {};
    (queue || []).forEach((q, i) => {
      if (!q || !answered(i)) return;
      (got[q.cat] = got[q.cat] || new Set()).add(q.id);
    });
    return Object.keys(got).filter(c => sizes[c] > 0 && got[c].size === sizes[c]);
  }

  /* 从练习记录里认出以前刷完的。sizes：{分类: 题数}，**按分类出现的先后排**（首页只知道有快捷入口的分类，认不出的就不认）；
     allLabel：「全部日期」这类范围文字——字符串（科目页知道自己的分类叫法）或正则（首页不知道，传 /^全部/） */
  function fromHistory(history, sizes, allLabel) {
    const out = [];
    (Array.isArray(history) ? history : []).forEach(h => {
      if (!isObj(h) || typeof h.scope !== 'string' || !/^\d+$/.test(String(h.date))) return;
      const total = num(h.total);
      if (total <= 0 || num(h.correct) + num(h.wrong) !== total) return;
      const label = h.scope.replace(/（没做过的）$/, '');
      let cats;
      const isAll = allLabel instanceof RegExp ? allLabel.test(label) : !!allLabel && label === allLabel;
      if (sizes[label] > 0) cats = [label];                            // 分类名自己带「、」也认得
      else if (isAll) {                                                // 当时的「全部」＝现在的前 k 个
        const order = Object.keys(sizes); let sum = 0; cats = [];
        for (const c of order) { sum += sizes[c]; cats.push(c); if (sum >= total) break; }
        if (sum !== total) return;
      }
      else cats = label.split('、');
      if (!cats.length || cats.some(c => !(sizes[c] > 0))) return;
      if (cats.reduce((a, c) => a + sizes[c], 0) !== total) return;
      cats.forEach(c => out.push(keyOf(h.date, c)));
    });
    return out;
  }

  window.TikuPasses = { SUFFIX, keyOf, catOf, load, counts, add, clear, fullCats, fromHistory };
})();
