// Loaded into every plugin panel page: window.orbit, so a panel can talk to its
// plugin, to Orbit's API and to live events, and looks like the rest of Orbit.
export const PANEL_JS = `(() => {
  const me = document.currentScript && document.currentScript.dataset.plugin;
  const json = async (r) => {
    const t = await r.text();
    let b = null;
    try { b = t ? JSON.parse(t) : null; } catch { b = t; }
    if (!r.ok) throw new Error((b && b.error) || r.status + " " + r.statusText);
    return b;
  };
  const req = (base) => (path, opts = {}) => {
    const init = { method: opts.method || (opts.body !== undefined ? "POST" : "GET"), headers: { "content-type": "application/json" } };
    if (opts.body !== undefined) init.body = typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body);
    return fetch(base + (path.startsWith("/") ? path : "/" + path), init).then(json);
  };
  const handlers = new Map();
  let sock = null;
  const connect = () => {
    sock = new WebSocket((location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/ws");
    sock.onmessage = (m) => {
      let e; try { e = JSON.parse(m.data); } catch { return; }
      for (const k of [e.type, "*"]) for (const f of handlers.get(k) || []) try { f(e); } catch (err) { console.error(err); }
    };
    sock.onclose = () => setTimeout(connect, 1500);
  };
  const post = (type, data) => parent !== window && parent.postMessage({ orbitPanel: true, plugin: me, type, ...data }, location.origin);
  window.orbit = {
    plugin: me,
    /** your plugin's own routes: orbit.call("/hello") reaches http.request in the plugin */
    call: req("/plugins/" + me + "/api"),
    /** Orbit's API, for example orbit.api("/workspaces") */
    api: (path, opts) => req("/api")(path.replace(/^\\/api/, ""), opts),
    /** live events: orbit.on("approval_request", e => ...) or "*" for all */
    on(type, fn) {
      if (!sock) connect();
      if (!handlers.has(type)) handlers.set(type, new Set());
      handlers.get(type).add(fn);
      return () => handlers.get(type).delete(fn);
    },
    /** send a message to Claude in a workspace */
    send: (workspace, text) => req("/api")("/plugin-send", { body: { workspace, text } }),
    toast: (title, body, tone) => post("toast", { title, body, tone }),
    openWorkspace: (id) => post("open", { workspace: id }),
    /** the workspace the panel is shown beside, if any */
    workspace: new URLSearchParams(location.search).get("workspace"),
  };
  // Orbit's look, unless the page brings its own
  const css = document.createElement("style");
  css.textContent = ":root{--ink:#0b0b14;--surface:#13131f;--surface-2:#1a1a29;--line:rgba(255,255,255,.08);--star:#f3efe6;--star-2:#c9c4d6;--star-3:#8e89a0;--peach:#ffb199;--lav:#b8a6ff;--good:#8fe3c0;--danger:#ff8f8f;--r:10px;--r-l:14px;color-scheme:dark}" +
    "html{background:transparent}body{margin:0;padding:16px;font:14.5px/1.55 Figtree,system-ui,sans-serif;color:var(--star);background:transparent}" +
    "button{font:inherit;color:inherit;background:var(--surface-2);border:1px solid var(--line);border-radius:var(--r);padding:7px 12px;cursor:pointer}button:hover{border-color:rgba(255,255,255,.18)}" +
    "button.primary{background:var(--peach);color:#2a1610;border-color:transparent;font-weight:600}input,textarea,select{font:inherit;color:inherit;background:rgba(0,0,0,.25);border:1px solid var(--line);border-radius:var(--r);padding:8px 10px}" +
    "a{color:var(--peach)}code{font-family:'JetBrains Mono',ui-monospace,monospace;font-size:.9em}";
  document.addEventListener("DOMContentLoaded", () => document.head.prepend(css));
})();
`;
