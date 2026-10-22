// The live preview. Files from a workspace are served on a second port (another
// origin, so a previewed page can never reach Orbit's API), under a random token per
// workspace, with a tiny script that reloads the page when files in the folder change.
// A dev server (Vite, Next and the like) is shown at its own address instead.

import { existsSync, readFileSync, statSync, watch, type FSWatcher } from "node:fs";
import { extname, join, resolve, sep } from "node:path";
import { broadcast } from "./hub";
import { getWorkspace } from "./db";
import { annotateTag, inject, proxyFor } from "./annotate";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
  ".wasm": "application/wasm",
};

export interface PreviewState {
  workspaceId: string;
  /** what was asked for: a path in the folder or a URL */
  target: string;
  /** what the iframe loads */
  url: string;
  kind: "files" | "server";
}

const tokens = new Map<string, string>(); // token -> workspace id
const byWs = new Map<string, string>(); // workspace id -> token
const states = new Map<string, PreviewState>();
const watchers = new Map<string, { w: FSWatcher; clients: Set<ReadableStreamDefaultController> }>();
let port = 0;

export function previewPort() {
  return port;
}

function tokenFor(wsId: string) {
  let t = byWs.get(wsId);
  if (!t) {
    t = crypto.randomUUID().replace(/-/g, "").slice(0, 24);
    byWs.set(wsId, t);
    tokens.set(t, wsId);
  }
  return t;
}

const RELOAD = (token: string) => `<script>(()=>{try{const s=new EventSource("/__orbit/events/${token}");s.onmessage=e=>{if(e.data==="reload")location.reload()}}catch{}})()</script>`;

const IGNORE = /(^|[\\/])(node_modules|\.git|\.next|dist[\\/]\.vite|\.turbo|\.cache)([\\/]|$)/;

function watchFolder(wsId: string, cwd: string) {
  let entry = watchers.get(wsId);
  if (entry) return entry;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const clients = new Set<ReadableStreamDefaultController>();
  let w: FSWatcher;
  try {
    w = watch(cwd, { recursive: true }, (_ev, file) => {
      if (file && IGNORE.test(String(file))) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        for (const c of clients) {
          try {
            c.enqueue(new TextEncoder().encode("data: reload\n\n"));
          } catch {}
        }
      }, 120);
    });
  } catch {
    w = { close() {} } as FSWatcher;
  }
  entry = { w, clients };
  watchers.set(wsId, entry);
  return entry;
}

const isLocalUrl = (s: string) => /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:\d+)?(\/|$)/.test(s);

/** Point the preview at a file or folder in the workspace, or at a local URL. */
export function openPreview(wsId: string, target: string): PreviewState {
  const state = resolveTarget(wsId, target);
  states.set(wsId, state);
  broadcast("preview", { ...state });
  return state;
}

/** The address a file, folder or local URL is shown at, without changing what the preview shows. */
export function resolveTarget(wsId: string, target: string): PreviewState {
  const ws = getWorkspace(wsId);
  if (!ws) throw new Error("No such workspace");
  const t = (target || ".").trim();
  let state: PreviewState;
  if (/^https?:\/\//.test(t)) {
    if (!isLocalUrl(t)) throw new Error("The preview shows local addresses only (localhost or 127.0.0.1); open other sites in your browser.");
    // shown through a local proxy so the page gets the comment script; straight if that fails
    const direct = new URL(t.replace("0.0.0.0", "localhost"));
    let url = direct.href;
    try {
      url = `http://127.0.0.1:${proxyFor(direct.origin)}${direct.pathname}${direct.search}${direct.hash}`;
    } catch {}
    state = { workspaceId: wsId, target: t, url, kind: "server" };
  } else {
    const full = resolve(ws.cwd, t);
    const root = resolve(ws.cwd);
    if (full !== root && !full.startsWith(root + sep)) throw new Error("That path is outside the workspace folder.");
    if (!existsSync(full)) throw new Error(`${t} doesn't exist yet.`);
    const rel = full.slice(root.length).split(sep).filter(Boolean).map(encodeURIComponent).join("/");
    const isDir = statSync(full).isDirectory();
    state = { workspaceId: wsId, target: t, url: `http://127.0.0.1:${port}/${tokenFor(wsId)}/${rel}${isDir && rel ? "/" : ""}`, kind: "files" };
  }
  return state;
}

export function closePreview(wsId: string) {
  states.delete(wsId);
  broadcast("preview", { workspaceId: wsId, url: "", target: "", kind: "files" });
}

export const previewState = (wsId: string) => states.get(wsId) ?? null;

/** A dev server announced itself in shell output ("Local: http://localhost:5173/"); show it if nothing else is. */
export function noticeServer(wsId: string, text: string) {
  const m = text.match(/https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]):(\d{2,5})\/?[^\s"'\x1b]*/);
  if (!m) return;
  const cur = states.get(wsId);
  if (cur && cur.kind === "server" && cur.url.includes(`:${m[1]}`)) return;
  if (cur && cur.kind === "files") return;
  try {
    openPreview(wsId, m[0].replace(/[).,;]+$/, ""));
  } catch {}
}

function serveFile(token: string, rest: string, ua = ""): Response {
  const wsId = tokens.get(token);
  const ws = wsId ? getWorkspace(wsId) : null;
  if (!ws) return new Response("This preview link is no longer valid. Open the preview again from Orbit.", { status: 404 });
  const root = resolve(ws.cwd);
  let full = resolve(root, decodeURIComponent(rest || "."));
  if (full !== root && !full.startsWith(root + sep)) return new Response("Outside the workspace", { status: 403 });
  if (existsSync(full) && statSync(full).isDirectory()) full = join(full, "index.html");
  if (!existsSync(full)) return new Response(`Not found: ${rest || "index.html"}`, { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
  watchFolder(ws.id, ws.cwd);
  const type = MIME[extname(full).toLowerCase()] ?? "application/octet-stream";
  const headers = { "content-type": type, "cache-control": "no-store" };
  if (type.startsWith("text/html")) {
    // the comment script always; the reload script not for the screenshot browser, which waits
    // for the network to go quiet, and an open event stream never does
    let html = inject(readFileSync(full, "utf8"), annotateTag());
    if (!ua.includes("HeadlessChrome")) html = /<\/body>/i.test(html) ? html.replace(/<\/body>/i, `${RELOAD(token)}</body>`) : html + RELOAD(token);
    return new Response(html, { headers });
  }
  return new Response(Bun.file(full), { headers });
}

function events(token: string): Response {
  const wsId = tokens.get(token);
  const ws = wsId ? getWorkspace(wsId) : null;
  if (!ws) return new Response("gone", { status: 404 });
  const entry = watchFolder(ws.id, ws.cwd);
  let ctl: ReadableStreamDefaultController;
  const stream = new ReadableStream({
    start(c) {
      ctl = c;
      entry.clients.add(c);
      c.enqueue(new TextEncoder().encode(": connected\n\n"));
    },
    cancel() {
      entry.clients.delete(ctl);
    },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" } });
}

/** Start the preview server next to Orbit. It binds to loopback only. */
export function startPreviewServer(preferred: number) {
  for (const p of [preferred, preferred + 10, 0]) {
    try {
      const srv = Bun.serve({
        port: p,
        hostname: "127.0.0.1",
        idleTimeout: 0,
        fetch(req) {
          const url = new URL(req.url);
          if (req.method !== "GET" && req.method !== "HEAD") return new Response("Read only", { status: 405 });
          const ev = url.pathname.match(/^\/__orbit\/events\/([a-f0-9]{24})$/);
          if (ev) return events(ev[1]);
          const m = url.pathname.match(/^\/([a-f0-9]{24})(?:\/(.*))?$/);
          if (m) return serveFile(m[1], m[2] ?? "", req.headers.get("user-agent") ?? "");
          return new Response("Orbit preview", { status: 404 });
        },
      });
      port = srv.port ?? p;
      return port;
    } catch {}
  }
  return 0;
}
