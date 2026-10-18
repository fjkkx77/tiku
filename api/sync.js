/**
 * 刷题合集 · 多设备同步接口（Vercel 函数，部署在 tk.wbztl.xyz）
 *
 * 照日程卡片的 api/sync.js（存档 references/项目_日程卡片/api/sync.js，已对真实 Upstash 测过并发写入）改的，改了四处：
 *   1. 键前缀和盐换成刷题合集自己的（tiku: / tkv1|）——跟日程卡片共用一个 Upstash 库（用户 2026-10-19 定），
 *      换了前缀两边的数据就不可能串
 *   2. 数据字段叫 items；上限按刷题数据估的（最坏情况：8 科 581 题全进错题本 + 全做过 + 练习记录，约 460KB、2000 来条）
 *   3. 页面在 GitHub Pages（fjkkx77.github.io），接口在这里：跨域只放行这一个来源
 *   4. 不要 space 分区（刷题合集只有一份数据）
 *
 * 存储用 Upstash Redis 的 REST 接口，整个文件零依赖（Node 自带 fetch + crypto）。
 * 环境变量两套命名都认：KV_REST_API_URL / KV_REST_API_TOKEN、UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN
 *
 * 接口：
 *   GET  /api/sync                 → 探测：这个部署是否配好了同步
 *   GET  /api/sync?code=xxxx       → 取回该同步码下的数据 {ok, version, doc:{items}}
 *   POST /api/sync  {code, baseVersion, doc:{items}}
 *        → baseVersion 与服务端当前版本一致才写入；不一致返回 409 + 服务端最新数据
 *   POST 的请求体可以是 application/json，也可以是 text/plain（跨域时客户端用它，免得浏览器先发预检）
 */

const crypto = require("crypto");

const MAX_BODY_BYTES = 1536 * 1024;  /* 一份数据最大 1.5MB：最坏情况估出来约 460KB，留三倍余量 */
const MAX_ITEMS = 12000;
const TTL_SECONDS = 400 * 24 * 3600; /* 每次写入续期，长期不用才自动过期 */
/* 同源（tk.wbztl.xyz 自己）不用列。SYNC_EXTRA_ORIGINS（逗号分隔）只给本地测试用：tests/sync.cjs 拿另一个端口当「GitHub Pages」 */
const ALLOWED_ORIGINS = ["https://fjkkx77.github.io"].concat(String(process.env.SYNC_EXTRA_ORIGINS || "").split(",").filter(Boolean));

function creds(){
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return (url && token) ? { url: url.replace(/\/+$/, ""), token } : null;
}

async function redis(command){
  const c = creds();
  const r = await fetch(c.url, {
    method: "POST",
    headers: { Authorization: "Bearer " + c.token, "Content-Type": "application/json" },
    body: JSON.stringify(command)
  });
  if(!r.ok){
    const t = await r.text().catch(() => "");
    throw new Error("存储服务返回 " + r.status + " " + t.slice(0, 200));
  }
  const j = await r.json();
  return j.result;
}

/* 同步码本身不落库，只存它的哈希，拿到数据库也反推不出同步码 */
function keyOf(code){
  return "tiku:" + crypto.createHash("sha256").update("tkv1|" + code).digest("hex").slice(0, 40);
}

/* 原子的「版本对得上才写」（照日程卡片，2026-10-08 实测先读再写两台同时写 10 次 10 次被覆盖）。
   返回 {1, 新版本} 或 {0, 当前版本, 当前整份数据}。脚本只用字符串匹配取版本号，所以存进去的 JSON 第一个字段必须是 version */
const CAS_SCRIPT = [
  "local cur = redis.call('GET', KEYS[1])",
  "local v = 0",
  "if cur then v = tonumber(string.match(cur, '^{\"version\":(%d+)')) or 0 end",
  "if v ~= tonumber(ARGV[1]) then return {0, v, cur or ''} end",
  "redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[3])",
  "return {1, v + 1}"
].join("\n");

function cleanCode(v){
  const s = String(v == null ? "" : v).trim();
  return /^[A-Za-z0-9\-_]{8,64}$/.test(s) ? s : null;
}

function cors(req, res){
  const origin = req.headers && req.headers.origin;
  if(origin && ALLOWED_ORIGINS.indexOf(origin) > -1){
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Access-Control-Max-Age", "86400");
  }
  res.setHeader("Vary", "Origin");
}

function send(res, status, obj){
  res.status(status);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(obj));
}

module.exports = async (req, res) => {
  try{
    cors(req, res);
    if(req.method === "OPTIONS"){ res.status(204); res.end(); return; }

    const configured = !!creds();

    if(req.method === "GET"){
      const raw = (req.query && req.query.code) || "";
      if(!raw) return send(res, 200, { ok: true, configured });   /* 探测用 */
      if(!configured) return send(res, 503, { ok: false, error: "服务端还没配置存储（缺少 Upstash 环境变量）" });

      const code = cleanCode(raw);
      if(!code) return send(res, 400, { ok: false, error: "同步码只能是 8~64 位的字母、数字、- 或 _" });

      const val = await redis(["GET", keyOf(code)]);
      if(!val) return send(res, 200, { ok: true, version: 0, doc: { items: [] }, empty: true });

      let parsed;
      try{ parsed = JSON.parse(val); }
      catch(e){ return send(res, 500, { ok: false, error: "服务端数据损坏" }); }
      return send(res, 200, {
        ok: true,
        version: parsed.version || 0,
        updatedAt: parsed.updatedAt || 0,
        doc: { items: Array.isArray(parsed.items) ? parsed.items : [] }
      });
    }

    if(req.method === "POST"){
      if(!configured) return send(res, 503, { ok: false, error: "服务端还没配置存储（缺少 Upstash 环境变量）" });

      let body = req.body;
      if(Buffer.isBuffer(body)) body = body.toString("utf8");
      if(typeof body === "string"){
        try{ body = JSON.parse(body); }catch(e){ return send(res, 400, { ok:false, error:"请求体不是合法 JSON" }); }
      }
      if(!body || typeof body !== "object") return send(res, 400, { ok: false, error: "缺少请求体" });

      const code = cleanCode(body.code);
      if(!code) return send(res, 400, { ok: false, error: "同步码只能是 8~64 位的字母、数字、- 或 _" });

      const items = body.doc && Array.isArray(body.doc.items) ? body.doc.items : null;
      if(!items) return send(res, 400, { ok: false, error: "缺少 doc.items" });
      if(items.length > MAX_ITEMS) return send(res, 413, { ok: false, error: "条数超过上限 " + MAX_ITEMS });

      const base = Number(body.baseVersion || 0);
      const next = { version: base + 1, updatedAt: Date.now(), items: items };
      const text = JSON.stringify(next);
      if(Buffer.byteLength(text, "utf8") > MAX_BODY_BYTES){
        return send(res, 413, { ok: false, error: "数据超过 1.5MB 上限" });
      }

      const r = await redis(["EVAL", CAS_SCRIPT, "1", keyOf(code), String(base), text, String(TTL_SECONDS)]);
      if(Number(r[0]) !== 1){
        /* 另一台设备抢先写了：把最新版还给客户端，让它重新合并后再来一次 */
        let cur = [];
        try{ const p = JSON.parse(r[2] || "null"); if(p && Array.isArray(p.items)) cur = p.items; }
        catch(e){ /* 坏数据当作空 */ }
        return send(res, 409, { ok: false, conflict: true, version: Number(r[1]) || 0, doc: { items: cur } });
      }
      return send(res, 200, { ok: true, version: next.version, updatedAt: next.updatedAt });
    }

    res.setHeader("Allow", "GET, POST, OPTIONS");
    return send(res, 405, { ok: false, error: "只支持 GET / POST" });
  }catch(err){
    return send(res, 500, { ok: false, error: String(err && err.message || err) });
  }
};
