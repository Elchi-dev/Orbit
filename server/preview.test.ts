import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { db, now } from "./db";
import { noticeServer, openPreview, previewState, startPreviewServer } from "./preview";

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

  test("local servers are shown as they are; other sites are refused", () => {
    const { id } = workspace();
    expect(openPreview(id, "http://localhost:5173/")).toMatchObject({ kind: "server", url: "http://localhost:5173/" });
    expect(() => openPreview(id, "https://example.com")).toThrow("local addresses only");
  });

  test("a dev server announcing itself in shell output opens in the preview", () => {
    const { id } = workspace();
    noticeServer(id, "  VITE v6.0.0  ready in 312 ms\n  ➜  Local:   http://localhost:5174/\n");
    expect(previewState(id)?.url).toBe("http://localhost:5174/");
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
