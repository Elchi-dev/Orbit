import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { db, getWorkspace, now } from "./db";
import { loadConfig } from "./config";
import { findTool } from "./tools";
import { keep, keepHunk, reviewList, revert, revertAll, undoHunk } from "./review";

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

  test("one hunk at a time: keep one, undo another, and undoing the file keeps what you kept", async () => {
    const { cwd, ws, run } = await setup();
    const lines = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`);
    writeFileSync(join(cwd, "a.ts"), lines.join("\n") + "\n");
    await run("edit_file", { path: "a.ts", old_string: "line 2\n", new_string: "line TWO\n" });
    await run("edit_file", { path: "a.ts", old_string: "line 15\n", new_string: "line FIFTEEN\n" });
    await run("edit_file", { path: "a.ts", old_string: "line 28\n", new_string: "line TWENTY-EIGHT\n" });
    const path = join(cwd, "a.ts");
    let f = reviewList(ws.id)[0];
    expect(f.hunks.length).toBe(3);
    // keep the first: the file stays as it is, two hunks remain
    keepHunk(ws.id, path, 0, f.rev);
    f = reviewList(ws.id)[0];
    expect(f.hunks.length).toBe(2);
    expect(f.diff).not.toContain("TWO");
    // a stale view is refused
    expect(() => undoHunk(ws.id, path, 0, "stale")).toThrow(/changed/);
    // undo the middle one: only it goes back
    undoHunk(ws.id, path, 0, f.rev);
    const text = readFileSync(path, "utf8");
    expect(text).toContain("line TWO\n");
    expect(text).toContain("line 15\n");
    expect(text).toContain("line TWENTY-EIGHT\n");
    // undoing the whole file now keeps the kept hunk and drops the rest
    revert(ws.id, path);
    expect(readFileSync(path, "utf8")).toBe(lines.join("\n").replace("line 2\n", "line TWO\n") + "\n");
    expect(reviewList(ws.id)).toEqual([]);
  });

  test("keeping every hunk one by one empties the list", async () => {
    const { cwd, ws, run } = await setup();
    writeFileSync(join(cwd, "b.ts"), "a\nb\nc\n");
    await run("edit_file", { path: "b.ts", old_string: "b", new_string: "B" });
    const f = reviewList(ws.id)[0];
    keepHunk(ws.id, f.path, 0, f.rev);
    expect(reviewList(ws.id)).toEqual([]);
    expect(readFileSync(f.path, "utf8")).toBe("a\nB\nc\n");
  });
});
