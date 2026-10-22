// MCP client. Servers from [mcp.servers] in orbit.toml become tools Claude can call,
// named mcp__<server>__<tool>, and every call passes the gate like any other tool.
// Two transports: a local command speaking JSON-RPC over stdin/stdout, or a URL
// speaking the streamable HTTP transport (JSON or an event stream per request).

import type { Subprocess } from "bun";
import { config, type McpServer } from "./config";
import { broadcast } from "./hub";
import { quietEnv } from "./catalog";

const PROTOCOL = "2025-06-18";
const CALL_TIMEOUT = 120_000;
const MAX_RESULT = 100_000;

export interface McpTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, any>;
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; title?: string };
}

export interface McpStatus {
  name: string;
  state: "off" | "connecting" | "ready" | "error";
  error?: string;
  tools: { name: string; description?: string; readOnly: boolean }[];
  transport: "stdio" | "http";
  serverName?: string;
}

type Pending = { resolve: (v: any) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> };

abstract class Connection {
  protected nextId = 1;
  constructor(readonly name: string, readonly spec: McpServer) {}
  abstract request(method: string, params?: any, timeout?: number): Promise<any>;
  abstract notify(method: string, params?: any): Promise<void>;
  abstract close(): void;
}

class StdioConnection extends Connection {
  private proc: Subprocess<"pipe", "pipe", "pipe">;
  private pending = new Map<number, Pending>();
  private buf = "";
  stderr = "";
  closed = false;

  constructor(name: string, spec: McpServer, cwd: string) {
    super(name, spec);
    const [cmd, ...args] = [spec.command!, ...(spec.args ?? [])];
    this.proc = Bun.spawn([cmd, ...args], {
      cwd,
      env: { ...process.env, ...quietEnv(), ...(spec.env ?? {}) },
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    this.read(this.proc.stdout, (line) => this.onLine(line));
    this.read(this.proc.stderr, (line) => (this.stderr = (this.stderr + line + "\n").slice(-4000)));
    this.proc.exited.then((code) => {
      this.closed = true;
      const err = new Error(`${name} stopped (exit ${code})${this.stderr.trim() ? `: ${this.stderr.trim().split("\n").slice(-2).join(" ")}` : ""}`);
      for (const p of this.pending.values()) {
        clearTimeout(p.timer);
        p.reject(err);
      }
      this.pending.clear();
      onClosed(name, err.message, this);
    });
  }

  private async read(stream: ReadableStream<Uint8Array>, onLine: (l: string) => void) {
    const dec = new TextDecoder();
    let rest = "";
    for await (const chunk of stream) {
      rest += dec.decode(chunk, { stream: true });
      let i: number;
      while ((i = rest.indexOf("\n")) >= 0) {
        const line = rest.slice(0, i).trim();
        rest = rest.slice(i + 1);
        if (line) onLine(line);
      }
    }
  }

  private onLine(line: string) {
    let msg: any;
    try {
      msg = JSON.parse(line);
    } catch {
      return; // servers sometimes log to stdout; ignore what isn't JSON-RPC
    }
    if (msg.id !== undefined && (msg.result !== undefined || msg.error)) {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.error) p.reject(new Error(msg.error.message ?? "MCP error"));
      else p.resolve(msg.result);
    } else if (msg.id !== undefined && msg.method) {
      // a request from the server (sampling, roots, elicitation): we offer none of them
      this.write({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "Not supported by Orbit" } });
    } else if (msg.method === "notifications/tools/list_changed") {
      refreshTools(this.name);
    }
  }

  private write(obj: unknown) {
    if (this.closed) throw new Error(`${this.name} isn't running`);
    this.proc.stdin.write(JSON.stringify(obj) + "\n");
    this.proc.stdin.flush();
  }

  request(method: string, params?: any, timeout = CALL_TIMEOUT) {
    const id = this.nextId++;
    return new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${this.name} didn't answer ${method} in ${Math.round(timeout / 1000)} s`));
      }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.write({ jsonrpc: "2.0", id, method, params });
      } catch (e) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(e as Error);
      }
    });
  }

  async notify(method: string, params?: any) {
    this.write({ jsonrpc: "2.0", method, params });
  }

  close() {
    this.closed = true;
    try {
      this.proc.kill();
    } catch {}
  }
}

class HttpConnection extends Connection {
  private session: string | null = null;

  private async post(body: object, timeout: number): Promise<any> {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": PROTOCOL,
      ...(this.spec.headers ?? {}),
    };
    if (this.session) headers["mcp-session-id"] = this.session;
    const res = await fetch(this.spec.url!, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(timeout) });
    const sid = res.headers.get("mcp-session-id");
    if (sid) this.session = sid;
    if (res.status === 202) return null;
    if (!res.ok) throw new Error(`${this.name} answered ${res.status}${res.status === 401 ? ": it needs a token in headers" : ""}`);
    const type = res.headers.get("content-type") ?? "";
    const id = (body as any).id;
    if (type.includes("text/event-stream")) {
      // read events until the response to our id arrives
      const text = res.body!.pipeThrough(new TextDecoderStream());
      let buf = "";
      for await (const chunk of text) {
        buf += chunk;
        let i: number;
        while ((i = buf.indexOf("\n\n")) >= 0) {
          const event = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const data = event
            .split("\n")
            .filter((l) => l.startsWith("data:"))
            .map((l) => l.slice(5).trimStart())
            .join("\n");
          if (!data) continue;
          try {
            const msg = JSON.parse(data);
            if (msg.id === id) return msg;
          } catch {}
        }
      }
      throw new Error(`${this.name} closed the stream without an answer`);
    }
    return res.json();
  }

  async request(method: string, params?: any, timeout = CALL_TIMEOUT) {
    const msg = await this.post({ jsonrpc: "2.0", id: this.nextId++, method, params }, timeout);
    if (msg?.error) throw new Error(msg.error.message ?? "MCP error");
    return msg?.result;
  }
  async notify(method: string, params?: any) {
    await this.post({ jsonrpc: "2.0", method, params }, 15_000).catch(() => {});
  }
  close() {
    if (this.session)
      fetch(this.spec.url!, { method: "DELETE", headers: { "mcp-session-id": this.session, ...(this.spec.headers ?? {}) } }).catch(() => {});
  }
}

// ---------- the registry ----------
interface Entry {
  conn?: Connection;
  status: McpStatus;
  tools: McpTool[];
  ready?: Promise<void>;
}
const servers = new Map<string, Entry>();

const safe = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, "_");
export const toolName = (server: string, tool: string) => `mcp__${safe(server)}__${safe(tool)}`.slice(0, 64);

function emit() {
  broadcast("mcp", { servers: mcpStatus() });
}

function onClosed(name: string, error: string, conn: Connection) {
  const e = servers.get(name);
  // an older connection that was replaced on purpose says nothing about the current one
  if (!e || e.conn !== conn) return;
  e.conn = undefined;
  e.ready = undefined;
  if (e.status.state !== "off") {
    e.status.state = "error";
    e.status.error = error;
  }
  emit();
}

async function connect(name: string, spec: McpServer): Promise<void> {
  const transport = spec.url ? "http" : "stdio";
  const entry: Entry = servers.get(name) ?? { status: { name, state: "connecting", tools: [], transport }, tools: [] };
  servers.set(name, entry);
  entry.status = { name, state: "connecting", tools: [], transport };
  emit();
  try {
    if (!spec.url && !spec.command) throw new Error("Give it a command or a url");
    const conn = spec.url ? new HttpConnection(name, spec) : new StdioConnection(name, spec, process.cwd());
    entry.conn = conn;
    const init = await conn.request(
      "initialize",
      { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: "orbit", version: "0.2" } },
      30_000,
    );
    await conn.notify("notifications/initialized");
    entry.status.serverName = init?.serverInfo?.name;
    await loadTools(entry);
    entry.status.state = "ready";
    entry.status.error = undefined;
  } catch (e) {
    entry.status.state = "error";
    entry.status.error = (e as Error).message;
    entry.conn?.close();
    entry.conn = undefined;
  }
  emit();
}

async function loadTools(entry: Entry) {
  const tools: McpTool[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 20; page++) {
    const r = await entry.conn!.request("tools/list", cursor ? { cursor } : {}, 30_000);
    tools.push(...(r?.tools ?? []));
    cursor = r?.nextCursor;
    if (!cursor) break;
  }
  entry.tools = tools;
  entry.status.tools = tools.map((t) => ({ name: t.name, description: t.description, readOnly: !!t.annotations?.readOnlyHint }));
}

async function refreshTools(name: string) {
  const e = servers.get(name);
  if (!e?.conn) return;
  await loadTools(e).catch(() => {});
  emit();
}

/** Bring the running servers in line with the config: start new ones, stop removed or switched off ones. */
export function syncMcp() {
  const want = config().mcp?.servers ?? {};
  for (const [name, e] of servers) {
    const spec = want[name];
    if (!spec || spec.enabled === false || JSON.stringify(spec) !== (e as any).specKey) {
      e.conn?.close();
      servers.delete(name);
    }
  }
  for (const [name, spec] of Object.entries(want)) {
    if (servers.has(name)) continue;
    if (spec.enabled === false) {
      servers.set(name, { status: { name, state: "off", tools: [], transport: spec.url ? "http" : "stdio" }, tools: [] });
      continue;
    }
    const entry: Entry = { status: { name, state: "connecting", tools: [], transport: spec.url ? "http" : "stdio" }, tools: [] };
    (entry as any).specKey = JSON.stringify(spec);
    servers.set(name, entry);
    entry.ready = connect(name, spec);
  }
  emit();
}

export async function reconnect(name: string) {
  const spec = config().mcp?.servers?.[name];
  if (!spec) throw new Error("No such server");
  servers.get(name)?.conn?.close();
  servers.delete(name);
  const entry: Entry = { status: { name, state: "connecting", tools: [], transport: spec.url ? "http" : "stdio" }, tools: [] };
  (entry as any).specKey = JSON.stringify(spec);
  servers.set(name, entry);
  await (entry.ready = connect(name, spec));
}

export function mcpStatus(): McpStatus[] {
  return [...servers.values()].map((e) => e.status);
}

export function stopAllMcp() {
  for (const e of servers.values()) e.conn?.close();
}

// ---------- as tools ----------
export interface McpToolDef {
  name: string;
  description: string;
  input_schema: Record<string, any>;
  readOnly: boolean;
  server: string;
  tool: string;
}

export function mcpTools(): McpToolDef[] {
  const out: McpToolDef[] = [];
  const trust = config().mcp?.servers ?? {};
  for (const [server, e] of servers) {
    if (e.status.state !== "ready") continue;
    for (const t of e.tools) {
      out.push({
        name: toolName(server, t.name),
        description: `[${server}] ${(t.description ?? t.annotations?.title ?? t.name).slice(0, 1000)}`,
        input_schema: t.inputSchema && t.inputSchema.type === "object" ? t.inputSchema : { type: "object", properties: {} },
        readOnly: trust[server]?.trust_readonly !== false && !!t.annotations?.readOnlyHint && !t.annotations?.destructiveHint,
        server,
        tool: t.name,
      });
    }
  }
  return out;
}

export const findMcpTool = (name: string) => mcpTools().find((t) => t.name === name);

/** Run a tool and turn its content blocks into text Claude can read. */
export async function callMcp(name: string, args: any): Promise<{ content: string; isError?: boolean }> {
  const def = findMcpTool(name);
  if (!def) return { content: `The MCP tool ${name} isn't available right now.`, isError: true };
  const e = servers.get(def.server);
  if (!e?.conn) return { content: `${def.server} isn't connected.`, isError: true };
  try {
    const r = await e.conn.request("tools/call", { name: def.tool, arguments: args ?? {} });
    const parts: string[] = [];
    for (const c of r?.content ?? []) {
      if (c.type === "text") parts.push(c.text);
      else if (c.type === "resource") parts.push(c.resource?.text ?? `[resource ${c.resource?.uri}]`);
      else if (c.type === "resource_link") parts.push(`[link ${c.name ?? ""} ${c.uri}]`);
      else parts.push(`[${c.type} content not shown]`);
    }
    if (!parts.length && r?.structuredContent) parts.push(JSON.stringify(r.structuredContent, null, 2));
    let text = parts.join("\n\n") || "(no output)";
    if (text.length > MAX_RESULT) text = text.slice(0, MAX_RESULT) + `\n\n(cut at ${MAX_RESULT} characters)`;
    return { content: text, isError: !!r?.isError };
  } catch (err) {
    return { content: `${def.server}: ${(err as Error).message}`, isError: true };
  }
}

/** What a rule pattern is matched against: "mcp linear create_issue {...}" with shell operators taken out. */
export function mcpSubject(name: string, args: any) {
  const def = findMcpTool(name);
  const json = JSON.stringify(args ?? {}).replace(/[;&|`$()<>\n]/g, " ").slice(0, 2000);
  return def ? `mcp ${def.server} ${def.tool} ${json}` : `${name} ${json}`;
}
