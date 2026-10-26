// Orbit plugin SDK for TypeScript and JavaScript. One file, no dependencies:
// copy it next to your plugin (new plugins get it automatically) and import it.
// Runs on Bun or Node. Protocol: docs/PLUGINS.md.
//
//   import { plugin } from "./orbit-plugin";
//
//   plugin.tool("weather", "Today's weather for a city", { city: "string" }, async ({ city }) => {
//     return `Sunny in ${city}`;
//   });
//
//   plugin.start();

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
export type Schema = Record<string, any>;

export interface ToolContext {
  /** the workspace Claude is working in */
  workspace: string;
  /** that workspace's folder */
  cwd: string;
  /** the id of this tool call */
  call: string;
}
export type ToolResult = string | { content: Json; is_error?: boolean };
export interface ToolOptions {
  /** only reads: runs without asking, like reading a file */
  readOnly?: boolean;
  timeoutS?: number;
}

export interface CommandContext {
  /** the text after the command */
  args: string;
  /** the workspace it was typed in, if any */
  workspace: string | null;
}
/** A command can answer with text shown to the user, and send a message to Claude. */
export type CommandResult = string | void | { reply?: string; send?: string; open?: string };

export interface HttpRequest {
  method: string;
  path: string;
  query: Record<string, string>;
  headers: Record<string, string>;
  body: Json;
}
export type HttpResponse = Json | { status?: number; headers?: Record<string, string>; body?: Json };

export interface BeforeTool {
  workspace: { id: string; title: string; cwd: string };
  tool: string;
  input: any;
  /** the action in words, like "rm -rf build" or "write src/app.ts" */
  subject: string;
}
export type Verdict = void | { decision: "allow" | "deny" | "ask"; reason?: string };

type Handler = (params: any) => any;

class Plugin {
  private tools = new Map<string, { description: string; input_schema: Schema; read_only: boolean; timeout_s?: number; run: (input: any, ctx: ToolContext) => Promise<ToolResult> | ToolResult }>();
  private commands = new Map<string, { description: string; run: (ctx: CommandContext) => Promise<CommandResult> | CommandResult }>();
  private routes: { method: string; path: string | RegExp; run: (req: HttpRequest) => Promise<HttpResponse> | HttpResponse }[] = [];
  private hooks = new Map<string, Handler[]>();
  private eventHandlers = new Map<string, ((e: any) => void)[]>();
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  private started = false;
  private onStart: ((info: { settings: Record<string, Json> }) => void | Promise<void>)[] = [];
  private onSettings: ((s: Record<string, Json>) => void)[] = [];
  private onStop: (() => void | Promise<void>)[] = [];

  /** This plugin's settings, as the user set them (secrets included). */
  settings: Record<string, Json> = {};
  /** The plugin's id, folder and a folder for its own data. */
  id = process.env.ORBIT_PLUGIN_ID ?? "";
  dir = process.env.ORBIT_PLUGIN_DIR ?? process.cwd();
  dataDir = process.env.ORBIT_PLUGIN_DATA ?? process.cwd();

  // ---------- what the plugin offers ----------

  /** A tool Claude can call. `input` is a JSON schema, or short: { city: "string", days: "number?" }. */
  tool<I = any>(name: string, description: string, input: Schema, run: (input: I, ctx: ToolContext) => Promise<ToolResult> | ToolResult, opts: ToolOptions = {}) {
    this.tools.set(name, { description, input_schema: input, read_only: !!opts.readOnly, timeout_s: opts.timeoutS, run });
    return this;
  }

  /** A slash command the user types: /name args. */
  command(name: string, description: string, run: (ctx: CommandContext) => Promise<CommandResult> | CommandResult) {
    this.commands.set(name.replace(/^\//, ""), { description, run });
    return this;
  }

  /** An HTTP route under /plugins/<id>/api, for your panel or anything local. */
  route(method: string, path: string | RegExp, run: (req: HttpRequest) => Promise<HttpResponse> | HttpResponse) {
    this.routes.push({ method: method.toUpperCase(), path, run });
    return this;
  }

  /** Asked before every tool runs (needs "before_tool" in hooks and the "approvals" permission). */
  beforeTool(fn: (call: BeforeTool) => Promise<Verdict> | Verdict) {
    return this.hook("before_tool", fn);
  }
  /** After every tool ran. */
  afterTool(fn: (call: { workspace: string; tool: string; input: any; status: string; output: string }) => void) {
    return this.hook("after_tool", fn);
  }
  /** When Claude starts or finishes a turn, or a message is added. */
  onTurnStart(fn: (e: { workspaceId: string }) => void) {
    return this.hook("turn_start", fn);
  }
  onTurnEnd(fn: (e: { workspaceId: string; reason: string }) => void) {
    return this.hook("turn_end", fn);
  }
  onMessage(fn: (e: { workspaceId: string; message: any }) => void) {
    return this.hook("message", fn);
  }
  onApproval(fn: (e: any) => void) {
    return this.hook("approval", fn);
  }
  private hook(name: string, fn: Handler) {
    this.hooks.set(name, [...(this.hooks.get(name) ?? []), fn]);
    return this;
  }

  /** Every Orbit event of a type ("*" for all). Needs the "events" permission. */
  on(type: string, fn: (e: any) => void) {
    this.eventHandlers.set(type, [...(this.eventHandlers.get(type) ?? []), fn]);
    if (this.started) this.subscribe();
    return this;
  }

  /** Runs once Orbit has said hello; settings are ready. */
  ready(fn: (info: { settings: Record<string, Json> }) => void | Promise<void>) {
    this.onStart.push(fn);
    return this;
  }
  settingsChanged(fn: (s: Record<string, Json>) => void) {
    this.onSettings.push(fn);
    return this;
  }
  stopping(fn: () => void | Promise<void>) {
    this.onStop.push(fn);
    return this;
  }

  // ---------- what the plugin can ask Orbit ----------

  /** Raw call to any method in docs/PLUGINS.md. */
  call<T = any>(method: string, params: Json | object = {}): Promise<T> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.write({ jsonrpc: "2.0", id, method, params });
    });
  }

  log(...parts: unknown[]) {
    this.write({ jsonrpc: "2.0", method: "orbit.log", params: { message: parts.map((p) => (typeof p === "string" ? p : JSON.stringify(p))).join(" ") } });
  }
  toast(title: string, body = "", tone: "info" | "good" | "warn" | "bad" = "info") {
    return this.call("orbit.ui.toast", { title, body, tone });
  }
  /** A system notification on the computer, and an alert on paired phones. */
  notify(title: string, body = "") {
    return this.call("orbit.ui.notify", { title, body });
  }

  readonly storage = {
    get: <T = Json>(key: string) => this.call<T | null>("orbit.storage.get", { key }),
    set: (key: string, value: Json) => this.call("orbit.storage.set", { key, value }),
    delete: (key: string) => this.call("orbit.storage.delete", { key }),
    all: () => this.call<Record<string, Json>>("orbit.storage.all"),
  };

  readonly workspaces = {
    list: () => this.call<any[]>("orbit.workspaces.list"),
    get: (id: string) => this.call<any>("orbit.workspaces.get", { id }),
    create: (o: { title?: string; cwd?: string; profile?: string; mode?: string } = {}) => this.call<any>("orbit.workspaces.create", o),
    /** Send a message to Claude in a workspace (joins a running turn). */
    send: (workspace: string, text: string) => this.call("orbit.workspaces.send", { workspace, text }),
    stop: (id: string) => this.call("orbit.workspaces.stop", { id }),
  };

  /**
   * Let Claude do a task with all of Orbit's tools and the gate in front of them.
   * Creates a workspace unless you pass one. Resolves with Claude's last reply.
   */
  agent(prompt: string, o: { workspace?: string; cwd?: string; profile?: string; title?: string; wait?: boolean; timeoutS?: number } = {}) {
    return this.call<{ workspace: string; reason: string; text: string; cost: number | null }>("orbit.agent.run", { prompt, ...o, timeout_s: o.timeoutS });
  }

  /** One model call, billed to Orbit's budget. The plugin never sees the API key. */
  model(o: { prompt?: string; system?: string; messages?: any[]; model?: string; maxTokens?: number }) {
    return this.call<{ text: string; model: string; cost: number }>("orbit.model.complete", { ...o, max_tokens: o.maxTokens });
  }

  readonly approvals = {
    list: () => this.call<any[]>("orbit.approvals.list"),
    answer: (id: string, decision: "allow" | "always" | "deny") => this.call("orbit.approvals.answer", { id, decision }),
  };

  /** Any part of Orbit's HTTP API (needs the "api" permission). */
  api<T = any>(method: string, path: string, body?: Json | object) {
    return this.call<{ status: number; body: T }>("orbit.api", { method, path, body });
  }

  // ---------- running ----------

  /** Start answering Orbit. Call once, after registering everything. */
  start() {
    let buf = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk: string) => {
      buf += chunk;
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (line) this.receive(line);
      }
    });
    process.stdin.on("end", () => process.exit(0));
    // console.log would break the protocol: send it to Orbit's log instead
    console.log = (...a: unknown[]) => this.log(...a);
    console.info = console.log;
    console.debug = console.log;
    return this;
  }

  private write(msg: object) {
    process.stdout.write(JSON.stringify(msg) + "\n");
  }

  private subscribe() {
    if (this.eventHandlers.size) this.call("orbit.events.subscribe", { types: [...this.eventHandlers.keys()] }).catch((e) => this.log(`subscribe: ${e.message}`));
  }

  private async receive(line: string) {
    let msg: any;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    if (msg.id != null && !msg.method) {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.error) p.reject(Object.assign(new Error(msg.error.message), { code: msg.error.code }));
      else p.resolve(msg.result);
      return;
    }
    const reply = (result: unknown) => msg.id != null && this.write({ jsonrpc: "2.0", id: msg.id, result: result ?? null });
    const fail = (e: unknown) => msg.id != null && this.write({ jsonrpc: "2.0", id: msg.id, error: { code: -32000, message: e instanceof Error ? e.message : String(e) } });
    try {
      reply(await this.handle(msg.method, msg.params ?? {}));
    } catch (e) {
      fail(e);
    }
  }

  private async handle(method: string, p: any): Promise<unknown> {
    switch (method) {
      case "initialize": {
        this.settings = p.settings ?? {};
        this.started = true;
        setTimeout(async () => {
          this.subscribe();
          for (const f of this.onStart) await f({ settings: this.settings });
        });
        return {
          tools: [...this.tools].map(([name, t]) => ({ name, description: t.description, input_schema: t.input_schema, read_only: t.read_only, timeout_s: t.timeout_s })),
          commands: [...this.commands].map(([name, c]) => ({ name, description: c.description })),
        };
      }
      case "tool.call": {
        const t = this.tools.get(p.name);
        if (!t) throw new Error(`No tool ${p.name}`);
        const r = await t.run(p.input ?? {}, { workspace: p.workspace, cwd: p.cwd, call: p.call });
        return typeof r === "string" ? { content: r } : r;
      }
      case "command.run": {
        const c = this.commands.get(p.name);
        if (!c) throw new Error(`No command /${p.name}`);
        const r = await c.run({ args: p.args ?? "", workspace: p.workspace ?? null });
        return typeof r === "string" ? { reply: r } : r ?? {};
      }
      case "http.request": {
        const req = p as HttpRequest;
        const route = this.routes.find((r) => (r.method === "*" || r.method === req.method) && (typeof r.path === "string" ? r.path === req.path : r.path.test(req.path)));
        if (!route) return { status: 404, body: { error: `No route ${req.method} ${req.path}` } };
        return route.run(req);
      }
      case "settings":
        this.settings = p ?? {};
        for (const f of this.onSettings) f(this.settings);
        return null;
      case "event":
        for (const k of [p.type, "*"]) for (const f of this.eventHandlers.get(k) ?? []) f(p);
        return null;
      case "shutdown":
        for (const f of this.onStop) await f();
        setTimeout(() => process.exit(0), 50);
        return null;
      default: {
        if (method.startsWith("hook.")) {
          const fns = this.hooks.get(method.slice(5)) ?? [];
          let verdict: Verdict = undefined;
          for (const f of fns) {
            const v = await f(p);
            if (v && !verdict) verdict = v;
            if (v?.decision === "deny") break;
          }
          return verdict ?? null;
        }
        throw new Error(`Unknown method ${method}`);
      }
    }
  }
}

/** The plugin. Register tools, commands, routes and hooks on it, then call start(). */
export const plugin = new Plugin();
export default plugin;
