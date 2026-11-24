const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { test } = require("node:test");
const tutor = require("../api/tutor");
const {calendar,lookupPeriod} = require("../lib/tutor-web");

const current = new Date();
const day = new Intl.DateTimeFormat("en-CA", {timeZone:"Asia/Shanghai",dateStyle:"short"}).format(current);
const today = {title:"今天发布的官方说明",url:"https://example.org/current",date:current.toISOString(),snippet:"这是一条当天发布的资料。"};
const stale = {title:"6 月 25 日的旧闻",url:"https://example.org/old",date:"2026-06-25T10:00:00Z",snippet:"旧闻不可混入当天结果。"};
const undated = {title:"未知日期",url:"https://example.org/unknown",date:null,snippet:"未知日期。"};
const result = (items) => Response.json({results:items});
const staleModel = () => new Response('data: {"choices":[{"delta":{"content":"今日 AI 大事（2026-06-25）"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');

async function request(fetcher, input = {}){
  const original = global.fetch;
  const calls = [];
  process.env.TIKU_AI_OWNER_TOKEN = "x".repeat(32);
  process.env.DEEPSEEK_API_KEY = "fixture";
  global.fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    calls.push({url,body});
    return fetcher(url,body);
  };
  const res = Object.assign(new EventEmitter(),{
    buffer:[], setHeader(){}, status(code){this.code=code;return this;},
    flushHeaders(){this.headersSent=true;},
    write(data){this.buffer.push(typeof data === "string" ? data : Buffer.from(data).toString("utf8"));},
    end(data){if(data) this.write(data);}
  });
  try {
    await tutor({
      method:"POST",headers:{authorization:"Bearer "+"x".repeat(32)},
      body:{context:'{"题目":{"text":"Linux 网络编程"}}',history:[],question:"今天的 AI 大事",timeZone:"Asia/Shanghai",web:true,...input}
    },res);
    return {code:res.code || 200,output:res.buffer.join(""),calls};
  } finally { global.fetch = original; }
}

test("当天新闻先实际搜索，剔除旧闻、无日期和重复链接，日期不由模型生成",async () => {
  const duplicate = {...today,url:today.url+"#duplicate"};
  const r = await request(url=>url.endsWith("/search")?result([stale,undated,today,duplicate]):staleModel());
  assert.equal(r.calls.length,1);
  assert.ok(r.calls[0].url.endsWith("/v1/tools/search"));
  assert.match(r.calls[0].body.query,/after:\d{4}-\d\d-\d\d before:\d{4}-\d\d-\d\d/);
  assert.ok(r.output.includes(day));
  assert.ok(r.output.includes(today.url));
  assert.equal(r.output.includes(stale.url),false);
  assert.equal(r.output.includes(undated.url),false);
  assert.equal(r.output.includes("2026-06-25"),false);
  assert.equal((r.output.match(/example\.org\/current/g) || []).length,1);
  assert.ok(r.output.includes("[DONE]"));
});

test("午夜按提问者时区，追问沿用本题的日期范围",() => {
  const instant = new Date("2026-11-23T17:30:00.000Z");
  const tz = calendar("Asia/Shanghai",instant);
  assert.equal(tz.today,"2026-11-24");
  assert.equal(calendar("America/Los_Angeles",instant).today,"2026-11-23");
  assert.equal(lookupPeriod("再查一次",[{role:"user",content:"今天的 AI 大事"}],tz.today).label,"2026-11-24");
  assert.equal(lookupPeriod("还有呢",[{role:"user",content:"今天的 AI 大事"},{role:"user",content:"再查一次"}],tz.today).label,"2026-11-24");
  assert.equal(lookupPeriod("我今天做这道题，选项 C 为什么不对？",[],tz.today),null);
  assert.equal(lookupPeriod("那昨天",[{role:"user",content:"今天的 AI 大事"}],tz.today).label,"2026-11-23");
});

test("只有旧闻时不会调用模型凑一篇今日新闻",async () => {
  const r = await request(url=>url.endsWith("/search")?result([stale,undated]):staleModel());
  assert.equal(r.calls.length,1);
  assert.match(r.output,/未查到/);
  assert.equal(r.output.includes(stale.title),false);
});

test("未开启联网时，时效问题提醒开启查证",async () => {
  const r = await request(staleModel,{web:false});
  assert.equal(r.calls.length,0);
  assert.match(r.output,/本轮联网查证/);
});

test("普通联网追问带回问题上下文，从实际读到的网页生成", async () => {
  const r = await request(url=>{
    if(url.endsWith("/search")) return result([today]);
    if(url.endsWith("/fetch")) return Response.json({content:"官方手册正文"});
    return staleModel();
  },{question:"这是什么意思？",history:[{role:"user",content:"解释 Linux 的 rwx 文件权限"},{role:"assistant",content:"过往解释"}]});
  assert.deepEqual(r.calls.map(x=>x.url.split("/").at(-1)),["search","fetch","completions"]);
  assert.match(r.calls[0].body.query,/rwx/);
  assert.equal(r.calls[1].body.url,today.url);
  assert.match(JSON.stringify(r.calls[2].body.messages),/官方手册正文/);
  assert.equal(r.calls[2].body.tools,undefined);
  assert.match(r.output,/page/);
});

test("Search API 失败时发可重试错误，普通回答不冒充联网成功",async () => {
  const r = await request(url=>url.endsWith("/search")?new Response("",{status:502}):staleModel());
  assert.equal(r.calls.length,1);
  assert.match(r.output,/tutor_web/);
});
