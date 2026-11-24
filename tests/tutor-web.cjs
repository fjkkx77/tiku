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
  assert.equal(r.calls.filter(call=>call.url.endsWith("/search")).length,3);
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
  const r = await request(url=>url.endsWith("/search")?result([stale,undated]):new Response("",{status:404}));
  assert.equal(r.calls.filter(call=>call.url.endsWith("/search")).length,3);
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
  assert.equal(r.calls.length,3);
  assert.match(r.output,/tutor_web/);
});

test("不同查询结果能补齐首组缺失的当天资料，旧闻不会混入当天",async()=>{
  let attempt=0;
  const r=await request(url=>url.endsWith("/search")?result(++attempt===1?[stale,todayWithUnknownDate()]:[today,stale]):staleModel(),{question:"今日AI大事"});
  assert.equal(r.calls.filter(call=>call.url.endsWith("/search")).length,3);
  assert.match(r.calls[1].body.query,/人工智能|新闻/);
  assert.match(r.calls[2].body.query,/artificial intelligence/);
  assert.ok(r.output.includes(today.url));
  assert.ok(!r.output.includes(stale.url));
});

function todayWithUnknownDate(){
  return {...today,url:"https://example.org/undated-current",date:null};
}

test("搜索未标日期而原网页明确标出发布日期时，可核实后纳入",async()=>{
  const document=todayWithUnknownDate();
  const r=await request(url=>url.endsWith("/search")?result([document]):Response.json({content:"# 公告\n\n**发布时间**："+day+"\n\n网页正文。"}));
  assert.equal(r.calls.filter(x=>x.url.endsWith("/fetch")).length,1);
  assert.ok(r.output.includes(document.url));
  assert.ok(r.output.includes('"page":'));
});

test("当天无结果时近日资料单列，只看今天的要求保持严格",async()=>{
  const old=new Date(+current-86400000);
  const recent={...today,date:old.toISOString(),url:"https://example.org/recent",title:"昨天的资料"};
  const provider=url=>url.endsWith("/search")?result([recent,stale]):staleModel();
  const ordinary=await request(provider);
  assert.match(ordinary.output,/较早的参考资料/);
  assert.ok(ordinary.output.includes(recent.url));
  assert.ok(!ordinary.output.includes(stale.url));
  const strict=await request(provider,{question:"只看今天的 AI 新闻"});
  assert.ok(!strict.output.includes(recent.url));
  assert.match(strict.output,/已用 3 组关键词/);
});

test("默认沿用知识库的北京时间，电脑设美西仍能找到亚洲当天报道",async()=>{
  const early = new Date(day+"T00:00:00+08:00");
  const instant = new Date(Math.min(+early+8*3600000,+current));
  const article={...today,url:"https://example.org/beijing-morning",date:instant.toISOString()};
  const r=await request(url=>url.endsWith("/search")?result([article]):staleModel(),{timeZone:"America/Los_Angeles",question:"今日AI大事"});
  assert.ok(r.output.includes("北京时间"));
  assert.ok(r.output.includes(article.url));
  assert.doesNotMatch(r.output,/较早的参考资料/);
});

test("今日 AI 大事合并中英文检索，读取原文并按事件出简报",async()=>{
  const chinese={...today,url:"https://example.org/research",snippet:"團隊公佈新研究，涉及三個學科。"};
  const syndicated={...chinese,url:"https://media.example/reprint"};
  const english={...today,url:"https://lab.example/noise",title:"Lab announcement",snippet:"The lab published a new benchmark."};
  const original="The new benchmark reduces measurement noise by 20%. The team released the test protocol to enable independent validation.";
  const r=await request((url,body)=>{
    if(url.endsWith("/search")){
      const hits=body.query.includes("announcements") ? [english] : [chinese,syndicated];
      return result([...hits,{...today,url:"https://directory.example/"}]);
    }
    if(url.endsWith("/fetch")){
      return body.url===english.url ? Response.json({content:original}) : new Response("",{status:404});
    }
    assert.equal(body.response_format?.type,"json_object");
    const {evidence}=JSON.parse(body.messages[1].content);
    const id=text=>evidence.find(item=>item.text===text)?.id;
    const cite={id:id(original),quote:"The new benchmark reduces measurement noise by 20%."};
    const reply={items:[
      {title:"跨学科研究公布",body:"研究团队把几个学科的方法用在同一项研究中。",references:[{id:id(chinese.snippet),quote:chinese.snippet}]},
      {title:"实验室开放测量基准",body:"实验室称新基准让测量噪声降低了20%。",references:[cite]},
      {title:"相同证据的重复条目",body:"换一种说法再报一遍。",references:[cite]},
      {title:"不实数字",body:"团队声称噪声减少999%。",references:[cite]}
    ]};
    return Response.json({choices:[{message:{content:JSON.stringify(reply)}}]});
  });
  const completion = r.calls.find(call=>call.url.endsWith("/completions")).body;
  assert.equal(completion.thinking?.type,"enabled");
  assert.equal(completion.reasoning_effort,"max");
  assert.equal(completion.max_tokens,32768);
  assert.ok(r.calls.some(call=>call.body.query?.includes("announcements")));
  assert.ok(r.calls.some(call=>call.url.endsWith("/fetch") && call.body.url===english.url));
  assert.match(r.output,/跨学科研究公布/);
  assert.match(r.output,/噪声降低了20%。 〔1〕/);
  assert.match(r.output,/据搜索摘要/);
  assert.match(r.output,/"tutor_brief":\{"searched":3,"read":1\}/);
  assert.doesNotMatch(r.output,/999%|重复条目|directory\.example/);
});

test("摘要的数字及模型自造的链接都不进入简报正文",async()=>{
  const snippet="報道提到市場上漲20%，並介紹背景。";
  const r=await request(url=>{
    if(url.endsWith("/search")) return result([{...today,snippet}]);
    if(url.endsWith("/fetch")) return new Response("",{status:404});
    const references=[{id:1,quote:snippet}];
    return Response.json({choices:[{message:{content:JSON.stringify({items:[
      {title:"市场数据",body:"市场上涨20%。",references},
      {title:"市场走强",body:"详情参见 https://unknown.example",references}
    ]})}}]});
  });
  assert.match(r.output,/未能生成有足够依据的简报/);
  assert.doesNotMatch(r.output,/20%|unknown\.example/);
  assert.ok(r.output.includes(today.url));
});
