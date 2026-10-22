import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { db, getWorkspace, now } from "./db";
import { canDelegate, helpersOf, isInScope, listAgents, resolveModel, mergeHelper, discardHelper, createHelper } from "./helpers";
import { decide } from "./gate";
import { allowedBy } from "./tools";
import { getProfile } from "./profiles";
import { git } from "./git";

function workspace(cwd = "/tmp", mode = "full") {
  const id = `w_${Math.random().toString(36).slice(2, 10)}`;
  db.run("INSERT INTO workspaces (id, title, cwd, mode, created_at, updated_at) VALUES (?,?,?,?,?,?)", [id, "t", cwd, mode, now(), now()]);
  return getWorkspace(id)!;
}

describe("agent definitions", () => {
  test("built-ins are there, and a project file overrides one and adds its own", () => {
    const dir = mkdtempSync(join(tmpdir(), "orbit-agents-"));
    mkdirSync(join(dir, ".claude", "agents"), { recursive: true });
    writeFileSync(join(dir, ".claude", "agents", "reviewer.md"), "---\nname: reviewer\ndescription: Our reviewer\ntools: Read, Grep, Bash\nmodel: haiku\n---\nCheck against our style guide.");
    writeFileSync(join(dir, ".claude", "agents", "docs-writer.md"), "---\ndescription: Writes docs\n---\nWrite docs.");
    const agents = listAgents(dir);
    const reviewer = agents.find((a) => a.name === "reviewer")!;
    expect(reviewer.source).toBe("project");
    expect(reviewer.tools).toEqual(["read_file", "grep", "bash"]); // Claude Code names map to Orbit's
    expect(reviewer.prompt).toBe("Check against our style guide.");
    expect(agents.find((a) => a.name === "docs-writer")?.description).toBe("Writes docs");
    expect(agents.filter((a) => a.name === "reviewer")).toHaveLength(1);
    for (const n of ["explorer", "builder", "tester"]) expect(agents.some((a) => a.name === n)).toBe(true);
  });

  test("model aliases", () => {
    const ws = workspace();
    expect(resolveModel("inherit", { ...ws, model: "claude-x" })).toBe("claude-x");
    expect(resolveModel("claude-custom-1", ws)).toBe("claude-custom-1");
    expect(resolveModel("fast", ws)).toBeTruthy();
  });
});

describe("limits", () => {
  test("a helper can't send helpers of its own (depth 1), can't rename things, and keeps to its tool list", async () => {
    const parent = workspace();
    const child = await createHelper(parent, { agent: "explorer", task: "look" });
    expect(canDelegate(parent)).toBe(true);
    expect(canDelegate(child)).toBe(false);
    const profile = getProfile("pair");
    expect(allowedBy(profile, "delegate", parent)).toBe(true);
    expect(allowedBy(profile, "delegate", child)).toBe(false);
    expect(allowedBy(profile, "ui_set_title", child)).toBe(false);
    expect(allowedBy(profile, "write_file", child)).toBe(false); // explorers don't write
    expect(allowedBy(profile, "grep", child)).toBe(true);
    expect(child.mode).toBe(parent.mode); // never more than its parent
    expect(helpersOf(parent.id).map((h) => h.id)).toEqual([child.id]);
  });

  test("writes outside the given folders are refused, even in full autonomy", async () => {
    const dir = mkdtempSync(join(tmpdir(), "orbit-scope-"));
    const parent = workspace(dir, "full");
    const child = await createHelper(parent, { agent: "builder", task: "build", paths: ["src"] });
    expect(isInScope(child, join(dir, "src", "a.ts"))).toBe(true);
    expect(isInScope(child, join(dir, "srcx", "a.ts"))).toBe(false);
    const call = (path: string) => ({ id: "t", name: "write_file", input: { path, content: "" }, subject: `write ${join(dir, path)}` });
    const out = await decide(child, call("package.json"), { goal: "", recent: [] } as any);
    expect(out).toMatchObject({ allow: false, decidedBy: "scope" });
    const inside = await decide(child, call("src/a.ts"), { goal: "", recent: [] } as any);
    expect(inside.allow).toBe(true);
  });
});

describe("worktrees", () => {
  test("an isolated helper works on its own branch; merge brings it back staged, discard removes it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "orbit-wt-"));
    await git(dir, ["init", "-q", "-b", "main"]);
    writeFileSync(join(dir, "a.txt"), "one\n");
    await git(dir, ["add", "."]);
    await git(dir, ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "init"]);
    const parent = workspace(dir);
    const child = await createHelper(parent, { agent: "builder", task: "edit", isolate: true, name: "Edit a" });
    expect(child.branch).toStartWith("orbit/edit-a-");
    expect(child.cwd).toContain(join(".orbit", "worktrees"));
    writeFileSync(join(child.cwd, "a.txt"), "two\n");
    await git(child.cwd, ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qam", "edit"]);
    // Orbit's folder stays out of the user's git status
    expect((await git(dir, ["status", "--porcelain"])).trim()).toBe("");
    await mergeHelper(child.id);
    expect((await git(dir, ["diff", "--cached", "--name-only"])).trim()).toBe("a.txt");
    await discardHelper(child.id);
    expect(existsSync(child.cwd)).toBe(false);
    expect((await git(dir, ["branch", "--list", child.branch])).trim()).toBe("");
    expect(getWorkspace(child.id)!.helper_state).toBe("merged");
  });
});

describe("running helpers", () => {
  test("two delegate calls in one reply run at the same time and each comes back as a report", async () => {
    process.env.ORBIT_MOCK = "1";
    const { runTurn } = await import("./agent");
    const { listMessages } = await import("./db");
    const parent = workspace(mkdtempSync(join(tmpdir(), "orbit-run-")));
    const t0 = performance.now();
    expect(await runTurn(parent.id, [{ type: "text", text: "use helpers for this" }])).toBe("done");
    const helpers = helpersOf(parent.id);
    expect(helpers.map((h) => h.agent).sort()).toEqual(["explorer", "tester"]);
    for (const h of helpers) {
      expect(h.helper_state).toBe("done");
      expect(h.report).toBeTruthy();
    }
    // they overlapped: each helper started before the other finished
    const [a, b] = helpers;
    const lastUserMsg = (id: string) => listMessages(id).at(-1)!.created_at;
    expect(a.created_at < lastUserMsg(b.id) && b.created_at < lastUserMsg(a.id)).toBe(true);
    const results = listMessages(parent.id)
      .filter((m) => m.role === "user")
      .flatMap((m) => JSON.parse(m.content))
      .filter((b: any) => b.type === "tool_result");
    expect(results).toHaveLength(2);
    for (const r of results) expect(JSON.stringify(r.content)).toContain("Report:");
    expect(performance.now() - t0).toBeLessThan(30_000);
    delete process.env.ORBIT_MOCK;
  }, 40_000);
});
