// Comments on the preview. A small script goes into every page the preview shows (files
// Orbit serves, and dev servers through a local proxy) so the user can point at any
// element and say what to change. It talks to Orbit only through postMessage with the
// parent window, draws numbered pins for the comments, and draws them in screenshots too
// when the address carries __orbit_pins, so Claude sees exactly what each comment means.

export const ANNOTATE = `(()=>{if(window.__orbitAnnotate)return;window.__orbitAnnotate=1;
const P=window.parent!==window?window.parent:null;let on=false,hover=null,pins=[];
const css=(e,s)=>Object.assign(e.style,s);
const box=document.createElement("div");css(box,{position:"fixed",pointerEvents:"none",zIndex:2147483646,border:"2px solid #B8A6FF",background:"rgba(184,166,255,.12)",borderRadius:"4px",display:"none",transition:"all .06s"});
const tag=document.createElement("div");css(tag,{position:"fixed",pointerEvents:"none",zIndex:2147483647,font:"600 11px/1.6 system-ui,sans-serif",color:"#16123a",background:"#B8A6FF",padding:"0 6px",borderRadius:"3px",display:"none",whiteSpace:"nowrap"});
const layer=document.createElement("div");css(layer,{position:"fixed",inset:"0",pointerEvents:"none",zIndex:2147483645});
const mount=()=>{if(!document.body)return setTimeout(mount,30);document.body.append(box,tag,layer);};mount();
function sel(el){if(!(el instanceof Element))return"";if(el.id&&document.querySelectorAll("#"+CSS.escape(el.id)).length===1)return"#"+CSS.escape(el.id);
const parts=[];let e=el;while(e&&e.nodeType===1&&e!==document.documentElement&&parts.length<8){let s=e.localName;
const cls=[...e.classList].filter(c=>/^[a-zA-Z][\\w-]{1,30}$/.test(c)&&!/^(css|sc|jsx|svelte|astro)-/.test(c)).slice(0,2);if(cls.length)s+="."+cls.map(c=>CSS.escape(c)).join(".");
const sib=e.parentElement?[...e.parentElement.children].filter(x=>x.localName===e.localName):[];if(sib.length>1)s+=":nth-of-type("+(sib.indexOf(e)+1)+")";
parts.unshift(s);const q=parts.join(" > ");try{if(document.querySelectorAll(q).length===1)return q;}catch{}if(e.id){parts[0]="#"+CSS.escape(e.id)+parts[0].replace(/^[a-z0-9-]+/,"");break;}e=e.parentElement;}
return parts.join(" > ");}
function label(el){const t=el.localName,id=el.id?"#"+el.id:"",c=el.classList[0]?"."+el.classList[0]:"";return t+id+c;}
function show(el){if(!el){css(box,{display:"none"});css(tag,{display:"none"});return;}const r=el.getBoundingClientRect();
css(box,{display:"block",left:r.left-2+"px",top:r.top-2+"px",width:r.width+4+"px",height:r.height+4+"px"});tag.textContent=label(el);css(tag,{display:"block",left:Math.max(0,r.left-2)+"px",top:(r.top>22?r.top-22:r.bottom+4)+"px"});}
function draw(){layer.textContent="";for(const p of pins){let el=null;try{el=p.sel?document.querySelector(p.sel):null;}catch{}
const r=el?el.getBoundingClientRect():null;const x=r?r.left+r.width*(p.px??0):p.x??20,y=r?r.top+r.height*(p.py??0):p.y??20;
if(r&&p.outline){const o=document.createElement("div");css(o,{position:"fixed",left:r.left-2+"px",top:r.top-2+"px",width:r.width+4+"px",height:r.height+4+"px",border:"2px solid #FFB199",borderRadius:"4px"});layer.append(o);}
const d=document.createElement("div");d.textContent=p.n;css(d,{position:"fixed",left:Math.max(2,x-11)+"px",top:Math.max(2,y-11)+"px",width:"22px",height:"22px",borderRadius:"50%",background:"#FFB199",color:"#2a1210",font:"700 12px/22px system-ui,sans-serif",textAlign:"center",boxShadow:"0 2px 8px rgba(0,0,0,.35),0 0 0 2px #fff"});layer.append(d);}}
let raf=0;const redraw=()=>{cancelAnimationFrame(raf);raf=requestAnimationFrame(()=>{draw();if(on&&hover)show(hover);});};
addEventListener("scroll",redraw,true);addEventListener("resize",redraw);
addEventListener("mousemove",e=>{if(!on)return;const el=document.elementFromPoint(e.clientX,e.clientY);if(el&&el!==hover&&!layer.contains(el)){hover=el;show(el);}},true);
const block=e=>{if(on){e.preventDefault();e.stopPropagation();}};["mousedown","mouseup","pointerdown","pointerup","dblclick","submit"].forEach(t=>addEventListener(t,block,true));
addEventListener("click",e=>{if(!on)return;e.preventDefault();e.stopPropagation();const el=document.elementFromPoint(e.clientX,e.clientY)||e.target;const r=el.getBoundingClientRect();
P&&P.postMessage({orbit:"pick",sel:sel(el),label:label(el),text:(el.innerText||el.getAttribute("alt")||el.getAttribute("aria-label")||"").trim().replace(/\\s+/g," ").slice(0,200),html:el.outerHTML.slice(0,600),
px:r.width?(e.clientX-r.left)/r.width:0,py:r.height?(e.clientY-r.top)/r.height:0,rect:{x:r.left+scrollX,y:r.top+scrollY,w:r.width,h:r.height},vw:innerWidth,url:location.href.replace(/[?&]__orbit_pins=[^&#]*/,"")},"*");},true);
addEventListener("keydown",e=>{if(on&&e.key==="Escape"){P&&P.postMessage({orbit:"cancel"},"*");}},true);
addEventListener("message",e=>{if(e.source!==P)return;const m=e.data||{};if(m.orbit==="annotate"){on=!!m.on;document.documentElement.style.cursor=on?"crosshair":"";if(!on){hover=null;show(null);}}
else if(m.orbit==="pins"){pins=Array.isArray(m.pins)?m.pins:[];draw();}});
try{const q=new URLSearchParams(location.search).get("__orbit_pins");if(q){pins=JSON.parse(decodeURIComponent(escape(atob(q))));addEventListener("load",draw);setTimeout(draw,50);}}catch{}
P&&P.postMessage({orbit:"ready",url:location.href,title:document.title},"*");})();`;

export const annotateTag = () => `<script>${ANNOTATE}</script>`;

/** Put a script into an HTML page: before </head> when there is one, else at the start. */
export function inject(html: string, tag: string): string {
  if (/<\/head>/i.test(html)) return html.replace(/<\/head>/i, `${tag}</head>`);
  if (/<body[^>]*>/i.test(html)) return html.replace(/<body[^>]*>/i, (m) => m + tag);
  return tag + html;
}

// ---------- the dev server proxy ----------
// A dev server is shown through a proxy on its own port, so its pages get the comment
// script too. Everything else passes through untouched, hot reload included.

const proxies = new Map<string, { port: number; stop: () => void }>();

const HOP = ["connection", "keep-alive", "transfer-encoding", "upgrade", "proxy-connection", "te", "trailer"];

export function proxyFor(origin: string): number {
  const have = proxies.get(origin);
  if (have) return have.port;
  const target = new URL(origin);
  const wsBase = `${target.protocol === "https:" ? "wss" : "ws"}://${target.host}`;
  type Data = { path: string; protocols: string[]; up?: WebSocket; queue: (string | Buffer)[] };
  const srv = Bun.serve<Data, never>({
    port: 0,
    hostname: "127.0.0.1",
    idleTimeout: 0,
    async fetch(req, server) {
      const u = new URL(req.url);
      const path = u.pathname + u.search;
      if (req.headers.get("upgrade")?.toLowerCase() === "websocket") {
        const protocols = (req.headers.get("sec-websocket-protocol") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
        const ok = server.upgrade(req, { data: { path, protocols, queue: [] }, headers: protocols[0] ? { "Sec-WebSocket-Protocol": protocols[0] } : undefined });
        return ok ? undefined : new Response("Upgrade failed", { status: 400 });
      }
      const headers = new Headers(req.headers);
      for (const h of [...HOP, "host", "accept-encoding"]) headers.delete(h);
      if (headers.get("origin")) headers.set("origin", target.origin);
      if (headers.get("referer")) headers.set("referer", headers.get("referer")!.replace(u.origin, target.origin));
      let res: Response;
      try {
        res = await fetch(target.origin + path, { method: req.method, headers, body: req.method === "GET" || req.method === "HEAD" ? undefined : await req.arrayBuffer(), redirect: "manual" });
      } catch {
        return new Response(`The dev server at ${target.origin} isn't answering. Is it still running?`, { status: 502, headers: { "content-type": "text/plain; charset=utf-8" } });
      }
      const out = new Headers(res.headers);
      for (const h of [...HOP, "content-encoding", "content-length"]) out.delete(h);
      const loc = out.get("location");
      if (loc) out.set("location", loc.replace(target.origin, u.origin));
      if ((out.get("content-type") ?? "").includes("text/html") && req.method === "GET") {
        const html = await res.text();
        return new Response(inject(html, annotateTag()), { status: res.status, headers: out });
      }
      return new Response(res.body, { status: res.status, headers: out });
    },
    websocket: {
      open(ws) {
        const up = new WebSocket(wsBase + ws.data.path, ws.data.protocols);
        up.binaryType = "arraybuffer";
        ws.data.up = up;
        up.onopen = () => {
          for (const m of ws.data.queue) up.send(m as string);
          ws.data.queue = [];
        };
        up.onmessage = (e) => ws.send(typeof e.data === "string" ? e.data : new Uint8Array(e.data as ArrayBuffer));
        up.onclose = (e) => ws.close(e.code === 1005 || e.code === 1006 ? 1000 : e.code, e.reason);
        up.onerror = () => ws.close();
      },
      message(ws, msg) {
        const up = ws.data.up;
        if (up?.readyState === WebSocket.OPEN) up.send(msg as string);
        else ws.data.queue.push(msg as string);
      },
      close(ws) {
        try {
          ws.data.up?.close();
        } catch {}
      },
    },
  });
  const port = srv.port ?? 0;
  proxies.set(origin, { port, stop: () => srv.stop(true) });
  return port;
}

export function stopProxies() {
  for (const p of proxies.values()) p.stop();
  proxies.clear();
}
