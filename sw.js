/* 刷题合集 · 离线缓存
   只做一件事：有网时照常从网络拿（顺手存一份），断网时用上次存下来的那份。
   永远「先网络、后缓存」，所以不会让人卡在旧版本上；不预先缓存任何东西，打开过哪个科目，哪个科目就能离线用。
   错题本、练习记录存在 localStorage，和这里无关。 */
const CACHE = "tiku-offline-v1";
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE && k.indexOf("tiku-offline-") === 0).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  // 只管本站自己目录下的文件（同一个域名下还有别的项目，不碰它们）
  const scope = new URL(self.registration.scope).pathname;
  if (url.pathname.indexOf(scope) !== 0) return;
  e.respondWith(
    fetch(req).then(res => {
      if (res && res.ok && res.type === "basic") { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {}); }
      return res;
    }).catch(() => caches.match(req).then(hit => hit || caches.match(req, { ignoreSearch: true })).then(hit => hit || Response.error()))
  );
});
