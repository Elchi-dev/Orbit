import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { db, getWorkspace, insertMessage, now } from "./db";
import { loadConfig } from "./config";
import { findTool } from "./tools";
import { buildReplay } from "./replay";

loadConfig();

describe("replay", () => {
  test("messages, tool calls and file changes of a workspace and its helpers, in order, with diffs", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "orbit-replay-"));
    const id = `w_${Math.random().toString(36).slice(2, 10)}`;
    const helper = `w_${Math.random().toString(36).slice(2, 10)}`;
    db.run("INSERT INTO workspaces (id, title, cwd, mode, created_at, updated_at) VALUES (?,?,?,?,?,?)", [id, "Main", cwd, "manual", now(), now()]);
    db.run("INSERT INTO workspaces (id, title, cwd, mode, parent_id, agent, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)", [helper, "Look around", cwd, "manual", id, "explorer", now(), now()]);
    insertMessage(id, "user", [{ type: "text", text: "change two to TWO" }]);
    writeFileSync(join(cwd, "a.txt"), "one\ntwo\n");
    const ws = getWorkspace(id)!;
    await findTool("edit_file")!.run({ path: "a.txt", old_string: "two", new_string: "TWO" }, { ws, toolCallId: "toolu_x", onOutput: () => {} });
    db.run("INSERT INTO tool_calls (id, workspace_id, name, input, subject, status, output, decided_by, duration_ms, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)", ["toolu_x", id, "edit_file", "{}", `write ${join(cwd, "a.txt")}`, "done", "Edited", "user", 12, now()]);
    insertMessage(helper, "assistant", [{ type: "text", text: "Found a.txt" }]);
    insertMessage(id, "assistant", [{ type: "thinking", thinking: "..." }, { type: "text", text: "Done." }]);
    const r = buildReplay(id)!;
    expect(r.lanes.map((l) => l.title)).toEqual(["Main", "Look around"]);
    expect(r.events.map((e) => e.kind)).toEqual(expect.arrayContaining(["message", "tool", "file"]));
    const file = r.events.find((e) => e.kind === "file")!;
    expect(file).toMatchObject({ status: "edited", added: 1, removed: 1 });
    expect((file as any).diff).toContain("+TWO");
    expect(r.events.some((e) => e.lane === helper && e.kind === "message")).toBe(true);
    for (let i = 1; i < r.events.length; i++) expect(r.events[i].t).toBeGreaterThanOrEqual(r.events[i - 1].t);
    expect(buildReplay("w_nope")).toBeNull();
  });
});
