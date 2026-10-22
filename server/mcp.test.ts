import { afterAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { config, loadConfig } from "./config";
import { callMcp, mcpStatus, mcpSubject, mcpTools, reconnect, stopAllMcp, syncMcp } from "./mcp";
import { enabledTools, isReadOnly, subjectOf } from "./tools";

loadConfig();

// a streamable HTTP server that answers with an event stream
const http = Bun.serve({
  port: 0,
  async fetch(req) {
    if (req.method !== "POST") return new Response(null, { status: 200 });
    const m = await req.json();
    if (!("id" in m)) return new Response(null, { status: 202 });
    const result =
      m.method === "initialize"
        ? { protocolVersion: "2025-06-18", capabilities: {}, serverInfo: { name: "remote-test" } }
        : m.method === "tools/list"
          ? { tools: [{ name: "search", description: "Find things", inputSchema: { type: "object", properties: { q: { type: "string" } } }, annotations: { readOnlyHint: true } }] }
          : { content: [{ type: "text", text: `found ${m.params.arguments.q}` }] };
    const body = `event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: m.id, result })}\n\n`;
    return new Response(body, { headers: { "content-type": "text/event-stream", "mcp-session-id": "s1" } });
  },
});

afterAll(() => {
  stopAllMcp();
  http.stop(true);
});

describe("MCP servers", () => {
  test("a local server over stdio and a remote one over HTTP become tools", async () => {
    config().mcp.servers = {
      notes: { command: process.execPath, args: [join(import.meta.dir, "fixtures/mcp-echo.ts")] },
      remote: { url: `http://localhost:${http.port}/mcp` },
      broken: { command: "orbit-no-such-command-anywhere" },
    };
    syncMcp();
    await reconnect("notes");
    await reconnect("remote");
    await reconnect("broken").catch(() => {});
    const st = Object.fromEntries(mcpStatus().map((s) => [s.name, s]));
    expect(st.notes.state).toBe("ready");
    expect(st.notes.serverName).toBe("echo-test");
    expect(st.remote.state).toBe("ready");
    expect(st.broken.state).toBe("error");
    expect(mcpTools().map((t) => t.name).sort()).toEqual(["mcp__notes__echo", "mcp__notes__write_note", "mcp__remote__search"]);
    expect(enabledTools().some((t) => t.name === "mcp__remote__search")).toBe(true);
  });

  test("calls return text, and errors are marked", async () => {
    expect(await callMcp("mcp__notes__echo", { text: "hi" })).toEqual({ content: "echo: hi", isError: false });
    expect((await callMcp("mcp__notes__write_note", {})).isError).toBe(true);
    expect((await callMcp("mcp__remote__search", { q: "x" })).content).toBe("found x");
  });

  test("only tools marked read-only skip the gate, and trust can be withdrawn", () => {
    expect(isReadOnly("mcp__notes__echo", {})).toBe(true);
    expect(isReadOnly("mcp__notes__write_note", {})).toBe(false);
    config().mcp.servers.notes.trust_readonly = false;
    expect(isReadOnly("mcp__notes__echo", {})).toBe(false);
    config().mcp.servers.notes.trust_readonly = true;
  });

  test("rules see the server, the tool and the arguments without shell operators", () => {
    expect(subjectOf("mcp__notes__echo", { text: "a; rm -rf $(x)" }, "/")).toBe(mcpSubject("mcp__notes__echo", { text: "a; rm -rf $(x)" }));
    expect(mcpSubject("mcp__notes__echo", { text: "a; b" })).toBe('mcp notes echo {"text":"a  b"}');
  });
});
