// End-to-end check against a running server in mock mode: node-free, uses Bun's WebSocket.
const base = process.argv[2] ?? "http://localhost:7791";
const res = await fetch(base + "/");
const cookie = res.headers.get("set-cookie")!.split(";")[0];
const H = { cookie, "content-type": "application/json" };
const api = (p: string, init: RequestInit = {}) => fetch(base + p, { ...init, headers: H }).then((r) => r.json());

const ws = await api("/api/workspaces", { method: "POST", body: JSON.stringify({}) });
console.log("workspace", ws.id, ws.cwd, ws.mode);
const sock = new WebSocket(base.replace("http", "ws") + "/ws", { headers: { cookie } } as any);
const events: any[] = [];
const waitFor = (pred: (e: any) => boolean, ms = 15000) =>
  new Promise<any>((ok, no) => {
    const found = events.find(pred);
    if (found) return ok(found);
    const t = setTimeout(() => no(new Error("timeout")), ms);
    const h = (m: MessageEvent) => {
      const e = JSON.parse(m.data);
      if (pred(e)) { clearTimeout(t); sock.removeEventListener("message", h); ok(e); }
    };
    sock.addEventListener("message", h);
  });
sock.addEventListener("message", (m) => events.push(JSON.parse(m.data)));
await new Promise((r) => sock.addEventListener("open", r));

// 1) read-only command runs without asking
sock.send(JSON.stringify({ type: "send", workspaceId: ws.id, text: "list the files please" }));
const call1 = await waitFor((e) => e.type === "tool_call" && e.call.status === "done");
console.log("1 read-only:", call1.call.subject, "→", call1.call.decided_by);
await waitFor((e) => e.type === "turn_end");
const speed = events.find((e) => e.type === "speed");
const usage = events.find((e) => e.type === "usage");
console.log("  speed event:", !!speed, " usage cost:", usage?.cost.toFixed(5), " ctx:", usage?.context_used);

// 2) destructive command asks in manual mode; answer "always"
events.length = 0;
sock.send(JSON.stringify({ type: "send", workspaceId: ws.id, text: "delete the temp folder" }));
const ask = await waitFor((e) => e.type === "approval_request");
console.log("2 asked:", ask.subject, " suggestion:", ask.suggestion);
sock.send(JSON.stringify({ type: "approval", id: ask.id, decision: "always", pattern: ask.subject }));
const call2 = await waitFor((e) => e.type === "tool_call" && e.call.id === ask.id && ["done", "error"].includes(e.call.status));
console.log("  ran:", call2.call.status, call2.call.decided_by);
await waitFor((e) => e.type === "turn_end");

// 3) same command now matches the rule, no question
events.length = 0;
sock.send(JSON.stringify({ type: "send", workspaceId: ws.id, text: "delete it again" }));
const call3 = await waitFor((e) => e.type === "tool_call" && ["done", "error"].includes(e.call.status));
console.log("3 rule:", call3.call.decided_by, "-", call3.call.reason);
await waitFor((e) => e.type === "turn_end");

// 4) auto mode with a fresh workspace: judge (mock says ask) → user denies
const w2 = await api("/api/workspaces", { method: "POST", body: JSON.stringify({ mode: "auto" }) });
events.length = 0;
sock.send(JSON.stringify({ type: "send", workspaceId: w2.id, text: "clean up and remove the temp stuff" }));
const ask2 = await waitFor((e) => e.type === "approval_request");
console.log("4 judge said:", ask2.judge?.verdict, "-", ask2.judge?.reason);
sock.send(JSON.stringify({ type: "approval", id: ask2.id, decision: "deny" }));
const call4 = await waitFor((e) => e.type === "tool_call" && e.call.status === "denied");
console.log("  denied, model told:", call4.call.output.slice(0, 60));
await waitFor((e) => e.type === "turn_end");

// 5) title, detail, clear, search
await new Promise((r) => setTimeout(r, 600));
const detail = await api(`/api/workspaces/${ws.id}`);
console.log("5 title:", detail.workspace.title, " messages:", detail.messages.length, " calls:", detail.calls.length);
const hits = await api(`/api/search?q=delete`);
console.log("  search hits:", hits.length);
const cleared = await api(`/api/workspaces/${ws.id}/clear`, { method: "POST", body: JSON.stringify({ keepSummary: true }) });
console.log("  cleared, summary:", cleared.summary.slice(0, 40));
const after = await api(`/api/workspaces/${ws.id}`);
console.log("  messages after clear:", after.messages.length);
const rules = await api(`/api/rules?workspace=${ws.id}`);
console.log("  rules:", rules.map((r: any) => `${r.verdict} ${r.pattern}`).join(", "));

// 6) two helpers at once; the builder's delete asks, and the question names the helper and its parent
events.length = 0;
sock.send(JSON.stringify({ type: "send", workspaceId: ws.id, text: "use helpers: map the folder and clear out dist" }));
const hask = await waitFor((e) => e.type === "approval_request" && e.parentId === ws.id, 20000);
console.log("6 helper asked:", hask.subject, " from", hask.agent, "for", hask.parentTitle ? "its parent" : "?");
sock.send(JSON.stringify({ type: "approval", id: hask.id, decision: "allow" }));
await waitFor((e) => e.type === "turn_end" && e.workspaceId === ws.id, 30000);
const withHelpers = await api(`/api/workspaces/${ws.id}`);
const hs = withHelpers.workspace.helpers;
console.log("  helpers:", hs.map((h: any) => `${h.agent} ${h.state}`).join(", "));
if (hs.length !== 2 || hs.some((h: any) => h.state !== "done")) throw new Error("helpers did not both finish");
const reports = withHelpers.messages.flatMap((m: any) => m.content).filter((b: any) => b.type === "tool_result" && String(b.content).includes("Report:"));
console.log("  reports back:", reports.length);
if (reports.length !== 2) throw new Error("expected two reports");

// 7) a doc and the board through the API
const doc = await api(`/api/workspaces/${ws.id}/docs`, { method: "POST", body: JSON.stringify({ title: "Notes", body: "one" }) });
const commented = await api(`/api/docs/${doc.id}/comments`, { method: "POST", body: JSON.stringify({ body: "why?", quote: "one" }) });
const board = await api(`/api/workspaces/${ws.id}/board`, { method: "POST", body: JSON.stringify({ ops: [{ op: "add", kind: "note", text: "hi" }] }) });
console.log("7 doc comments:", commented.comments.length, " board items:", board.items.length);

sock.close();
console.log("SMOKE OK");
process.exit(0);
export {};
