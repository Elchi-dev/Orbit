// Minimal streaming client for the Anthropic Messages API (raw fetch + SSE),
// so we control every event, header and block exactly.
import { apiKey } from "./secrets";

const API = process.env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com";
export const isMock = () => process.env.ORBIT_MOCK === "1";

export interface Usage {
  input: number;
  output: number;
  cache_read: number;
  cache_write: number;
  /** web searches run by the API's own search tool, billed per search */
  web_searches?: number;
}
export interface RateInfo {
  tokens_remaining?: number;
  tokens_limit?: number;
  requests_remaining?: number;
  requests_limit?: number;
}
export interface StreamResult {
  content: any[];
  stop_reason: string | null;
  usage: Usage;
  ttft_ms: number | null;
  tps: number | null;
  rate: RateInfo;
}
export interface StreamHandlers {
  onBlockStart?: (index: number, block: any) => void;
  onDelta?: (index: number, kind: "text" | "thinking" | "input", text: string) => void;
  onBlockStop?: (index: number, block: any) => void;
}
export interface MessageRequest {
  model: string;
  system: string;
  messages: any[];
  tools?: any[];
  max_tokens: number;
  effort?: string;
  thinkingDisplay?: string;
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function headers(key: string) {
  return {
    "content-type": "application/json",
    "x-api-key": key,
    "anthropic-version": "2023-06-01",
  };
}

function body(req: MessageRequest, stream: boolean) {
  const b: any = {
    model: req.model,
    max_tokens: req.max_tokens,
    system: [{ type: "text", text: req.system, cache_control: { type: "ephemeral" } }],
    messages: req.messages,
    stream,
  };
  if (req.tools?.length) b.tools = req.tools;
  if (req.effort) b.output_config = { effort: req.effort };
  if (req.thinkingDisplay && req.thinkingDisplay !== "omitted") b.thinking = { type: "adaptive", display: req.thinkingDisplay };
  return JSON.stringify(b);
}

function num(h: Headers, k: string) {
  const v = h.get(k);
  return v == null ? undefined : Number(v);
}

function readRate(h: Headers): RateInfo {
  return {
    tokens_remaining: num(h, "anthropic-ratelimit-tokens-remaining"),
    tokens_limit: num(h, "anthropic-ratelimit-tokens-limit"),
    requests_remaining: num(h, "anthropic-ratelimit-requests-remaining"),
    requests_limit: num(h, "anthropic-ratelimit-requests-limit"),
  };
}

async function errorFrom(res: Response) {
  let msg = `${res.status} ${res.statusText}`;
  try {
    const j: any = await res.json();
    msg = j?.error?.message ?? msg;
  } catch {}
  return new ApiError(res.status, msg);
}

export async function streamMessage(req: MessageRequest, h: StreamHandlers, signal?: AbortSignal): Promise<StreamResult> {
  if (isMock()) return mockStream(req, h, signal);
  const key = apiKey();
  if (!key) throw new ApiError(401, "No API key set");
  const started = performance.now();
  const res = await fetch(`${API}/v1/messages`, { method: "POST", headers: headers(key), body: body(req, true), signal });
  if (!res.ok || !res.body) throw await errorFrom(res);
  const rate = readRate(res.headers);

  const content: any[] = [];
  const partialJson: Record<number, string> = {};
  const usage: Usage = { input: 0, output: 0, cache_read: 0, cache_write: 0 };
  let stop_reason: string | null = null;
  let firstTokenAt: number | null = null;

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = "";
  const handle = (data: any) => {
    switch (data.type) {
      case "message_start": {
        const u = data.message?.usage ?? {};
        usage.input = u.input_tokens ?? 0;
        usage.cache_read = u.cache_read_input_tokens ?? 0;
        usage.cache_write = u.cache_creation_input_tokens ?? 0;
        usage.output = u.output_tokens ?? 0;
        break;
      }
      case "content_block_start": {
        const block = { ...data.content_block };
        if (block.type === "tool_use" || block.type === "server_tool_use") block.input = {};
        content[data.index] = block;
        h.onBlockStart?.(data.index, block);
        break;
      }
      case "content_block_delta": {
        const b = content[data.index];
        const d = data.delta;
        if (firstTokenAt == null) firstTokenAt = performance.now();
        if (d.type === "text_delta") {
          b.text = (b.text ?? "") + d.text;
          h.onDelta?.(data.index, "text", d.text);
        } else if (d.type === "thinking_delta") {
          b.thinking = (b.thinking ?? "") + d.thinking;
          h.onDelta?.(data.index, "thinking", d.thinking);
        } else if (d.type === "signature_delta") {
          b.signature = (b.signature ?? "") + d.signature;
        } else if (d.type === "input_json_delta") {
          partialJson[data.index] = (partialJson[data.index] ?? "") + d.partial_json;
          h.onDelta?.(data.index, "input", d.partial_json);
        } else if (d.type === "citations_delta") {
          (b.citations ??= []).push(d.citation);
        }
        break;
      }
      case "content_block_stop": {
        const b = content[data.index];
        if (b?.type === "tool_use" || b?.type === "server_tool_use") {
          const raw = partialJson[data.index];
          try {
            b.input = raw ? JSON.parse(raw) : {};
          } catch {
            b.input = {};
          }
        }
        h.onBlockStop?.(data.index, b);
        break;
      }
      case "message_delta":
        stop_reason = data.delta?.stop_reason ?? stop_reason;
        if (data.usage?.output_tokens != null) usage.output = data.usage.output_tokens;
        if (data.usage?.server_tool_use?.web_search_requests != null) usage.web_searches = data.usage.server_tool_use.web_search_requests;
        break;
      case "error":
        throw new ApiError(500, data.error?.message ?? "stream error");
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += value;
    let idx: number;
    while ((idx = buf.indexOf("\n\n")) !== -1) {
      const chunk = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const line = chunk.split("\n").find((l) => l.startsWith("data:"));
      if (!line) continue;
      const json = line.slice(5).trim();
      if (!json) continue;
      handle(JSON.parse(json));
    }
  }
  const end = performance.now();
  const genSecs = firstTokenAt ? (end - firstTokenAt) / 1000 : null;
  return {
    content: content.filter(Boolean),
    stop_reason,
    usage,
    ttft_ms: firstTokenAt ? Math.round(firstTokenAt - started) : null,
    tps: genSecs && genSecs > 0.05 ? usage.output / genSecs : null,
    rate,
  };
}

/** Non-streaming call for the judge and the scribe. Returns concatenated text. */
export async function complete(req: MessageRequest, signal?: AbortSignal): Promise<{ text: string; usage: Usage }> {
  if (isMock()) return mockComplete(req);
  const key = apiKey();
  if (!key) throw new ApiError(401, "No API key set");
  const res = await fetch(`${API}/v1/messages`, { method: "POST", headers: headers(key), body: body(req, false), signal });
  if (!res.ok) throw await errorFrom(res);
  const j: any = await res.json();
  const text = (j.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
  const u = j.usage ?? {};
  return {
    text,
    usage: {
      input: u.input_tokens ?? 0,
      output: u.output_tokens ?? 0,
      cache_read: u.cache_read_input_tokens ?? 0,
      cache_write: u.cache_creation_input_tokens ?? 0,
    },
  };
}

export async function validateKey(key: string): Promise<{ ok: boolean; error?: string }> {
  if (isMock()) return { ok: true };
  try {
    const res = await fetch(`${API}/v1/models?limit=1`, { headers: headers(key) });
    if (res.ok) return { ok: true };
    const e = await errorFrom(res);
    return { ok: false, error: e.message };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// ---------- mock model (ORBIT_MOCK=1) for offline UI work and tests ----------
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const MOCK_DOC = `# Launch plan

## Goal
Ship the public beta on the 14th with the API, docs and a status page.

## Steps
1. Freeze the API on the 7th; only fixes after that.
2. Write the getting started guide and the API reference.
3. Set up the status page and the alerts behind it.
4. Invite the first 50 people from the waiting list.

## Risks
- The billing provider still needs to approve the account.
- Two of the five integration tests fail on Windows.
`;

const MOCK_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Tidy</title>
<style>
  :root { --ink: #1d1b16; --paper: #f7f3ea; --line: #e3dccb; --accent: #2f6f4f; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 17px/1.5 Georgia, "Iowan Old Style", serif; color: var(--ink); background: var(--paper); }
  main { max-width: 560px; margin: 0 auto; padding: 56px 20px; }
  h1 { font-size: 44px; line-height: 1; margin: 0 0 6px; letter-spacing: -0.02em; }
  p.sub { margin: 0 0 32px; color: #6b6556; }
  form { display: flex; gap: 8px; margin-bottom: 20px; }
  input { flex: 1; font: inherit; padding: 12px 14px; border: 1px solid var(--line); border-radius: 10px; background: #fffdf8; }
  button { font: inherit; padding: 0 18px; border: 0; border-radius: 10px; background: var(--accent); color: #fff; cursor: pointer; }
  ul { list-style: none; margin: 0; padding: 0; border-top: 1px solid var(--line); }
  li { display: flex; align-items: center; gap: 12px; padding: 14px 2px; border-bottom: 1px solid var(--line); }
  li.done span { text-decoration: line-through; color: #9a937f; }
  li input { flex: none; width: 20px; height: 20px; accent-color: var(--accent); }
  .count { margin-top: 16px; font-size: 14px; color: #6b6556; }
</style>
</head>
<body>
<main>
  <h1>Tidy</h1>
  <p class="sub">Three things today. Not thirty.</p>
  <form id="f"><input id="t" placeholder="Add a task" aria-label="Add a task"><button>Add</button></form>
  <ul id="l"></ul>
  <p class="count" id="c"></p>
</main>
<script>
  const KEY = "tidy";
  let todos = JSON.parse(localStorage.getItem(KEY) || '[{"text":"Water the basil","done":true},{"text":"Call the landlord","done":false},{"text":"Finish chapter two","done":false}]');
  const save = () => localStorage.setItem(KEY, JSON.stringify(todos));
  function draw() {
    l.innerHTML = "";
    todos.forEach((t, i) => {
      const li = document.createElement("li");
      li.className = t.done ? "done" : "";
      li.innerHTML = '<input type="checkbox"' + (t.done ? " checked" : "") + '><span></span>';
      li.querySelector("span").textContent = t.text;
      li.querySelector("input").onchange = () => { todos[i].done = !todos[i].done; save(); draw(); };
      l.append(li);
    });
    c.textContent = todos.filter((t) => !t.done).length + " left";
  }
  f.onsubmit = (e) => { e.preventDefault(); if (!t.value.trim()) return; todos.push({ text: t.value.trim(), done: false }); t.value = ""; save(); draw(); };
  draw();
</script>
</body>
</html>
`;

async function mockStream(req: MessageRequest, h: StreamHandlers, signal?: AbortSignal): Promise<StreamResult> {
  const last = req.messages[req.messages.length - 1];
  const lastText = (last?.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text).join(" ").toLowerCase();
  const afterTool = (last?.content ?? []).some((b: any) => b.type === "tool_result");
  const blocks: any[] = [];
  blocks.push({ type: "thinking", thinking: "Looking at what was asked and picking the smallest useful next step.", signature: "mock" });
  const lastAsk = req.messages[req.messages.length - 2]?.content ?? [];
  const lastTool = lastAsk.filter((b: any) => b.type === "tool_use").pop()?.name;
  if (req.tools?.some((t: any) => t.name === "submit") && req.tools?.some((t: any) => t.name === "read_page")) {
    // the library's writer: one search, then the draft
    const id = () => "toolu_" + crypto.randomUUID().slice(0, 12);
    const topic = lastText.replace(/^write a (skill|knowledge file) for this:\s*/, "").split(/[.\n]/)[0].trim().slice(0, 60) || "a task";
    const knowledge = /knowledge file/.test(lastText);
    if (!req.messages.some((m: any) => m.role === "assistant")) {
      blocks.push({ type: "server_tool_use", id: "srvtoolu_" + crypto.randomUUID().slice(0, 12), name: "web_search", input: { query: `${topic} best practices` } });
      blocks.push({ type: "text", text: "Reading the best result." });
      blocks.push({ type: "tool_use", id: id(), name: "read_page", input: { url: "https://example.com/" } });
    } else {
      const name = topic.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "my-skill";
      const title = topic.charAt(0).toUpperCase() + topic.slice(1);
      blocks.push({
        type: "tool_use",
        id: id(),
        name: "submit",
        input: knowledge
          ? { name, title, description: `Reference on ${topic}.`, always: false, body: `# ${title}\n\n## Key facts\n\n- A fact worth keeping, with its source.\n` }
          : {
              name,
              title,
              description: `Use when working on ${topic}.`,
              body: `# ${title}\n\n## Steps\n\n1. Look at what exists before changing anything.\n2. Make the smallest change that works.\n3. Check it the way it will be used.\n\n## Before you call it done\n\n- [ ] Checked, and anything open is said plainly.\n`,
            },
      });
    }
  } else if (afterTool && lastTool === "write_file" && req.tools?.some((t: any) => t.name === "screenshot")) {
    blocks.push({ type: "text", text: "Written. Checking it at phone and desktop width." });
    blocks.push({ type: "tool_use", id: "toolu_" + crypto.randomUUID().slice(0, 12), name: "screenshot", input: { target: "index.html", widths: [390, 1280] } });
  } else if (afterTool && lastTool === "screenshot") {
    blocks.push({ type: "text", text: "Both widths hold up: the list stacks on the phone, the header stays on one line, and the console is clean. It's in `index.html`; open it in the preview or straight in a browser." });
  } else if (afterTool) {
    blocks.push({ type: "text", text: "Done. The command finished and the output looks right. Anything else?" });
  } else if (req.tools?.some((t: any) => t.name === "delegate") && /\b(helpers?|in parallel)\b/.test(lastText)) {
    blocks.push({ type: "text", text: "Two separate jobs, so two helpers at once." });
    const id = () => "toolu_" + crypto.randomUUID().slice(0, 12);
    blocks.push({ type: "tool_use", id: id(), name: "delegate", input: { agent: "explorer", name: "Map the folder", task: "List the files in the workspace folder and say what each one is for." } });
    blocks.push({ type: "tool_use", id: id(), name: "delegate", input: { agent: "builder", name: "Clear out dist", task: "Clean out the old dist folder before the next release." } });
  } else if (req.tools?.some((t: any) => t.name === "doc_write") && /\b(doc|plan|spec)\b/.test(lastText) && !/comment|go through/.test(lastText)) {
    blocks.push({ type: "text", text: "Writing the plan as a doc so we can both work on it." });
    blocks.push({ type: "tool_use", id: "toolu_" + crypto.randomUUID().slice(0, 12), name: "doc_write", input: { title: "Launch plan", content: MOCK_DOC } });
  } else if (req.tools?.some((t: any) => t.name === "doc_read") && /go through/.test(lastText) && /\bdoc\b|\(d_/.test(lastText) && !afterTool) {
    const id = lastText.match(/\((d_[a-z0-9]+)\)/)?.[1] ?? "";
    blocks.push({ type: "text", text: "Reading your comments." });
    blocks.push({ type: "tool_use", id: "toolu_" + crypto.randomUUID().slice(0, 12), name: "doc_read", input: { id } });
  } else if (req.tools?.some((t: any) => t.name === "whiteboard") && /\b(board|whiteboard|lay out|options)\b/.test(lastText)) {
    blocks.push({ type: "text", text: "Laying the options out on the board." });
    blocks.push({
      type: "tool_use",
      id: "toolu_" + crypto.randomUUID().slice(0, 12),
      name: "whiteboard",
      input: {
        ops: [
          { op: "add", kind: "frame", ref: "opts", title: "Three ways to host it", x: 0, y: 0, w: 820, h: 300 },
          { op: "add", kind: "note", ref: "a", frame: "opts", text: "Hetzner\n137 CHF a month\nCheapest, backups extra", color: "mint" },
          { op: "add", kind: "note", ref: "b", frame: "opts", text: "UpCloud\n217 CHF a month\nManaged backups", color: "sky" },
          { op: "add", kind: "note", ref: "c", frame: "opts", text: "Infomaniak\n241 CHF a month\nSwiss, green power", color: "lavender" },
          { op: "add", kind: "checklist", ref: "todo", title: "Before we pick", x: 0, y: 360, items: [{ text: "Check egress pricing", done: true }, { text: "Ask about IPv6", done: false }, { text: "Test restore from backup", done: false }] },
          { op: "add", kind: "text", ref: "rec", x: 320, y: 360, w: 460, text: "**Recommendation:** Hetzner, with a nightly offsite backup. The savings pay for the backup twice over." },
          { op: "connect", from: "a", to: "rec", label: "pick" },
        ],
      },
    });
  } else if (req.tools?.some((t: any) => t.type?.startsWith("web_search")) && /search|latest|current|news|price/.test(lastText)) {
    const id = "srvtoolu_" + crypto.randomUUID().slice(0, 12);
    blocks.push({ type: "server_tool_use", id, name: "web_search", input: { query: lastText.slice(0, 60) } });
    blocks.push({
      type: "web_search_tool_result",
      tool_use_id: id,
      content: [
        { type: "web_search_result", url: "https://bun.com/blog", title: "Bun blog", page_age: "2 days ago", encrypted_content: "mock" },
        { type: "web_search_result", url: "https://nodejs.org/en/blog", title: "Node.js blog", page_age: "1 week ago", encrypted_content: "mock" },
      ],
    });
    blocks.push({
      type: "text",
      text: "Bun's latest release improves install speed again.",
      citations: [{ type: "web_search_result_location", url: "https://bun.com/blog", title: "Bun blog", encrypted_index: "mock", cited_text: "Install is faster in this release." }],
    });
    blocks.push({ type: "text", text: " Node.js shipped a security update the same week." , citations: [{ type: "web_search_result_location", url: "https://nodejs.org/en/blog", title: "Node.js blog", encrypted_index: "mock", cited_text: "Security releases for all active lines." }] });
  } else if (req.tools?.some((t: any) => t.name === "preview_open") && /\b(page|site|landing|html|ui)\b/.test(lastText)) {
    blocks.push({ type: "text", text: "One file, no build step. Writing it now; watch the preview." });
    blocks.push({ type: "tool_use", id: "toolu_" + crypto.randomUUID().slice(0, 12), name: "write_file", input: { path: "index.html", content: MOCK_PAGE } });
  } else if (req.tools?.some((t: any) => t.name === "plan") && /\b(build|make|create)\b/.test(lastText)) {
    blocks.push({ type: "text", text: "Planning this first." });
    blocks.push({
      type: "tool_use",
      id: "toolu_" + crypto.randomUUID().slice(0, 12),
      name: "plan",
      input: {
        items: [
          { text: "Pick the stack: one index.html, no build step", status: "done" },
          { text: "Lay out the page: list, input, filters", status: "doing" },
          { text: "Store todos in localStorage", status: "todo" },
          { text: "Check it at phone and desktop width", status: "todo" },
        ],
      },
    });
  } else if (/delete|remove|clean/.test(lastText)) {
    const command = /snapshot|backup/.test(lastText) ? "rm -rf ./old-snapshots/2025-*" : /build|dist/.test(lastText) ? "rm -rf ./dist ./build" : "rm -rf ./tmp";
    blocks.push({ type: "text", text: "I'll remove those with one delete in the workspace folder." });
    blocks.push({ type: "tool_use", id: "toolu_" + crypto.randomUUID().slice(0, 12), name: "bash", input: { command } });
  } else if (/test/.test(lastText)) {
    blocks.push({ type: "text", text: "Running the test suite first to see what fails." });
    blocks.push({ type: "tool_use", id: "toolu_" + crypto.randomUUID().slice(0, 12), name: "bash", input: { command: "ls -la && echo '212 pass, 0 fail'" } });
  } else if (/run|list|files|ls/.test(lastText)) {
    blocks.push({ type: "text", text: "Let me look at the folder first." });
    blocks.push({ type: "tool_use", id: "toolu_" + crypto.randomUUID().slice(0, 12), name: "bash", input: { command: "ls -la" } });
  } else {
    blocks.push({
      type: "text",
      text:
        "This is **mock mode**, so no API call was made.\n\nHere's what a normal reply looks like:\n\n- Lists render as lists\n- `inline code` stays readable\n\n```ts\nconst orbit = { status: \"online\", port: 7777 };\n```\n\nAsk me to *run* something to see the permission flow.",
    });
  }
  let out = 0;
  const t0 = performance.now();
  let first: number | null = null;
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (signal?.aborted) throw new DOMException("aborted", "AbortError");
    if (b.type === "web_search_tool_result") {
      h.onBlockStart?.(i, b);
      h.onBlockStop?.(i, b);
      continue;
    }
    const startBlock = b.type === "text" ? { type: "text", text: "" } : b.type === "thinking" ? { type: "thinking", thinking: "" } : { ...b, input: {} };
    h.onBlockStart?.(i, startBlock);
    const s: string = b.type === "text" ? b.text : b.type === "thinking" ? b.thinking : JSON.stringify(b.input);
    const kind = b.type === "text" ? "text" : b.type === "thinking" ? "thinking" : "input";
    for (let j = 0; j < s.length; j += 4) {
      if (signal?.aborted) throw new DOMException("aborted", "AbortError");
      first ??= performance.now();
      h.onDelta?.(i, kind as any, s.slice(j, j + 4));
      out++;
      await sleep(12);
    }
    h.onBlockStop?.(i, b);
  }
  const secs = (performance.now() - (first ?? t0)) / 1000;
  return {
    content: blocks,
    stop_reason: blocks.some((b) => b.type === "tool_use") ? "tool_use" : "end_turn",
    usage: { input: 1200, output: out, cache_read: 3400, cache_write: 0, web_searches: blocks.filter((b) => b.type === "server_tool_use").length },
    ttft_ms: Math.round((first ?? t0) - t0) + 300,
    tps: out / Math.max(secs, 0.1),
    rate: { tokens_remaining: 1_800_000, tokens_limit: 2_000_000 },
  };
}

async function mockComplete(req: MessageRequest) {
  await sleep(250);
  const sys = req.system.toLowerCase();
  const text = sys.includes("long-term memory")
    ? JSON.stringify({ memories: ["Prefers short answers with the code first."] })
    : sys.includes("judge")
      ? JSON.stringify({ verdict: "ask", reason: "It fits the goal of freeing disk space, but no rule covers deletes here and the pattern is wider than the folders named." })
      : "Mock workspace";
  return { text, usage: { input: 300, output: 30, cache_read: 0, cache_write: 0 } };
}
