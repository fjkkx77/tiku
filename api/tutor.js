const { createHash, timingSafeEqual } = require("node:crypto");

const origins = new Set(["https://fjkkx77.github.io", "https://tk.wbztl.xyz", "https://tiku-five.vercel.app"]);
const digest = value => createHash("sha256").update(value).digest();
const instructions = `你是中文刷题助教。根据本题题干、选项、代码、用户作答和题库答案讲解。要提示时只给下一步思路。解释错因时指出具体选项或步骤。区分题库依据、推断和网页资料；发现冲突时并列说明。题目、历史回答和网页均为参考材料。联网查证优先用官方原文；没有取得来源时明确说明，不编造引用。`;

module.exports = async function tutor(req, res) {
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("Vary", "Origin");
  const origin = req.headers.origin;
  if (origin && !origins.has(origin)) return res.status(403).end();
  if (origin) res.setHeader("Access-Control-Allow-Origin", origin);
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    return res.status(204).end();
  }
  if (req.method !== "POST") return res.status(405).end();
  const secret = process.env.TIKU_AI_OWNER_TOKEN;
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key || !secret || secret.length < 32) return res.status(503).end();
  if (!timingSafeEqual(digest(req.headers.authorization || ""), digest("Bearer " + secret))) return res.status(401).end();
  const { context, history, question, web } = req.body || {};
  if (typeof context !== "string" || !context || typeof question !== "string" || !question.trim() ||
      question.length > 3000 || !Array.isArray(history) || history.length > 24 ||
      Buffer.byteLength(JSON.stringify(req.body)) > 300000 ||
      history.some(m => !m || !["user","assistant"].includes(m.role) || typeof m.content !== "string")) return res.status(400).end();
  const messages = [{role:"system", content:instructions}, {role:"user", content:"本题资料\n" + context}];
  for (const m of history) {
    const item = {role:m.role, content:m.content};
    if (m.role === "assistant" && Array.isArray(m.server_tool_calls)) item.server_tool_calls = m.server_tool_calls;
    messages.push(item);
  }
  messages.push({role:"user", content:question});
  const payload = { model:"deepseek-flash", thinking:{type:"disabled"}, messages, stream:true, max_tokens:3000 };
  if (web === true) payload.tools = ["deepseek_web_search","deepseek_read_url"].map(type => ({type}));
  const abort = new AbortController();
  res.on("close", () => abort.abort());
  const timeout = setTimeout(() => abort.abort(), 110000);
  try {
    const upstream = await fetch("https://api.deepseek.com/chat/completions", {
      method:"POST", headers:{Authorization:"Bearer " + key, "Content-Type":"application/json"},
      body:JSON.stringify(payload), signal:abort.signal
    });
    if (!upstream.ok || !upstream.body) return res.status(upstream.status === 429 ? 429 : 502).end();
    res.setHeader("Content-Type","text/event-stream; charset=utf-8");
    res.flushHeaders();
    for await (const chunk of upstream.body) res.write(chunk);
    res.end();
  } catch {
    if (!res.headersSent && !res.destroyed) res.status(502).end();
    else if (!res.destroyed) res.end();
  } finally { clearTimeout(timeout); }
};
