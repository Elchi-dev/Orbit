import { afterAll, describe, expect, test } from "bun:test";
import { checkPage, reportText } from "./pagecheck";
import { findChrome } from "./screenshot";

const BAD = `<!doctype html><html><head><meta name="viewport" content="width=device-width, user-scalable=no"></head><body style="background:#fff">
<h1>Shop</h1><h3>Deals</h3><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw="><button><svg width="10" height="10"></svg></button>
<input placeholder="Email"><p style="color:#bbb">Light grey text</p><div onclick="go()">Click me</div></body></html>`;
const GOOD = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Fine</title></head>
<body><main><h1>Hello</h1><p>Readable text.</p><label for="e">Email</label><input id="e" style="height:32px"><button style="padding:8px">Send</button></main></body></html>`;

const server = Bun.serve({ port: 0, fetch: (r) => new Response(new URL(r.url).pathname === "/bad" ? BAD : GOOD, { headers: { "content-type": "text/html" } }) });
afterAll(() => server.stop(true));

describe.skipIf(!findChrome())("checking a page", () => {
  test("finds what a page gets wrong on its own, and nothing on a clean one", async () => {
    const bad = await checkPage(`http://localhost:${server.port}/bad`, 390);
    const rules = bad.a11y.map((i) => i.rule).sort();
    expect(rules).toEqual(expect.arrayContaining(["click-div", "contrast", "heading-order", "html-lang", "img-alt", "label", "name", "title", "zoom"]));
    expect(bad.a11y[0].impact).toBe("serious");
    expect(bad.perf.lcp).toBeGreaterThan(0);
    expect(reportText(bad)).toContain("Text with too little contrast (WCAG 1.4.3)");
    const good = await checkPage(`http://localhost:${server.port}/good`, 390);
    expect(good.a11y).toEqual([]);
  }, 60_000);

  test("other sites need to be asked for", async () => {
    await expect(checkPage("https://example.com/", 390)).rejects.toThrow(/asked for/);
  });
});
