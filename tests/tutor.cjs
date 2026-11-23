const assert = require("node:assert/strict");
const {EventEmitter} = require("node:events");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const tutor = require("../api/tutor");
const {open} = require("./cdp.cjs");

async function verifyAccess(){
  const original = global.fetch;
  const calls = [];
  process.env.DEEPSEEK_API_KEY = "test";
  process.env.TIKU_AI_OWNER_TOKEN = "x".repeat(32);
  global.fetch = async (_,options) => {
    calls.push(JSON.parse(options.body));
    return new Response("data: [DONE]\n\n");
  };
  async function request(token, history=[]){
    const res = Object.assign(new EventEmitter(),{
      setHeader(){}, status(n){this.code=n;return this;}, flushHeaders(){}, write(){}, end(){}
    });
    await tutor({method:"POST",headers:{authorization:"Bearer "+token},body:{context:"题目",question:"追问",history,web:true}},res);
    return res.code || 200;
  }
  try {
    assert.equal(await request("wrong"),401);
    assert.equal(await request(process.env.TIKU_AI_OWNER_TOKEN,[{role:"system",content:"test"}]),400);
    assert.equal(calls.length,0);
    assert.equal(await request(process.env.TIKU_AI_OWNER_TOKEN),200);
    assert.equal(calls[0].tools.length,2);
  } finally {global.fetch=original;}
}

async function browserChecks(){
  const observed=[];
  const server=http.createServer(async(req,res)=>{
    if(req.url==="/api/tutor"){
      let raw=""; for await(const part of req) raw+=part;
      observed.push(JSON.parse(raw));
      res.writeHead(200,{"Content-Type":"text/event-stream"});
      const send=choice=>res.write("data: "+JSON.stringify({choices:[choice]})+"\n\n");
      send({server_tool_event:{type:"call_started"}});
      send({delta:{content:"依据"}});
      setTimeout(()=>{
        send({delta:{content:"原文\n"+"LongIdentifier".repeat(80),annotations:[{url_citation:{url:"https://example.org/",end_index:4}}],server_tool_calls:[{index:0,calls:[]}]},finish_reason:"stop"});
        res.end("data: [DONE]\n\n");
      },250);
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
  try {
    for(const width of [320,390,430,1024,1440,1920]){
      const c=await open(width,844,1);
      try {
        await c.goto("http://127.0.0.1:"+server.address().port+"/linux-network/");
        await c.ev('document.querySelector("#startBtn").click(); document.querySelector("#tutorPanel").open=true;');
        assert.ok(await c.ev("document.documentElement.scrollWidth<=innerWidth"));
        await c.ev('document.querySelector("#tutorToken").value="test"; document.querySelector("#tutorWeb").checked=true; document.querySelector("#tutorExplain").click()');
        async function until(expression){
          for(let n=0;n<60;n++){ if(await c.ev(expression)) return; await new Promise(r=>setTimeout(r,25)); }
          throw Error("未出现预期状态 "+expression);
        }
        await until('document.querySelector("#tutorLog").innerText.includes("依据") && !document.querySelector("#tutorStop").hidden');
        await until('document.querySelector("#tutorLog a")?.href==="https://example.org/"');
        assert.ok(await c.ev('document.documentElement.scrollWidth<=innerWidth && document.querySelector("#tutorPanel").scrollWidth<=document.querySelector("#tutorPanel").clientWidth+1'));
        if(width>=1024){
          const tag=await c.ev('document.querySelector("#qText").textContent');
          await c.ev('document.querySelector("#tutorAsk").focus()');
          for(const key of ["a","ArrowRight","Enter"]){
            await c.send("Input.dispatchKeyEvent",{type:"keyDown",key});
            await c.send("Input.dispatchKeyEvent",{type:"keyUp",key});
          }
          assert.equal(await c.ev('document.querySelector("#qText").textContent'),tag);
          assert.equal(await c.ev('document.activeElement.id'),"tutorAsk");
          assert.ok(await c.ev('getComputedStyle(document.querySelector("#tutorAsk")).fontSize!=="0px" && document.querySelector("#tutorLog a").getBoundingClientRect().width>0'));
        }
        await c.ev('document.querySelector("#tutorHint").click()');
        await until('document.querySelectorAll("#tutorLog a").length===2');
        assert.equal(observed.at(-1).history[1].server_tool_calls.length,1);
        assert.equal(observed.at(-1).web,false);
        await c.ev('document.querySelector("#nextBtn").click()');
        assert.equal(await c.ev('document.querySelector("#tutorLog").textContent'),"");
        await c.ev('document.querySelector("#prevBtn").click()');
        assert.equal(await c.ev('document.querySelectorAll("#tutorLog a").length'),2);
        await c.ev('document.querySelector("#tutorPanel").open=true;document.querySelector("#tutorHint").click();document.querySelector("#tutorStop").click()');
        await until('document.querySelector("#tutorStatus").textContent.includes("已停止")');
        assert.ok(await c.ev('document.querySelector("#tutorStop").hidden'));
        console.log(width+"px 流式、引用、追问与逐题隔离通过");
      } finally {c.close();}
    }
  } finally {server.close();}
}
verifyAccess().then(browserChecks).catch(e=>{console.error(e);process.exitCode=1;});
