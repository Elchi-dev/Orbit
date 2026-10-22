import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkout, commit, createBranch, diff, discard, git, init, parseStatus, stage, state, unstage } from "./git";

describe("git status parsing", () => {
  test("reads branch, upstream, ahead and behind", () => {
    const s = parseStatus("## main...origin/main [ahead 2, behind 1]\0M  a.ts\0 M b.ts\0?? c.ts\0R  new.ts\0old.ts\0UU d.ts\0");
    expect(s.branch).toBe("main");
    expect(s.upstream).toBe("origin/main");
    expect([s.ahead, s.behind]).toEqual([2, 1]);
    expect(s.staged.map((c) => c.path)).toEqual(["a.ts", "new.ts"]);
    expect(s.staged[1].from).toBe("old.ts");
    expect(s.changes.map((c) => c.path)).toEqual(["b.ts", "c.ts"]);
    expect(s.conflicts.map((c) => c.path)).toEqual(["d.ts"]);
  });
  test("a fresh repository has a branch and nothing else", () => {
    const s = parseStatus("## No commits yet on main\0");
    expect(s.branch).toBe("main");
    expect(s.upstream).toBeUndefined();
  });
});

describe("the git panel on a real repository", () => {
  const dir = mkdtempSync(join(tmpdir(), "orbit-git-"));

  test("a plain folder is not a repository until it is initialised", async () => {
    expect((await state(dir)).repo).toBe(false);
    await init(dir);
    await git(dir, ["config", "user.email", "t@example.com"]);
    await git(dir, ["config", "user.name", "Test"]);
    expect((await state(dir)).repo).toBe(true);
  });

  test("stage, commit, change, diff, unstage, discard", async () => {
    writeFileSync(join(dir, "a.txt"), "one\n");
    let s = await state(dir);
    expect(s.changes?.[0]).toMatchObject({ path: "a.txt", x: "?" });
    expect(await diff(dir, "a.txt", false)).toContain("+one");

    await stage(dir, ["a.txt"]);
    await commit(dir, "Add a");
    s = await state(dir);
    expect(s.log?.[0].subject).toBe("Add a");
    expect(s.changes).toEqual([]);

    writeFileSync(join(dir, "a.txt"), "two\n");
    expect(await diff(dir, "a.txt", false)).toContain("+two");
    await stage(dir, "a.txt");
    expect((await state(dir)).staged?.[0].path).toBe("a.txt");
    await unstage(dir, "a.txt");
    expect((await state(dir)).staged).toEqual([]);

    writeFileSync(join(dir, "junk.txt"), "x");
    await discard(dir, ["a.txt", "junk.txt"]);
    s = await state(dir);
    expect(s.changes).toEqual([]);
    expect(existsSync(join(dir, "junk.txt"))).toBe(false);
  });

  test("branches", async () => {
    await createBranch(dir, "feature/x");
    expect((await state(dir)).branch).toBe("feature/x");
    const main = (await state(dir)).branches!.find((b) => b !== "feature/x")!;
    await checkout(dir, main);
    expect((await state(dir)).branch).toBe(main);
  });

  test("refuses names that would read as options", async () => {
    await expect(stage(dir, ["--all"])).rejects.toThrow();
    await expect(createBranch(dir, "--orphan")).rejects.toThrow();
    await expect(commit(dir, "   ")).rejects.toThrow("Write a commit message first");
  });
});
