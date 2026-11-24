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

  function sources(reply){
    const root = document.createElement("div");
    root.className = "tutor-sources";
    const results = new Map();
    function add(source, read){
      const url = sourceUrl(source?.url);
      if(!url || (results.has(url) && !read)) return;
      results.set(url,{title:source.title || new URL(url).hostname,read});
    }
    for(const step of reply.server_tool_calls || []){
      for(const call of step?.calls || []){
        if(call.status !== "completed") continue;
        for(const source of call.sources || []) add(source,false);
        add(call.page,true);
      }
    }
    const cited = new Set((reply.annotations || []).map(item=>sourceUrl(item?.url_citation?.url)).filter(url=>results.has(url)));
    const status = document.createElement("p");
    if(!results.size){
      status.textContent = "本轮未取得可核验的网页来源";
      root.append(status);
      return root;
    }
    // List actual returned sources, with the links used in the answer first.
    const relevant = [...results].sort(([a],[b]) => Number(cited.has(b)) - Number(cited.has(a))).slice(0,8);
    status.textContent = cited.size ? "本轮网页来源" : "本轮取得网页资料，回答未标注引用";
    root.append(status);
    const list = document.createElement("ul");
    for(const [url,source] of relevant){
      const item = document.createElement("li");
      const link = document.createElement("a");
      link.href = url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = source.title;
      const caption = document.createElement("span");
      caption.textContent = (source.read ? "已打开原文" : "搜索摘要") + " · " + new URL(url).hostname;
      item.append(link,caption);
      list.append(item);
    }
    root.append(list);
    return root;
  }

  window.TikuTutorRender = {answer,sources};
})();
