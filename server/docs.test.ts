import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { db, now } from "./db";
import { addComment, createDoc, docsBrief, editPassage, findDoc, getDoc, readForAgent, resolveComment, saveDoc } from "./docs";
import { apply, getBoard, readForAgent as readBoard } from "./board";

function workspace(cwd = "/tmp") {
  const id = `w_${Math.random().toString(36).slice(2, 10)}`;
  db.run("INSERT INTO workspaces (id, title, cwd, mode, created_at, updated_at) VALUES (?,?,?,?,?,?)", [id, "t", cwd, "manual", now(), now()]);
  return id;
}

describe("docs", () => {
  test("Claude sees what the user changed since its last read, and the open comments", () => {
    const ws = workspace();
    const d = createDoc(ws, "Plan", "# Plan\n\n1. Ship the API\n2. Write docs\n", "agent");
    saveDoc(getDoc(d.id)!, { body: "# Plan\n\n1. Ship the API by Friday\n2. Write docs\n" }, "user");
    addComment(getDoc(d.id)!, { author: "user", body: "Docs first, please", quote: "2. Write docs" });
    expect(docsBrief(ws)).toContain("edited by the user since you last read it");
    expect(docsBrief(ws)).toContain("1 new comment");
    const text = readForAgent(getDoc(d.id)!);
    expect(text).toContain("+1. Ship the API by Friday");
    expect(text).toContain('User on "2. Write docs": Docs first, please');
    // once read, nothing is new any more
    expect(docsBrief(ws)).not.toContain("edited by the user");
    expect(readForAgent(getDoc(d.id)!)).not.toContain("The user edited");
  });

  test("replies thread under the first comment, and resolving closes the thread", () => {
    const ws = workspace();
    const d = createDoc(ws, "Spec", "text", "agent");
    const c = addComment(d, { author: "user", body: "why?" });
    const r = addComment(d, { author: "agent", body: "because", parent_id: c.id });
    const r2 = addComment(d, { author: "user", body: "ok", parent_id: r.id });
    expect(r.parent_id).toBe(c.id);
    expect(r2.parent_id).toBe(c.id);
    resolveComment(d, c.id, true, "agent");
    expect(readForAgent(getDoc(d.id)!)).not.toContain("Open comments");
  });

  test("an edit must match one passage exactly", () => {
    expect(editPassage("a b a", "b", "c")).toBe("a c a");
    expect(() => editPassage("a b a", "a", "c")).toThrow("more than once");
    expect(() => editPassage("a b", "x", "c")).toThrow("isn't in the doc");
  });

  test("a stale save from the editor is refused instead of overwriting", () => {
    const ws = workspace();
    const d = createDoc(ws, "Notes", "one", "user");
    saveDoc(getDoc(d.id)!, { body: "two" }, "agent");
    expect(() => saveDoc(getDoc(d.id)!, { body: "three" }, "user", d.version)).toThrow("changed since");
    expect(findDoc(ws, "notes")?.body).toBe("two");
  });
});

describe("whiteboard", () => {
  test("a batch can refer to what it adds; items without a place don't overlap; frames carry their contents", () => {
    const ws = workspace();
    const { board, added } = apply(
      ws,
      [
        { op: "add", kind: "frame", ref: "f", title: "Options" },
        { op: "add", kind: "note", ref: "a", frame: "f", text: "Option A" },
        { op: "add", kind: "note", ref: "b", frame: "f", text: "Option B" },
        { op: "connect", from: "a", to: "b", label: "or" },
      ],
      "agent",
    );
    const [f, a, b] = ["f", "a", "b"].map((r) => board.items.find((i) => i.id === added[r])!);
    expect(board.edges).toHaveLength(1);
    expect(a.x >= f.x && a.y >= f.y && a.x + a.w <= f.x + f.w).toBe(true);
    const apart = a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
    expect(apart).toBe(true);
    const moved = apply(ws, [{ op: "move", id: f.id, x: f.x + 100, y: f.y }], "user").board;
    expect(moved.items.find((i) => i.id === a.id)!.x).toBe(a.x + 100);
    // the user's move shows up for Claude
    expect(readBoard(ws)).toContain("The user changed the board");
    expect(readBoard(ws)).not.toContain("The user changed the board");
  });

  test("images come from screenshots or the workspace, never from outside it", () => {
    const dir = mkdtempSync(join(tmpdir(), "orbit-board-"));
    writeFileSync(join(dir, "logo.png"), "x");
    const ws = workspace(dir);
    const b = apply(ws, [{ op: "add", kind: "image", src: "logo.png" }, { op: "add", kind: "image", src: "1712345678-1280.png" }], "agent").board;
    expect(b.items.map((i) => i.src)).toEqual(["file:logo.png", "shot:1712345678-1280.png"]);
    expect(() => apply(ws, [{ op: "add", kind: "image", src: "../../etc/passwd" }], "agent")).toThrow("outside");
    expect(getBoard(ws).items).toHaveLength(2);
  });

  test("removing an item removes its arrows", () => {
    const ws = workspace();
    const { added } = apply(ws, [{ op: "add", kind: "note", ref: "a" }, { op: "add", kind: "note", ref: "b" }, { op: "connect", from: "a", to: "b" }], "agent");
    const b = apply(ws, [{ op: "remove", id: added.a }], "user").board;
    expect(b.edges).toHaveLength(0);
  });
});

describe("docs kept as files", () => {
  test("saving writes the file, an edit on disk comes back as the user's, and the path stays inside the folder", async () => {
    const { linkFile, openFileAsDoc, listDocs } = await import("./docs");
    const { readFileSync } = await import("node:fs");
    const cwd = mkdtempSync(join(tmpdir(), "orbit-docfile-"));
    const ws = workspace(cwd);
    const d = createDoc(ws, "Plan", "# Plan\n\none\n", "agent");
    linkFile(d, "docs/plan.md");
    expect(readFileSync(join(cwd, "docs/plan.md"), "utf8")).toBe("# Plan\n\none\n");
    saveDoc(getDoc(d.id)!, { body: "# Plan\n\none\ntwo\n" }, "agent");
    expect(readFileSync(join(cwd, "docs/plan.md"), "utf8")).toBe("# Plan\n\none\ntwo\n");
    // edited in an editor or by git: Orbit picks it up as the user's edit, Claude sees the diff
    writeFileSync(join(cwd, "docs/plan.md"), "# Plan\n\none\ntwo\nthree\n");
    const fresh = getDoc(d.id)!;
    expect(fresh.body).toContain("three");
    expect(fresh.updated_by).toBe("user");
    expect(readForAgent(fresh)).toContain("+three");
    expect(listDocs(ws)[0].body).toContain("three");
    // never outside the workspace, never a non-text file
    expect(() => linkFile(fresh, "../escape.md")).toThrow(/inside the workspace/);
    expect(() => linkFile(fresh, "x.sh")).toThrow(/Markdown/);
    // an existing different file needs a choice
    writeFileSync(join(cwd, "notes.md"), "other\n");
    const e = createDoc(ws, "Notes", "mine\n", "user");
    expect(() => linkFile(e, "notes.md")).toThrow(/already exists/);
    expect(linkFile(e, "notes.md", "file").body).toBe("other\n");
    // and a Markdown file opens as a doc
    writeFileSync(join(cwd, "README.md"), "# Hello\n\nworld\n");
    const r = openFileAsDoc(ws, "README.md");
    expect(r.title).toBe("Hello");
    expect(openFileAsDoc(ws, "README.md").id).toBe(r.id);
    // stop keeping it as a file: the file stays, the doc stops writing to it
    const off = linkFile(getDoc(d.id)!, null);
    expect(off.file).toBeNull();
  });
});
