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
        if (block.type === "tool_use") block.input = {};
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

async function mockStream(req: MessageRequest, h: StreamHandlers, signal?: AbortSignal): Promise<StreamResult> {
  const last = req.messages[req.messages.length - 1];
  const lastText = (last?.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text).join(" ").toLowerCase();
  const afterTool = (last?.content ?? []).some((b: any) => b.type === "tool_result");
  const blocks: any[] = [];
  blocks.push({ type: "thinking", thinking: "Looking at what was asked and picking the smallest useful next step.", signature: "mock" });
  if (afterTool) {
    blocks.push({ type: "text", text: "Done. The command finished and the output looks right. Anything else?" });
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
    usage: { input: 1200, output: out, cache_read: 3400, cache_write: 0 },
    ttft_ms: Math.round((first ?? t0) - t0) + 300,
    tps: out / Math.max(secs, 0.1),
    rate: { tokens_remaining: 1_800_000, tokens_limit: 2_000_000 },
  };
}

async function mockComplete(req: MessageRequest) {
  await sleep(250);
  const sys = req.system.toLowerCase();
  const text = sys.includes("judge")
    ? JSON.stringify({ verdict: "ask", reason: "It fits the goal of freeing disk space, but no rule covers deletes here and the pattern is wider than the folders named." })
    : "Mock workspace";
  return { text, usage: { input: 300, output: 30, cache_read: 0, cache_write: 0 } };
}
