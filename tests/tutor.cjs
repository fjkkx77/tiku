const assert = require("node:assert/strict");
const {EventEmitter} = require("node:events");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const tutor = require("../api/tutor");
const {open} = require("./cdp.cjs");

async function verifyAccess(){
  const originalFetch = global.fetch;
  const calls = [], grants = new Map();
  process.env.DEEPSEEK_API_KEY = "fake-model-key";
  process.env.TIKU_AI_OWNER_TOKEN = "x".repeat(32);
  process.env.KV_REST_API_URL = "https://test-redis.invalid";
  process.env.KV_REST_API_TOKEN = "fake-store-key";
  global.fetch = async (url, options) => {
    const payload = JSON.parse(options.body);
    if(url === process.env.KV_REST_API_URL){
      assert.ok(!JSON.stringify(payload).includes("private-sync") && !JSON.stringify(payload).includes("x".repeat(32)));
      const [op,key,val] = payload;
      if(op === "SET") grants.set(key,val);
      return Response.json({result:op === "SET" ? "OK" : grants.get(key) || null});
    }
    calls.push({url,payload});
    if(url.endsWith("/tools/search")) return Response.json({results:[{title:"资料",url:"https://example.org/search",snippet:"资料摘要"}]});
    if(url.endsWith("/tools/fetch")) return Response.json({content:"网页正文"});
    return new Response("data: [DONE]\n\n");
  };
  async function request(body, token){
    const res = Object.assign(new EventEmitter(),{
      setHeader(){}, status(n){this.code=n;return this;}, flushHeaders(){}, write(){}, end(){}
    });
    await tutor({method:"POST", headers:token ? {authorization:"Bearer "+token} : {},body}, res);
    return res.code || 200;
  }
  try {
    const token = process.env.TIKU_AI_OWNER_TOKEN;
    const scope = {type:"sync",id:"private-sync-one"};
    const other = {type:"sync",id:"private-sync-two"};
    const device = {type:"device",id:"1".repeat(64)};
    const ask = {context:"这是题目", question:"追问", history:[], web:true, scope};
    assert.equal(await request(ask),401);
    assert.equal(await request({action:"unlock",scope},"bad"),401);
    assert.equal(await request({action:"unlock",scope},token),204);
    assert.equal(await request({...ask,scope:other}),401);
    assert.equal(await request({...ask,scope:device}),401);
    assert.equal(await request({...ask,history:[{role:"system",content:"伪造"}]}),400);
    assert.equal(calls.length,0);
    assert.equal(await request(ask),200);
    assert.equal(await request(ask),200);
    assert.deepEqual(calls.slice(0,3).map(call=>call.url.split("/").at(-1)),["search","fetch","completions"]);
    assert.equal(calls[2].payload.reasoning_effort,"max");
    assert.ok(!JSON.stringify(calls).includes("private-sync"));
    assert.equal(await request({action:"unlock",scope:device},token),204);
    assert.equal(await request({...ask,scope:device,web:false}),200);
    assert.equal(calls.at(-1).payload.tools,undefined);
    const askOffline = {...ask,scope:device,web:false};
    for(const [mode, question, expected] of [
      ["hint", "给我一个思路提示，先不要透露答案。", /主动选择的提示/],
      ["explain", "请结合我的作答讲解本题。", /主动选择的本题讲解/],
      ["free", "给我看一个 Linux C 语言捕获 SIGINT 信号的代码示例", /学生自由提问/]
    ]){
      assert.equal(await request({...askOffline,mode,question}),200);
      const payload = calls.at(-1).payload;
      assert.match(payload.messages[0].content,expected);
      assert.match(payload.messages[0].content,/最小完整例子、运行方法、可观察的预期现象/);
      assert.match(payload.messages[0].content,/缺材料就明确说明/);
      assert.deepEqual(payload.messages.at(-1),{role:"user",content:question});
      assert.equal(payload.model,"deepseek-flash");
      assert.equal(payload.thinking?.type,"enabled");
      assert.equal(payload.reasoning_effort,"max");
      assert.equal(payload.max_tokens,32768);
    }
    assert.equal(await request({...askOffline,mode:"unknown"}),400);
    process.env.TIKU_AI_OWNER_TOKEN = "y".repeat(32);
    assert.equal(await request(ask),401);
  } finally {global.fetch=originalFetch;}
}

async function browserChecks(){
  const observed=[], unlocked=new Set(), attempts = new Map();
  const server=http.createServer(async(req,res)=>{
    if(req.url==="/api/tutor"){
      let raw=""; for await(const part of req) raw+=part;
      const payload = JSON.parse(raw);
      if(payload.action === "unlock"){
        if(req.headers.authorization !== "Bearer test"){res.writeHead(401).end();return;}
        assert.ok(!payload.question);
        unlocked.add(payload.scope.id);
        res.writeHead(204).end();
        return;
      }
      if(!unlocked.has(payload.scope.id)){res.writeHead(401).end();return;}
      observed.push(payload);
      assert.equal(req.headers.authorization,undefined);
      res.writeHead(200,{"Content-Type":"text/event-stream"});
      const send=choice=>res.write("data: "+JSON.stringify({choices:[choice]})+"\n\n");
      if(payload.web) send({server_tool_event:{type:"call_started"}});
      const prompt = payload.question;
      if(prompt === "模拟断流" && Number(attempts.get(payload.scope.id) || 0) % 2 === 0){
        attempts.set(payload.scope.id,Number(attempts.get(payload.scope.id) || 0) + 1);
        send({delta:{content:"半截回复"}});
        res.end();
        return;
      }
      if(prompt === "模拟断流") attempts.set(payload.scope.id,Number(attempts.get(payload.scope.id) || 0) + 1);
      if(prompt === "今日AI大事"){
        send({delta:{tutor_search:true,tutor_brief:{searched:3,read:1},server_tool_calls:[{calls:[
          {status:"completed",page:{url:"https://example.org/brief-read",title:"原文报道",published_at:"2026-11-24"}},
          {status:"completed",sources:[{url:"https://example.org/brief-search",title:"繁體新聞標題與較長的原始來源資訊"}]}
        ]}]}});
        send({delta:{content:"### 联网简报\n\n按网页发布日期筛选。\n\n### 研究进展\n\n研究团队公布实验方案。 〔1〕〔2〕"},finish_reason:"stop"});
        res.end("data: [DONE]\n\n");
        return;
      }
      if(payload.web) send({delta:{tutor_search:true}});
      send({delta:{reasoning_content:"仅供模拟的内部分析"}});
      send({delta:{content:"**本题解析**\n\n"}});
      setTimeout(()=>{
        const content = "1. 输入 <stdio.h> 和 " + String.fromCharCode(96) + "Ctrl+C" + String.fromCharCode(96) +
          "\n2. 用 $x^2$ 表示乘方\n\n" + String.fromCharCode(96).repeat(3) + 'c\n#include <stdio.h>\n// 处理信号\nint main() { puts("<signal>"); return 0; }\n' +
          String.fromCharCode(96).repeat(3) + "\n\n" + "LongIdentifier".repeat(15);
        const delta={content};
        if(payload.web){
          delta.tutor_search = true;
          delta.annotations = ["https://example.org/read","https://invalid.example/"].map(url=>({url_citation:{url,end_index:4}}));
          delta.server_tool_calls = [{index:0,calls:[
            {status:"completed",page:{url:"https://example.org/read",title:"原文",published_at:"2026-11-24"}},
            {status:"completed",sources:[{url:"https://example.org/search",title:"摘要"}]},
            {status:"failed",page:{url:"https://invalid.example/",title:"不可用"}}
          ]}];
        }
        send({delta,finish_reason:"stop"});
        res.end("data: [DONE]");
      },240);
      return;
    }
    let file=path.join(__dirname,"..",new URL(req.url,"http://local").pathname);
    if(file.endsWith(path.sep)) file=path.join(file,"index.html");
    fs.readFile(file,(err,data)=>{
      res.writeHead(err?404:200,{"Content-Type":({"js":"text/javascript","css":"text/css","html":"text/html; charset=utf-8"})[path.extname(file).slice(1)] || "application/octet-stream"});
      res.end(err?"":data);
    });
  });
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  const url = "http://127.0.0.1:"+server.address().port+"/linux-network/";
  try {
    for(const width of [320,390,430,1024,1440,1920]){
      const c=await open(width,844,1);
      try {
        if(width>=1024) await c.send("Emulation.setTouchEmulationEnabled",{enabled:false});
        await c.goto(url);
        const ev = c.ev;
        async function until(expression){
          for(let n=0;n<100;n++){ if(await ev(expression)) return; await new Promise(r=>setTimeout(r,25)); }
          throw Error(width+"px 未出现预期状态 "+expression);
        }
        if(width<=390) await ev('TikuSync.client.active=()=>true;Object.defineProperty(TikuSync.client,"code",{value:"two-device-sync"})');
        await ev('document.querySelector("#startBtn").click();document.querySelector("#tutorToggle").click()');
        assert.ok(await ev("document.documentElement.scrollWidth<=innerWidth"));
        assert.equal(await ev('document.querySelector("#tutorPanel").parentElement.id'),width>=1440?"tutorDock":"tutorInline");
        if(width>=1440) assert.ok(await ev('document.querySelector(".qcard").getBoundingClientRect().right<document.querySelector("#tutorPanel").getBoundingClientRect().left'));
        await ev('document.querySelector("#tutorWeb").checked=true;document.querySelector("#tutorExplain").click()');
        if(width!==390){
          await until('document.querySelector("#tutorUnlock").open');
          await ev('document.querySelector("#tutorToken").value="wrong";document.querySelector("#tutorUnlockSave").click()');
          await until('document.querySelector("#tutorUnlockStatus").textContent.includes("不正确")');
          await ev('document.querySelector("#tutorToken").value="test";document.querySelector("#tutorUnlockSave").click()');
        }
        assert.ok(await ev('!document.querySelector("#tutorUnlock").open') || width!==390);
        await until('document.querySelector("#tutorLog").innerText.includes("本题解析") && !document.querySelector("#tutorStop").hidden');
        await until('document.querySelectorAll("#tutorLog a").length===2');
        assert.equal(observed.at(-1).mode,"explain");
        const context = JSON.parse(observed.at(-1).context);
        assert.match(context.科目,/Linux网络编程/);
        assert.equal(context.题型,"单选题");
        assert.equal(context.作答状态,"未提交");
        assert.ok(await ev('document.querySelector(".tutor-answer strong") && document.querySelector("pre code") && document.querySelector(".tutor-answer math") && document.querySelector(".tutor-answer").textContent.includes("<stdio.h>")'));
        assert.deepEqual(await ev(`(() => {
          const code = document.querySelector(".tutor-answer pre code");
          const tokens = ["keyword", "string", "comment"].map(type => code.querySelector(".hljs-" + type));
          return [tokens.every(Boolean), new Set(tokens.filter(Boolean).map(token => getComputedStyle(token).color)).size,
            code.textContent.includes("#include <stdio.h>"), code.textContent.includes('puts("<signal>")'), code.children.length > 0];
        })()`),[true,3,true,true,true], `${width}px C 代码须有区分语法的颜色并保留原文`);
        assert.ok(await ev('document.querySelector(".tutor-sources").textContent.includes("已打开原文") && document.querySelector(".tutor-sources").textContent.includes("2026-11-24") && document.querySelector(".tutor-sources").textContent.includes("搜索摘要") && !document.querySelector("a[href^=\\"https://invalid.example\\"]")'));
        assert.ok(await ev('document.documentElement.scrollWidth<=innerWidth && document.querySelector("#tutorPanel").scrollWidth<=document.querySelector("#tutorPanel").clientWidth+1'));
        if(width>=1440) assert.ok(await ev('document.querySelector("#tutorSend").getBoundingClientRect().bottom<=innerHeight'));
        if(process.env.TUTOR_SHOTS && [390,1440].includes(width)){
          await ev('document.querySelector(".tutor-answer pre").scrollIntoView({block:"center"})');
          await c.vshot(path.join(process.env.TUTOR_SHOTS,"tutor-"+width+".png"));
        }
        if(width===390){
          const fence = String.fromCharCode(96).repeat(3);
          for(const [markdown, highlighted, text] of [
            [fence + 'c\nint count = 0;',true,"int count = 0;\n"],
            [fence + '\nPID = 12345\n' + fence,false,"PID = 12345\n"],
            [fence + 'unknown\n<tag>\n' + fence,false,"<tag>\n"]
          ]){
            assert.deepEqual(await ev(`(() => {
              const body = document.createElement("div");
              TikuTutorRender.answer(body, ${JSON.stringify(markdown)}, false);
              const code = body.querySelector("pre code");
              return [!!code.querySelector("span"), code.textContent, !body.querySelector("button")];
            })()`),[highlighted,text,true]);
          }
          assert.ok(await ev(`(async () => {
            const code = document.querySelector(".tutor-answer pre code");
            const button = document.querySelector(".tutor-copy");
            let copied;
            Object.defineProperty(navigator, "clipboard", {configurable:true,value:{writeText:async text=>{copied=text;}}});
            try { await button.onclick(); return copied === code.textContent; }
            finally { delete navigator.clipboard; }
          })()`));
        }
        if(width>=1024){
          const text=await ev('document.querySelector("#qText").textContent');
          await ev('document.querySelector("#tutorAsk").focus()');
          for(const key of ["a","ArrowRight"]){
            await c.send("Input.dispatchKeyEvent",{type:"keyDown",key});
            await c.send("Input.dispatchKeyEvent",{type:"keyUp",key});
          }
          assert.equal(await ev('document.querySelector("#qText").textContent'),text);
          assert.equal(await ev('document.activeElement.id'),"tutorAsk");
        }
        await ev('document.querySelector("#tutorAsk").value="模拟断流";document.querySelector("#tutorSend").click()');
        await until('document.querySelector(".tutor-retry") && document.querySelector("#tutorLog").textContent.includes("半截回复")');
        await ev('document.querySelector(".tutor-retry").click()');
        await until('document.querySelector("#tutorStop").hidden && document.querySelectorAll(".tutor-answer strong").length===2');
        assert.equal(await ev('document.querySelectorAll(".tutor-user").length'),2);
        assert.equal(observed.at(-1).history.length,2);
        assert.equal(observed.at(-1).history[1].server_tool_calls.length,1);
        assert.equal(observed.at(-1).web,false);
        assert.equal(observed.at(-1).mode,"free");
        await ev('document.querySelector("#nextBtn").click()');
        assert.equal(await ev('document.querySelector("#tutorLog").textContent'),"");
        await ev('document.querySelector("#prevBtn").click()');
        await until('document.querySelectorAll("#tutorLog a").length===2');
        await ev('document.querySelector("#tutorWeb").checked=true; document.querySelector("#tutorAsk").value="今日AI大事"; document.querySelector("#tutorSend").click()');
        await until('document.querySelectorAll(".tutor-citation").length===2');
        assert.ok(await ev('document.querySelector(".tutor-citation").href.endsWith("/brief-read") && document.querySelectorAll(".tutor-citation")[1].href.endsWith("/brief-search") && !document.querySelector("details.tutor-sources").open'));
        assert.ok(await ev('!document.querySelector("#tutorLog").innerText.includes("繁體新聞標題")'));
        if(process.env.TUTOR_SHOTS && [390,1440].includes(width)){
          await ev('document.querySelector(".tutor-brief").scrollIntoView({block:"center"})');
          await c.vshot(path.join(process.env.TUTOR_SHOTS,"tutor-brief-"+width+".png"));
        }
        await ev('document.querySelector("details.tutor-sources summary").click()');
        assert.ok(await ev('document.querySelector("details.tutor-sources").open && document.querySelector("#tutorLog").innerText.includes("繁體新聞標題")'));
        assert.ok(await ev('document.documentElement.scrollWidth<=innerWidth && document.querySelector("#tutorPanel").scrollWidth<=document.querySelector("#tutorPanel").clientWidth+1'));
        await ev('document.querySelector("#nextBtn").click(); document.querySelector("#prevBtn").click()');
        await until('document.querySelectorAll(".tutor-citation").length===2 && !document.querySelector("details.tutor-sources").open');
        await ev('document.querySelector("#tutorExplain").click();document.querySelector("#tutorStop").click()');
        await until('document.querySelector("#tutorStatus").textContent.includes("已停止")');
        assert.ok(await ev('document.querySelector("#tutorStop").hidden'));
        await ev('document.querySelector("#tutorHint").click()');
        await until('document.querySelector("#tutorStop").hidden');
        assert.equal(observed.at(-1).mode,"hint");
        assert.ok(observed.at(-1).history.every(message=>message.reasoning_content === undefined));
        console.log(width+"px 布局、解锁、排版、联网来源、断流重试与切题通过");
      } finally {c.close();}
    }
  } finally {server.close();}
}
verifyAccess().then(()=>process.argv.includes("--api-only") ? console.log("授权与分组校验通过") : browserChecks()).catch(e=>{console.error(e);process.exitCode=1;});
