import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { db, now } from "./db";
import { noticeServer, openPreview, previewState, startPreviewServer } from "./preview";
import { findChrome, screenshot } from "./screenshot";

const port = startPreviewServer(0);
function workspace() {
  const cwd = mkdtempSync(join(tmpdir(), "orbit-preview-"));
  const id = `w_${Math.random().toString(36).slice(2, 10)}`;
  db.run("INSERT INTO workspaces (id, title, cwd, mode, created_at, updated_at) VALUES (?,?,?,?,?,?)", [id, "t", cwd, "manual", now(), now()]);
  return { id, cwd };
}

describe("the live preview", () => {
  test("serves the workspace's files on its own port, with a reload script in HTML", async () => {
    expect(port).toBeGreaterThan(0);
    const { id, cwd } = workspace();
    writeFileSync(join(cwd, "index.html"), "<html><body><h1>Hi</h1></body></html>");
    writeFileSync(join(cwd, "app.css"), "h1{color:red}");
    const st = openPreview(id, ".");
    expect(st.kind).toBe("files");
    expect(st.url).toStartWith(`http://127.0.0.1:${port}/`);
    const html = await (await fetch(st.url)).text();
    expect(html).toContain("<h1>Hi</h1>");
    expect(html).toContain("EventSource");
    const css = await fetch(st.url + "app.css");
    expect(css.headers.get("content-type")).toContain("text/css");
  });

  test("never serves anything outside the folder, and a wrong token gets nothing", async () => {
    const { id } = workspace();
    const st = openPreview(id, ".");
    const base = st.url.replace(/\/$/, "");
    expect((await fetch(`${base}/..%2F..%2Fetc%2Fpasswd`)).status).toBe(403);
    expect((await fetch(`http://127.0.0.1:${port}/${"0".repeat(24)}/index.html`)).status).toBe(404);
    expect(() => openPreview(id, "../../etc")).toThrow("outside the workspace");
    expect((await fetch(st.url, { method: "POST" })).status).toBe(405);
  });

  test("local servers are shown through the proxy; other sites are refused", () => {
    const { id } = workspace();
    const st = openPreview(id, "http://localhost:5173/app?x=1");
    expect(st).toMatchObject({ kind: "server", target: "http://localhost:5173/app?x=1" });
    expect(st.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/app\?x=1$/);
    expect(() => openPreview(id, "https://example.com")).toThrow("local addresses only");
  });

  test("a dev server announcing itself in shell output opens in the preview", () => {
    const { id } = workspace();
    noticeServer(id, "  VITE v6.0.0  ready in 312 ms\n  ➜  Local:   http://localhost:5174/\n");
    expect(previewState(id)?.target).toBe("http://localhost:5174/");
  });

  test("changing a file tells open pages to reload", async () => {
    const { id, cwd } = workspace();
    writeFileSync(join(cwd, "index.html"), "<p>one</p>");
    const st = openPreview(id, ".");
    const token = st.url.split("/")[3];
    const res = await fetch(`http://127.0.0.1:${port}/__orbit/events/${token}`);
    const reader = res.body!.getReader();
    await reader.read(); // the connected comment
    setTimeout(() => writeFileSync(join(cwd, "index.html"), "<p>two</p>"), 100);
    const { value } = await Promise.race([reader.read(), new Promise<any>((r) => setTimeout(() => r({ value: null }), 3000))]);
    expect(new TextDecoder().decode(value ?? new Uint8Array())).toContain("reload");
    reader.cancel();
  });
});

describe("comments on the preview", () => {
  test("served pages get the comment script, and the screenshot browser gets it without the reload stream", async () => {
    const { id, cwd } = workspace();
    writeFileSync(join(cwd, "index.html"), "<html><head><title>x</title></head><body><h1>Hi</h1></body></html>");
    const st = openPreview(id, ".");
    const html = await (await fetch(st.url)).text();
    expect(html.indexOf("__orbitAnnotate")).toBeLessThan(html.indexOf("</head>"));
    const headless = await (await fetch(st.url, { headers: { "user-agent": "Mozilla/5.0 HeadlessChrome/140" } })).text();
    expect(headless).toContain("__orbitAnnotate");
    expect(headless).not.toContain("EventSource");
  });

  test("the dev server proxy injects the script into HTML, passes everything else and its websockets through", async () => {
    const dev = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch(req, server) {
        const u = new URL(req.url);
        if (u.pathname === "/hmr" && server.upgrade(req, { headers: { "Sec-WebSocket-Protocol": "vite-hmr" } })) return;
        if (u.pathname === "/go") return Response.redirect(`${u.origin}/`, 302);
        if (u.pathname === "/main.js") return new Response("console.log(1)", { headers: { "content-type": "text/javascript" } });
        return new Response(`<!doctype html><html><head></head><body>dev ${req.headers.get("host")}</body></html>`, { headers: { "content-type": "text/html" } });
      },
      websocket: {
        message(ws, m) {
          ws.send(`echo ${m}`);
        },
      },
    });
    const { id } = workspace();
    const st = openPreview(id, `http://localhost:${dev.port}/`);
    const html = await (await fetch(st.url)).text();
    expect(html).toContain("__orbitAnnotate");
    expect(html).toContain(`dev localhost:${dev.port}`); // the dev server sees its own host
    expect(await (await fetch(new URL("/main.js", st.url))).text()).toBe("console.log(1)");
    const r = await fetch(new URL("/go", st.url), { redirect: "manual" });
    expect(r.headers.get("location")).toStartWith(new URL(st.url).origin);
    const ws = new WebSocket(new URL("/hmr", st.url).href.replace("http", "ws"), ["vite-hmr"]);
    const got = await new Promise<string>((res, rej) => {
      ws.onopen = () => ws.send("ping");
      ws.onmessage = (e) => res(String(e.data));
      ws.onerror = () => rej(new Error("ws failed"));
      setTimeout(() => rej(new Error("timeout")), 3000);
    });
    expect(ws.protocol).toBe("vite-hmr");
    expect(got).toBe("echo ping");
    ws.close();
    dev.stop(true);
  });

  test.skipIf(!findChrome())("a screenshot address with pins draws them on the page", async () => {
    const { id, cwd } = workspace();
    writeFileSync(join(cwd, "index.html"), `<body><h1 id="t">Title</h1><script>addEventListener("load",()=>setTimeout(()=>console.log("pins "+[...document.querySelectorAll("div")].filter(d=>d.textContent==="1"&&d.style.borderRadius==="50%").length),200))</script></body>`);
    const st = openPreview(id, ".");
    const pins = Buffer.from(JSON.stringify([{ n: 1, sel: "#t", px: 0.5, py: 0.5, outline: true }])).toString("base64");
    const s = await screenshot(`${st.url}?__orbit_pins=${encodeURIComponent(pins)}`, 600);
    expect(s.console.join("\n")).toContain("pins 1");
  }, 40_000);
});

describe("screenshots", () => {
  test("console lines from older and newer Chrome are read", async () => {
    const { _parseConsole } = await import("./screenshot");
    const err = [
      '[1:1:1022/1.1:INFO:CONSOLE(12)] "hello", source: http://127.0.0.1:9/app.js (12)',
      '[1:1:1022/1.1:INFO:CONSOLE:3] "Uncaught TypeError: x is undefined", source: http://127.0.0.1:9/ (3)',
      "[1:1:1022/1.1:WARNING:something_else.cc(1)] noise",
    ].join("\n");
    expect(_parseConsole(err)).toEqual(["log: hello (/app.js:12)", "error: Uncaught TypeError: x is undefined (/:3)"]);
  });

  test("looking at your own pages only reads; another site goes through the gate like a fetch", async () => {
    const { isReadOnly, subjectOf } = await import("./tools");
    expect(isReadOnly("screenshot", { target: "index.html" })).toBe(true);
    expect(isReadOnly("screenshot", { target: "http://localhost:5173/" })).toBe(true);
    expect(isReadOnly("screenshot", { target: "https://stripe.com" })).toBe(false);
    expect(subjectOf("screenshot", { target: "https://stripe.com" }, "/")).toBe("fetch https://stripe.com");
  });

  test.skipIf(!findChrome())("captures a served page at a width, with its console, even with the reload stream open", async () => {
    const { id, cwd } = workspace();
    writeFileSync(join(cwd, "index.html"), "<h1>Shot</h1><script>console.error('nope')</script>");
    const st = openPreview(id, ".");
    const s = await screenshot(st.url, 390);
    expect(s.width).toBe(390);
    expect(Buffer.from(s.image, "base64").subarray(1, 4).toString()).toBe("PNG");
    expect(s.console.join("\n")).toContain("nope");
    await expect(screenshot("https://example.com", 390)).rejects.toThrow("asked for explicitly");
  }, 40_000);
});
