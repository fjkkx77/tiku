(() => {
  const escapeHtml = value => value.replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);
  const mathPattern = /^(?:\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\\\((.+?)\\\)|\$(?![\s$])([^$\n]*?[^\s$])\$(?![\d$]))/;
  let markdown;

  function parser(){
    if(!markdown){
      markdown = new marked.Marked({
        breaks:true,
        renderer:{
          html({text}) { return escapeHtml(text); },
          image({text}) { return escapeHtml(text); },
          link({tokens}) { return this.parser.parseInline(tokens); }
        }
      });
      if(window.katex){
        markdown.use({extensions:[{
          name:"tutorMath",
          level:"inline",
          start(src) { return src.search(/[$\\]/); },
          tokenizer(src) {
            const match = src.match(mathPattern);
            if(!match) return;
            return {type:"tutorMath", raw:match[0], text:match.slice(1).find(Boolean), display:!!(match[1] || match[2])};
          },
          renderer(token) {
            try {
              return katex.renderToString(token.text,{output:"mathml",displayMode:token.display,maxExpand:200,maxSize:12});
            } catch { return escapeHtml(token.raw); }
          }
        }]});
      }
    }
    return markdown;
  }

  function answer(el, text, final){
    el.classList.remove("tutor-plain");
    try {
      el.innerHTML = DOMPurify.sanitize(parser().parse(text),{USE_PROFILES:{html:true,mathMl:true}});
    } catch { el.textContent = text; el.classList.add("tutor-plain"); }
    if(!final) return;
    for(const code of el.querySelectorAll("pre > code")){
      const button = document.createElement("button");
      button.type = "button";
      button.className = "tutor-copy";
      button.textContent = "复制代码";
      button.onclick = async () => {
        try { await navigator.clipboard.writeText(code.textContent); button.textContent = "已复制"; }
        catch { button.textContent = "复制失败"; }
      };
      code.parentElement.after(button);
    }
  }

  function sourceUrl(input){
    try {
      const url = new URL(input);
      if(!["http:","https:"].includes(url.protocol) || url.username || url.password) return null;
      url.hash = "";
      return url.href;
    } catch { return null; }
  }

  function sourceLink(url,text){
    const link = document.createElement("a");
    link.href = url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = text;
    return link;
  }

  function inlineReferences(body,results){
    const walker = document.createTreeWalker(body,NodeFilter.SHOW_TEXT);
    const matches = [];
    while(walker.nextNode()){
      if(/〔\d+〕/.test(walker.currentNode.data)) matches.push(walker.currentNode);
    }
    for(const node of matches){
      const parts = document.createDocumentFragment();
      for(const token of node.data.split(/(〔\d+〕)/)){
        const item = /^〔(\d+)〕$/.exec(token);
        const source = item && results[Number(item[1])-1];
        if(!source) { parts.append(token); continue; }
        const [url,{title}] = source;
        const link = sourceLink(url,item[1]);
        link.className = "tutor-citation";
        link.title = title;
        link.setAttribute("aria-label","来源 "+item[1]+"，"+title);
        parts.append(link);
      }
      node.replaceWith(parts);
    }
  }

  function sources(reply,body){
    const root = document.createElement(reply.brief ? "details" : "div");
    root.className = "tutor-sources";
    const results = new Map();
    function add(source, read){
      const url = sourceUrl(source?.url);
      if(!url || (results.has(url) && !read)) return;
      const date = /^\d{4}-\d\d-\d\d/.exec(source.published_at || "")?.[0];
      results.set(url,{title:source.title || new URL(url).hostname,read,date});
    }
    for(const step of reply.server_tool_calls || []){
      for(const call of step?.calls || []){
        if(call.status !== "completed") continue;
        for(const source of call.sources || []) add(source,false);
        add(call.page,true);
      }
    }
    const cited = new Set((reply.annotations || []).map(item=>sourceUrl(item?.url_citation?.url)).filter(url=>results.has(url)));
    if(!results.size){
      const empty = document.createElement("div");
      empty.className = root.className;
      const status = document.createElement("p");
      status.textContent = "本轮未取得可核验的网页来源";
      empty.append(status);
      return empty;
    }
    // List actual returned sources, with the links used in the answer first.
    const relevant = [...results];
    if(!reply.brief) relevant.sort(([a],[b]) => Number(cited.has(b)) - Number(cited.has(a)));
    relevant.splice(8);
    const status = document.createElement(reply.brief ? "summary" : "p");
    if(reply.brief){
      body.classList.add("tutor-brief");
      inlineReferences(body,relevant);
      status.textContent = "查看 "+relevant.length+" 条网页来源";
    } else {
      status.textContent = reply.directSearch || cited.size ? "本轮网页来源" : "本轮取得网页资料，回答未标注引用";
    }
    root.append(status);
    const list = document.createElement(reply.brief ? "ol" : "ul");
    for(const [url,source] of relevant){
      const item = document.createElement("li");
      const link = sourceLink(url,source.title);
      const caption = document.createElement("span");
      caption.textContent = [source.read ? "已打开原文" : "搜索摘要",source.date,new URL(url).hostname].filter(Boolean).join(" · ");
      item.append(link,caption);
      list.append(item);
    }
    root.append(list);
    return root;
  }

  window.TikuTutorRender = {answer,sources};
})();
