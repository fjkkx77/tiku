const SEARCH = "https://api.deepseek.com/v1/tools/search";
const FETCH = "https://api.deepseek.com/v1/tools/fetch";
const limit = (text, size) => Array.from(String(text || "")).slice(0,size).join("");
const plain = value => typeof value === "string" ? value.replace(/\s+/g," ").trim() : "";
const recentQuestions = history => history.filter(turn=>turn.role==="user").map(turn=>turn.content.trim()).reverse();
const followUp = /^(?:(?:请)?再(?:查|给我|找|搜)|继续|还有(?:吗|哪些|什么|呢)|[这那]条|原文|来源|第.+条)/;

function calendar(timeZone, now = new Date()){
  let date;
  try {
    date = new Intl.DateTimeFormat("en-CA", {timeZone:timeZone || "UTC", dateStyle:"short"});
  } catch {
    date = new Intl.DateTimeFormat("en-CA", {timeZone:"UTC", dateStyle:"short"});
  }
  return { today:date.format(now), format:value=>date.format(value), now };
}

function shift(day, delta){
  const d = new Date(day + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0,10);
}

function timeWindow(question, today){
  question = question.replace(/(?:我|我们)?(?:今天|昨天|前天)\s*(?:在做|做|刷|练|学|遇到|碰到)这道题/g,"这道题");
  let start = today, end = today, relative = true;
  if(/昨天|昨日|\byesterday\b/i.test(question)) start = end = shift(today,-1);
  else if(/前天/.test(question)) start = end = shift(today,-2);
  else if(/今天|今日|今早|今晚|\btoday\b/i.test(question)) { /* 当前日 */ }
  else if(/这周|本周|这星期/.test(question)){
    const weekday = new Date(today + "T00:00:00Z").getUTCDay();
    start = shift(today,-((weekday + 6) % 7));
  } else if(/这个月|本月/.test(question)) start = today.slice(0,8) + "01";
  else {
    const recent = question.match(/(?:过去|最近|近)\s*(\d{1,2})\s*[天日]/);
    if(recent) start = shift(today,1-Math.min(90,Math.max(1,Number(recent[1]))));
    else if(/最新|近期|最近|这几天|过去一周|\b(latest|recent)\b/i.test(question)) start = shift(today,-6);
    else {
      const explicit = question.match(/\b(20\d{2})\s*[-\/年]\s*(\d{1,2})\s*[-\/月]\s*(\d{1,2})(?:\s*[日号])?(?!\d)/);
      if(!explicit) return null;
      const [,year,month,day] = explicit;
      start = end = year + "-" + month.padStart(2,"0") + "-" + day.padStart(2,"0");
      const date = new Date(start + "T00:00:00Z");
      if(!Number.isFinite(+date) || date.toISOString().slice(0,10) !== start) return null;
      relative = false;
    }
  }
  return {start,end,relative,label:start===end ? start : start+" 至 "+end};
}

function lookupPeriod(question,history,today){
  const own = timeWindow(question,today);
  if(own || !followUp.test(question.trim())) return own;
  for(const previous of recentQuestions(history)){
    const period = timeWindow(previous,today);
    if(period) return period;
    if(!followUp.test(previous)) break;
  }
  return null;
}

function queryFor(question, context, history, period){
  const questions = recentQuestions(history);
  const previous = questions.find(text=>!followUp.test(text)) || questions[0] || "";
  let topic = "";
  try { topic = plain(JSON.parse(context)?.题目?.text); } catch {}
  const referring = /^(?:给我|请结合我的作答讲解本题|[这那它其]|第.+个|继续|为什么|再查|解释|哪一|原文)/;
  let query = plain(question);
  if(referring.test(query) || followUp.test(query)){
    const background = limit(plain(previous) || topic,58);
    if(background) query = limit(query,68) + " " + background;
  }
  if(!period) return limit(query,128);
  // The provider filters by published date, then we check the exact local calendar range.
  const filters = " after:" + shift(period.start,-2) + " before:" + shift(period.end,2);
  query = query.replace(/\b(?:after|before):\S+/gi," ").trim();
  return limit(query || "新闻",128-filters.length) + filters;
}

function sourceUrl(value){
  if(typeof value !== "string" || value.length > 8192) return null;
  try {
    const url = new URL(value);
    if(!["https:","http:"].includes(url.protocol) || url.username || url.password) return null;
    url.hash = "";
    return url.href;
  } catch { return null; }
}

async function provider(url, body, key, signal, timeout){
  const response = await fetch(url,{
    method:"POST",
    headers:{Authorization:"Bearer " + key,"Content-Type":"application/json"},
    body:JSON.stringify(body),
    signal:AbortSignal.any([signal,AbortSignal.timeout(timeout)])
  });
  if(!response.ok) throw Error("DeepSeek web request failed");
  return response.json();
}

async function searchDocuments({question,context,history,clock,period,key,signal}){
  const requested = {query:queryFor(question,context,history,period),ori_question:limit(plain(question),128),count:period?16:8};
  const response = await provider(SEARCH,requested,key,signal,25000);
  if(!Array.isArray(response.results)) throw Error("DeepSeek did not return search results");
  const results = new Map();
  for(const item of response.results){
    const url = sourceUrl(item?.url);
    if(!url || results.has(url)) continue;
    const timestamp = typeof item.date === "string" && /T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/i.test(item.date) ? item.date : "";
    const instant = Date.parse(timestamp);
    const published = Number.isFinite(instant) && instant <= +clock.now ? clock.format(instant) : "";
    if(period && (!published || published < period.start || published > period.end)) continue;
    const snippet = plain(item.snippet) || plain(item.summary);
    if(!snippet) continue;
    results.set(url,{
      url, title:limit(plain(item.title) || new URL(url).hostname,160),
      published, snippet:limit(snippet,period?280:750),
      authority:Number(item.authority) || 0
    });
  }
  const found = [...results.values()].slice(0,5);
  if(!period && found.length){
    const best = found.find(source=>source.authority>=3) || found[0];
    try {
      const page = await provider(FETCH,{url:best.url},key,signal,8500);
      const content = typeof page.content === "string" ? page.content.trim() : "";
      if(content) best.content = content.slice(0,7000);
    } catch { signal.throwIfAborted(); }
  }
  return found;
}

function datedDigest(period,sources){
  const title = "### " + period.label + " 发布的资料";
  const escape = value => value.replace(/[\\~*_\x60<>\[\]#|$]/g,"\\$&");
  const items = sources.map(source=>"- **"+escape(source.title)+"**\n  "+escape(source.snippet));
  return [title,"按网页的发布日期筛选，摘要中提到的事件可能发生在其他日期。",...items].join("\n\n");
}

module.exports = {calendar,lookupPeriod,searchDocuments,datedDigest};
