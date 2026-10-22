import { describe, expect, test } from "bun:test";
import { db, insertMessage, now } from "./db";
import { buildMessages } from "./agent";
import { DEFAULT_CONFIG, toToml } from "./config";

function workspace() {
  const id = `w_${Math.random().toString(36).slice(2, 10)}`;
  db.run("INSERT INTO workspaces (id, title, cwd, mode, created_at, updated_at) VALUES (?,?,?,?,?,?)", [id, "t", "/tmp", "manual", now(), now()]);
  return id;
}

describe("buildMessages", () => {
  // A run stopped between a tool call and its result left the history unsendable:
  // the API refuses a tool_use without a matching tool_result.
  test("a tool call that never ran gets a result saying so", () => {
    const ws = workspace();
    insertMessage(ws, "user", [{ type: "text", text: "clean up" }]);
    insertMessage(ws, "assistant", [{ type: "tool_use", id: "toolu_1", name: "bash", input: { command: "rm -rf x" } }]);
    insertMessage(ws, "user", [{ type: "text", text: "never mind" }]);
    const msgs = buildMessages(ws);
    expect(msgs.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    const results = msgs[2].content.filter((b) => b.type === "tool_result");
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ tool_use_id: "toolu_1", is_error: true });
    // tool results come before the text in the same message
    expect(msgs[2].content[0].type).toBe("tool_result");
  });

  test("two user messages in a row are sent as one", () => {
    const ws = workspace();
    insertMessage(ws, "user", [{ type: "text", text: "a" }]);
    insertMessage(ws, "user", [{ type: "text", text: "b" }]);
    const msgs = buildMessages(ws);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].content.map((b) => b.text)).toEqual(["a", "b"]);
  });

  test("thinking blocks go back unchanged", () => {
    const ws = workspace();
    const thinking = { type: "thinking", thinking: "", signature: "sig123" };
    insertMessage(ws, "user", [{ type: "text", text: "go" }]);
    insertMessage(ws, "assistant", [thinking, { type: "text", text: "done" }]);
    insertMessage(ws, "user", [{ type: "text", text: "thanks" }]);
    expect(buildMessages(ws)[1].content[0]).toEqual(thinking);
  });

  test("exactly one cache breakpoint, on the newest block", () => {
    const ws = workspace();
    insertMessage(ws, "user", [{ type: "text", text: "one" }]);
    insertMessage(ws, "assistant", [{ type: "text", text: "two" }]);
    insertMessage(ws, "user", [{ type: "text", text: "three" }]);
    const marked = buildMessages(ws).flatMap((m) => m.content).filter((b) => b.cache_control);
    expect(marked).toHaveLength(1);
    expect(marked[0].text).toBe("three");
  });
});

describe("config", () => {
  // The settings page writes orbit.toml; anything it writes must read back the same.
  test("orbit.toml written by Orbit reads back identically", () => {
    const c = structuredClone(DEFAULT_CONFIG);
    c.permissions.judge_notes = 'rm -rf is fine here.\nNever touch ~/.ssh or "secrets".';
    c.permissions.rules = [
      { pattern: "rm -rf ./build/*", verdict: "allow" },
      { pattern: "git push --force*", verdict: "deny", kind: "glob" },
    ];
    expect(Bun.TOML.parse(toToml(c as any))).toEqual(c as any);
  });
});

describe("web search history", () => {
  test("goes back unchanged when search is on, and as plain text when it is off", async () => {
    const { flattenWeb } = await import("./agent");
    const content = [
      { type: "server_tool_use", id: "srv_1", name: "web_search", input: { query: "bun release" } },
      { type: "web_search_tool_result", tool_use_id: "srv_1", content: [{ type: "web_search_result", url: "https://bun.com/blog", title: "Bun blog", encrypted_content: "x" }] },
      { type: "text", text: "Bun shipped.", citations: [{ type: "web_search_result_location", url: "https://bun.com/blog", title: "Bun blog", encrypted_index: "y", cited_text: "..." }] },
    ];
    const flat = flattenWeb(content);
    expect(flat.map((b: any) => b.type)).toEqual(["text", "text", "text"]);
    expect(flat[0].text).toContain("bun release");
    expect(flat[1].text).toContain("https://bun.com/blog");
    expect(flat[2]).toEqual({ type: "text", text: "Bun shipped." });
    const plain = [{ type: "text", text: "hi" }];
    expect(flattenWeb(plain)).toBe(plain);
  });
});
