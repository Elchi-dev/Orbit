// A performance and accessibility check of a page, in the same Chrome the
// screenshots use, driven over the DevTools protocol. The accessibility part
// covers what WCAG 2.2 AA problems a page shows by itself (names, labels,
// contrast, language, zoom, headings, target size); it can't judge meaning or
// keyboard flow, and says so.

import { mkdirSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findChrome, isLocalUrl, VIEWPORT_HEIGHT } from "./screenshot";

export interface Issue {
  rule: string;
  /** what the rule is about, in words */
  title: string;
  wcag: string;
  impact: "serious" | "moderate" | "minor";
  count: number;
  examples: { selector: string; text: string; detail?: string }[];
}
export interface CheckReport {
  url: string;
  width: number;
  perf: {
    /** milliseconds */
    fcp: number | null;
    lcp: number | null;
    load: number | null;
    /** total blocking time: long task time above 50 ms each */
    tbt: number;
    cls: number;
    domNodes: number;
    requests: number;
    bytes: { total: number; js: number; css: number; image: number; font: number; other: number };
    /** pass, improve or poor, against the usual thresholds */
    verdict: { lcp: string; cls: string; tbt: string };
    largest: { url: string; bytes: number; kind: string }[];
  };
  a11y: Issue[];
  console: string[];
  notes: string[];
}

// runs in the page before anything else: keeps LCP, layout shifts and long tasks
const OBSERVE = `(() => {
  const w = (window.__orbitPerf = { lcp: null, cls: 0, longTasks: [] });
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) w.lcp = e.renderTime || e.loadTime || e.startTime; }).observe({ type: "largest-contentful-paint", buffered: true }); } catch {}
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) w.cls += e.value; }).observe({ type: "layout-shift", buffered: true }); } catch {}
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) w.longTasks.push(e.duration); }).observe({ type: "longtask", buffered: true }); } catch {}
})();`;

// runs in the page at the end and returns the findings
const AUDIT = `(() => {
  const issues = {};
  const add = (rule, title, wcag, impact, el, detail) => {
    const i = (issues[rule] ||= { rule, title, wcag, impact, count: 0, examples: [] });
    i.count++;
    if (i.examples.length < 5) i.examples.push({ selector: sel(el), text: (el && (el.innerText || el.value || el.getAttribute?.("src") || el.outerHTML) || "").trim().replace(/\\s+/g, " ").slice(0, 80), detail });
  };
  const sel = (el) => {
    if (!el || el.nodeType !== 1) return "";
    if (el.id) return "#" + CSS.escape(el.id);
    const parts = [];
    for (let e = el; e && e.nodeType === 1 && parts.length < 4; e = e.parentElement) {
      let s = e.localName;
      if (e.classList.length) s += "." + [...e.classList].slice(0, 2).map((c) => CSS.escape(c)).join(".");
      const sib = e.parentElement ? [...e.parentElement.children].filter((c) => c.localName === e.localName) : [];
      if (sib.length > 1) s += ":nth-of-type(" + (sib.indexOf(e) + 1) + ")";
      parts.unshift(s);
      if (e.id) { parts[0] = "#" + CSS.escape(e.id); break; }
    }
    return parts.join(" > ");
  };
  const visible = (el) => {
    const s = getComputedStyle(el);
    if (s.display === "none" || s.visibility === "hidden" || +s.opacity === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const hidden = (el) => !!el.closest("[aria-hidden=true], [hidden], [inert]");
  const textOf = (el) => (el.innerText || "").trim();
  const byIds = (ids) => (ids || "").split(/\\s+/).map((id) => document.getElementById(id)).filter(Boolean).map((e) => e.textContent.trim()).join(" ").trim();
  const nameOf = (el) =>
    (el.getAttribute("aria-label") || "").trim() ||
    byIds(el.getAttribute("aria-labelledby")) ||
    textOf(el) ||
    [...el.querySelectorAll("img[alt], svg title")].map((i) => i.getAttribute("alt") || i.textContent).join(" ").trim() ||
    (el.getAttribute("title") || "").trim() ||
    (el.localName === "input" && ["submit", "button", "reset"].includes(el.type) ? el.value : "");

  // language and title
  if (!document.documentElement.getAttribute("lang")) add("html-lang", "The page doesn't say its language", "3.1.1", "serious", document.documentElement);
  if (!document.title.trim()) add("title", "The page has no title", "2.4.2", "serious", document.head || document.documentElement);

  // zoom
  const vp = document.querySelector('meta[name=viewport]');
  const vpc = (vp?.getAttribute("content") || "").replace(/\\s/g, "");
  if (!vp) add("viewport", "No viewport meta: phones will show a tiny desktop page", "1.4.10", "moderate", document.head);
  else if (/user-scalable=(no|0)/i.test(vpc) || (/maximum-scale=([\\d.]+)/i.exec(vpc) && +/maximum-scale=([\\d.]+)/i.exec(vpc)[1] < 2)) add("zoom", "Zooming is blocked", "1.4.4", "serious", vp);

  // images
  for (const img of document.querySelectorAll("img")) {
    if (hidden(img) || img.getAttribute("role") === "presentation" || img.getAttribute("role") === "none") continue;
    if (!img.hasAttribute("alt") && !img.getAttribute("aria-label") && !img.getAttribute("aria-labelledby")) add("img-alt", "Images without alt text", "1.1.1", "serious", img);
  }
  for (const svg of document.querySelectorAll("svg[role=img]")) if (!nameOf(svg) && !svg.querySelector("title")) add("img-alt", "Images without alt text", "1.1.1", "serious", svg);

  // buttons and links
  for (const el of document.querySelectorAll("button, a[href], [role=button], [role=link], input[type=submit], input[type=button], input[type=reset]")) {
    if (hidden(el) || !visible(el)) continue;
    if (!nameOf(el)) add("name", el.localName === "a" || el.getAttribute("role") === "link" ? "Links with no name a screen reader can say" : "Buttons with no name a screen reader can say", "4.1.2", "serious", el);
  }

  // form fields
  for (const el of document.querySelectorAll("input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=reset]):not([type=image]), select, textarea")) {
    if (hidden(el) || !visible(el)) continue;
    const labelled = (el.id && document.querySelector('label[for="' + CSS.escape(el.id) + '"]')) || el.closest("label") || el.getAttribute("aria-label") || el.getAttribute("aria-labelledby") || el.getAttribute("title");
    if (!labelled) add("label", "Form fields without a label" + (el.getAttribute("placeholder") ? " (a placeholder isn't one)" : ""), "1.3.1, 4.1.2", "serious", el);
  }

  // headings
  const hs = [...document.querySelectorAll("h1, h2, h3, h4, h5, h6")].filter((h) => !hidden(h) && visible(h));
  if (hs.length && !hs.some((h) => h.localName === "h1")) add("h1", "No h1 heading", "1.3.1", "minor", hs[0]);
  let last = 0;
  for (const h of hs) {
    const n = +h.localName[1];
    if (last && n > last + 1) add("heading-order", "Heading levels are skipped", "1.3.1", "minor", h, "h" + last + " then h" + n);
    last = n;
  }

  // ids
  const seen = new Map();
  for (const el of document.querySelectorAll("[id]")) seen.set(el.id, (seen.get(el.id) || 0) + 1);
  for (const [id, n] of seen) if (n > 1 && document.querySelector('[aria-labelledby~="' + CSS.escape(id) + '"], [aria-describedby~="' + CSS.escape(id) + '"], label[for="' + CSS.escape(id) + '"]')) add("dup-id", "Labels point at an id used twice", "4.1.2", "moderate", document.getElementById(id), id + " x" + n);

  // keyboard
  for (const el of document.querySelectorAll("[tabindex]")) if (+el.getAttribute("tabindex") > 0) add("tabindex", "Positive tabindex changes the keyboard order", "2.4.3", "moderate", el);
  for (const el of document.querySelectorAll("[aria-hidden=true] a[href], [aria-hidden=true] button, [aria-hidden=true] input, [aria-hidden=true] [tabindex]:not([tabindex='-1'])")) if (visible(el)) add("hidden-focus", "Hidden from screen readers but still reachable by keyboard", "4.1.2", "serious", el);
  for (const el of document.querySelectorAll("[onclick]:not(a):not(button):not(input):not(select):not(textarea):not([role]):not([tabindex])")) if (visible(el)) add("click-div", "Clickable elements that aren't buttons or links", "2.1.1", "serious", el);

  // target size
  for (const el of document.querySelectorAll("button, a[href], input, select, textarea, [role=button], [role=link], [role=checkbox], [role=switch], [role=tab]")) {
    if (hidden(el) || !visible(el)) continue;
    const r = el.getBoundingClientRect();
    const inline = el.localName === "a" && getComputedStyle(el).display === "inline" && el.closest("p, li, td, dd");
    if (!inline && (r.width < 24 || r.height < 24)) add("target", "Targets smaller than 24 by 24 px", "2.5.8", "moderate", el, Math.round(r.width) + "x" + Math.round(r.height));
  }

  // contrast
  const parse = (c) => { const m = c.match(/rgba?\\(([^)]+)\\)/); if (!m) return null; const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
  const lum = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const blend = (top, under) => ({ r: top.r * top.a + under.r * (1 - top.a), g: top.g * top.a + under.g * (1 - top.a), b: top.b * top.a + under.b * (1 - top.a), a: 1 });
  const bgOf = (el) => {
    const layers = [];
    for (let e = el; e; e = e.parentElement) {
      const s = getComputedStyle(e);
      if (s.backgroundImage && s.backgroundImage !== "none") return null; // an image or gradient: can't tell
      const c = parse(s.backgroundColor);
      if (c && c.a > 0) { layers.push(c); if (c.a >= 1) break; }
    }
    let base = { r: 255, g: 255, b: 255, a: 1 };
    for (let i = layers.length - 1; i >= 0; i--) base = blend(layers[i], base);
    return base;
  };
  let checked = 0, unknown = 0;
  const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT);
  const done = new Set();
  while (walker.nextNode() && checked < 1500) {
    const t = walker.currentNode;
    if (!t.textContent.trim()) continue;
    const el = t.parentElement;
    if (!el || done.has(el) || hidden(el) || !visible(el) || ["script", "style", "noscript"].includes(el.localName)) continue;
    done.add(el);
    checked++;
    const s = getComputedStyle(el);
    const fg = parse(s.color);
    const bg = bgOf(el);
    if (!fg || !bg) { unknown++; continue; }
    const fgb = blend(fg, bg);
    const L1 = lum(fgb), L2 = lum(bg);
    const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    const size = parseFloat(s.fontSize), bold = +s.fontWeight >= 700;
    const large = size >= 24 || (bold && size >= 18.66);
    const need = large ? 3 : 4.5;
    if (ratio < need) add("contrast", "Text with too little contrast", "1.4.3", ratio < need - 1.5 ? "serious" : "moderate", el, ratio.toFixed(2) + ":1, needs " + need + ":1");
  }

  const p = window.__orbitPerf || {};
  const nav = performance.getEntriesByType("navigation")[0];
  const fcp = performance.getEntriesByName("first-contentful-paint")[0];
  const res = performance.getEntriesByType("resource").map((r) => ({ url: r.name, bytes: r.transferSize || r.encodedBodySize || 0, kind: r.initiatorType }));
  return JSON.stringify({
    issues: Object.values(issues),
    contrastUnknown: unknown,
    perf: { lcp: p.lcp, cls: p.cls || 0, longTasks: p.longTasks || [], fcp: fcp ? fcp.startTime : null, load: nav ? nav.loadEventEnd : null, docBytes: nav ? nav.transferSize || nav.encodedBodySize || 0 : 0, domNodes: document.getElementsByTagName("*").length },
    resources: res,
  });
})()`;

class Cdp {
  private id = 0;
  private wait = new Map<number, { ok: (v: any) => void; no: (e: Error) => void }>();
  private on = new Map<string, ((p: any) => void)[]>();
  constructor(private ws: WebSocket) {
    ws.onmessage = (m) => {
      const msg = JSON.parse(String(m.data));
      if (msg.id && this.wait.has(msg.id)) {
        const w = this.wait.get(msg.id)!;
        this.wait.delete(msg.id);
        msg.error ? w.no(new Error(msg.error.message)) : w.ok(msg.result);
      } else if (msg.method) for (const f of this.on.get(msg.method) ?? []) f(msg.params);
    };
  }
  send(method: string, params: object = {}): Promise<any> {
    const id = ++this.id;
    return new Promise((ok, no) => {
      this.wait.set(id, { ok, no });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  once(method: string, ms: number) {
    return new Promise<any>((ok) => {
      const t = setTimeout(() => ok(null), ms);
      this.on.set(method, [
        ...(this.on.get(method) ?? []),
        (p) => {
          clearTimeout(t);
          ok(p);
        },
      ]);
    });
  }
  listen(method: string, f: (p: any) => void) {
    this.on.set(method, [...(this.on.get(method) ?? []), f]);
  }
}

const kindOf = (r: { url: string; kind: string }) =>
  /\.m?js(\?|$)/i.test(r.url) || r.kind === "script" ? "js" : /\.css(\?|$)/i.test(r.url) || r.kind === "css" || r.kind === "link" ? "css" : /\.(png|jpe?g|gif|webp|avif|svg|ico)(\?|$)/i.test(r.url) || r.kind === "img" ? "image" : /\.(woff2?|ttf|otf)(\?|$)/i.test(r.url) ? "font" : "other";

const rate = (v: number | null, good: number, poor: number) => (v == null ? "unknown" : v <= good ? "good" : v <= poor ? "needs work" : "poor");

export async function checkPage(url: string, width = 390, opts: { remote?: boolean; timeoutMs?: number } = {}): Promise<CheckReport> {
  const chrome = findChrome();
  if (!chrome) throw new Error("No Chrome, Chromium, Edge or Brave found. Install one, or set ORBIT_CHROME to a browser's path.");
  if (!/^https?:\/\//.test(url)) throw new Error("A check needs an http or https address.");
  if (!opts.remote && !isLocalUrl(url)) throw new Error("Checks of other sites need to be asked for explicitly.");
  const w = Math.max(240, Math.min(3840, Math.round(width)));
  const h = VIEWPORT_HEIGHT(w);
  const dir = join(tmpdir(), `orbit-check-${crypto.randomUUID().slice(0, 8)}`);
  mkdirSync(dir, { recursive: true });
  const args = [chrome, "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--disable-extensions", "--mute-audio", `--user-data-dir=${join(dir, "profile")}`, "--remote-debugging-port=0", `--window-size=${w},${h}`, "about:blank"];
  if (process.getuid?.() === 0) args.splice(1, 0, "--no-sandbox");
  const proc = Bun.spawn(args, { stdout: "ignore", stderr: "ignore", stdin: "ignore" });
  const deadline = Date.now() + (opts.timeoutMs ?? 30_000);
  try {
    const portFile = join(dir, "profile", "DevToolsActivePort");
    while (!existsSync(portFile)) {
      if (Date.now() > deadline) throw new Error("The browser didn't start.");
      await Bun.sleep(50);
    }
    const port = readFileSync(portFile, "utf8").split("\n")[0].trim();
    let target: any = null;
    while (!target) {
      target = ((await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json())) as any[]).find((t) => t.type === "page");
      if (!target) await Bun.sleep(50);
    }
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((ok, no) => ((ws.onopen = ok), (ws.onerror = () => no(new Error("Couldn't talk to the browser")))));
    const cdp = new Cdp(ws);
    const consoleLines: string[] = [];
    cdp.listen("Runtime.consoleAPICalled", (p) => consoleLines.length < 30 && consoleLines.push(`${p.type}: ${(p.args ?? []).map((a: any) => a.value ?? a.description ?? "").join(" ").slice(0, 300)}`));
    cdp.listen("Runtime.exceptionThrown", (p) => consoleLines.length < 30 && consoleLines.push(`error: ${p.exceptionDetails?.exception?.description?.split("\n")[0] ?? p.exceptionDetails?.text ?? "exception"}`));
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: w <= 480 ? 3 : 1, mobile: w <= 480 });
    await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: OBSERVE });
    const loaded = cdp.once("Page.loadEventFired", Math.max(1000, deadline - Date.now() - 4000));
    await cdp.send("Page.navigate", { url });
    await loaded;
    // let late work and lazy content settle, then scroll once so lazy images load
    await Bun.sleep(1200);
    await cdp.send("Runtime.evaluate", { expression: "window.scrollTo(0, document.body ? document.body.scrollHeight : 0)" });
    await Bun.sleep(500);
    await cdp.send("Runtime.evaluate", { expression: "window.scrollTo(0, 0)" });
    await Bun.sleep(300);
    const r = await cdp.send("Runtime.evaluate", { expression: AUDIT, returnByValue: true });
    if (r.exceptionDetails) throw new Error(`The check couldn't run on that page: ${r.exceptionDetails.text}`);
    const data = JSON.parse(r.result.value);
    ws.close();

    const bytes = { total: data.perf.docBytes, js: 0, css: 0, image: 0, font: 0, other: data.perf.docBytes };
    for (const res of data.resources) {
      const k = kindOf(res) as keyof typeof bytes;
      bytes[k] += res.bytes;
      bytes.total += res.bytes;
    }
    const tbt = Math.round((data.perf.longTasks as number[]).reduce((n, d) => n + Math.max(0, d - 50), 0));
    const lcp = data.perf.lcp != null ? Math.round(data.perf.lcp) : null;
    const cls = Math.round(data.perf.cls * 1000) / 1000;
    const notes = [
      "Timings come from this computer without network throttling, so they are best cases; compare runs with each other rather than with field data.",
      "The accessibility part finds problems a page shows by itself. It can't judge whether alt text or labels make sense, or whether the keyboard order is right: try the page with Tab and a screen reader too.",
    ];
    if (data.contrastUnknown) notes.push(`${data.contrastUnknown} text elements sit on an image or gradient, so their contrast wasn't measured.`);
    const order = { serious: 0, moderate: 1, minor: 2 };
    return {
      url,
      width: w,
      perf: {
        fcp: data.perf.fcp != null ? Math.round(data.perf.fcp) : null,
        lcp,
        load: data.perf.load != null ? Math.round(data.perf.load) : null,
        tbt,
        cls,
        domNodes: data.perf.domNodes,
        requests: data.resources.length + 1,
        bytes,
        verdict: { lcp: rate(lcp, 2500, 4000), cls: rate(cls, 0.1, 0.25), tbt: rate(tbt, 200, 600) },
        largest: [...data.resources].sort((a: any, b: any) => b.bytes - a.bytes).slice(0, 5).map((x: any) => ({ url: x.url, bytes: x.bytes, kind: kindOf(x) })),
      },
      a11y: (data.issues as Issue[]).sort((a, b) => order[a.impact] - order[b.impact] || b.count - a.count),
      console: consoleLines,
      notes,
    };
  } finally {
    proc.kill();
    await proc.exited.catch(() => {});
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The report as text, for Claude. */
export function reportText(r: CheckReport): string {
  const kb = (b: number) => `${Math.round(b / 1024)} KB`;
  const p = r.perf;
  const lines = [
    `Check of ${r.url} at ${r.width} px`,
    "",
    "Performance:",
    `- Largest contentful paint ${p.lcp ?? "?"} ms (${p.verdict.lcp}), first paint ${p.fcp ?? "?"} ms, load ${p.load ?? "?"} ms`,
    `- Layout shift ${p.cls} (${p.verdict.cls}), blocking time ${p.tbt} ms (${p.verdict.tbt})`,
    `- ${p.requests} requests, ${kb(p.bytes.total)}: JS ${kb(p.bytes.js)}, CSS ${kb(p.bytes.css)}, images ${kb(p.bytes.image)}, fonts ${kb(p.bytes.font)}; ${p.domNodes} elements`,
    ...(p.largest.length ? [`- Largest: ${p.largest.map((x) => `${x.url.split("/").pop()?.slice(0, 40)} ${kb(x.bytes)}`).join(", ")}`] : []),
    "",
    r.a11y.length ? `Accessibility, ${r.a11y.reduce((n, i) => n + i.count, 0)} problems:` : "Accessibility: no problems found by the automatic checks.",
    ...r.a11y.map((i) => `- [${i.impact}] ${i.title} (WCAG ${i.wcag}): ${i.count}. ${i.examples.map((e) => `${e.selector}${e.detail ? ` (${e.detail})` : ""}${e.text ? ` "${e.text.slice(0, 40)}"` : ""}`).join("; ")}`),
    ...(r.console.length ? ["", "Console:", ...r.console.map((c) => `- ${c}`)] : []),
    "",
    ...r.notes.map((n) => `Note: ${n}`),
  ];
  return lines.join("\n");
}
