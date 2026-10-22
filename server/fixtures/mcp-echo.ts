// A tiny MCP server over stdio for tests: one read-only tool and one that writes.
export {};
const tools = [
  { name: "echo", description: "Repeat the text", inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] }, annotations: { readOnlyHint: true } },
  { name: "write_note", description: "Save a note", inputSchema: { type: "object", properties: { text: { type: "string" } } }, annotations: { destructiveHint: true } },
];
const send = (m: unknown) => process.stdout.write(JSON.stringify(m) + "\n");
console.log("starting up (a log line on stdout that isn't JSON-RPC)");
let buf = "";
for await (const chunk of Bun.stdin.stream()) {
  buf += new TextDecoder().decode(chunk);
  let i: number;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i);
    buf = buf.slice(i + 1);
    if (!line.trim()) continue;
    const m = JSON.parse(line);
    if (m.method === "initialize") send({ jsonrpc: "2.0", id: m.id, result: { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "echo-test", version: "1" } } });
    else if (m.method === "tools/list") send({ jsonrpc: "2.0", id: m.id, result: { tools } });
    else if (m.method === "tools/call") {
      if (m.params.name === "echo") send({ jsonrpc: "2.0", id: m.id, result: { content: [{ type: "text", text: `echo: ${m.params.arguments.text}` }] } });
      else send({ jsonrpc: "2.0", id: m.id, result: { content: [{ type: "text", text: "no disk here" }], isError: true } });
    } else if (m.id !== undefined) send({ jsonrpc: "2.0", id: m.id, error: { code: -32601, message: "unknown" } });
  }
}
