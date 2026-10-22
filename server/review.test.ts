import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { db, getWorkspace, now } from "./db";
import { loadConfig } from "./config";
import { findTool } from "./tools";
import { keep, reviewList, revert, revertAll } from "./review";

loadConfig();

async function setup() {
  const cwd = mkdtempSync(join(tmpdir(), "orbit-review-"));
  const id = `w_${Math.random().toString(36).slice(2, 10)}`;
  db.run("INSERT INTO workspaces (id, title, cwd, mode, created_at, updated_at) VALUES (?,?,?,?,?,?)", [id, "t", cwd, "manual", now(), now()]);
  const ws = getWorkspace(id)!;
  const run = (name: string, input: any) => findTool(name)!.run(input, { ws, toolCallId: `toolu_${Math.random()}`, onOutput: () => {} });
  return { cwd, ws, run };
}

describe("reviewing Claude's changes", () => {
  test("each file shows once, against how it was before the first change", async () => {
    const { cwd, ws, run } = await setup();
    writeFileSync(join(cwd, "a.ts"), "one\ntwo\nthree\n");
    await run("edit_file", { path: "a.ts", old_string: "two", new_string: "TWO" });
    await run("edit_file", { path: "a.ts", old_string: "three", new_string: "THREE" });
    await run("write_file", { path: "b.ts", content: "new file\n" });
    const list = reviewList(ws.id);
    expect(list.map((f) => [f.path.endsWith("a.ts") ? "a" : "b", f.status, f.edits])).toEqual([
      ["a", "edited", 2],
      ["b", "created", 1],
    ]);
    expect(list[0]).toMatchObject({ added: 2, removed: 2 });
    expect(list[0].diff).toContain("-two");
    expect(list[0].diff).toContain("+TWO");
  });

  test("undo puts a file back and removes a new one; keep hides it", async () => {
    const { cwd, ws, run } = await setup();
    writeFileSync(join(cwd, "a.ts"), "x\n");
    await run("edit_file", { path: "a.ts", old_string: "x", new_string: "y" });
    await run("write_file", { path: "b.ts", content: "b\n" });
    await run("write_file", { path: "c.ts", content: "c\n" });
    revert(ws.id, join(cwd, "a.ts"));
    expect(readFileSync(join(cwd, "a.ts"), "utf8")).toBe("x\n");
    keep(ws.id, join(cwd, "b.ts"));
    expect(reviewList(ws.id).map((f) => f.path)).toEqual([join(cwd, "c.ts")]);
    revertAll(ws.id);
    expect(existsSync(join(cwd, "c.ts"))).toBe(false);
    expect(existsSync(join(cwd, "b.ts"))).toBe(true);
    expect(reviewList(ws.id)).toEqual([]);
  });
});
