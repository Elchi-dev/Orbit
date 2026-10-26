import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { config, loadConfig, ORBIT_DIR } from "./config";
import { findSkills, loadSkill } from "./context";
import { deleteEntry, findKnowledge, knowledgePrompt, normaliseKnowledge, normaliseSkill, readKnowledge, saveEntry, searchKnowledge, templates } from "./library";
import { LIBRARY } from "./library-data";

loadConfig();
const project = () => mkdtempSync(join(tmpdir(), "orbit-lib-"));

describe("the library", () => {
  test("built-in skills ship inside Orbit and load without a folder", () => {
    const names = findSkills(project()).filter((s) => s.source === "builtin").map((s) => s.name);
    expect(names).toContain("debugging");
    expect(names).toContain("security-review");
    const loaded = loadSkill(project(), "debugging");
    expect(loaded.isError).toBeFalsy();
    expect(loaded.content).toContain("# Debugging");
  });

  test("every built-in skill has a name, a description that says when, and no dashes", () => {
    for (const [path, text] of Object.entries(LIBRARY).filter(([p]) => p.startsWith("skills/"))) {
      expect(text, path).toMatch(/^---\nname: [a-z0-9-]+\ndescription: Use when .{20,}\n---/);
      expect(text, path).not.toMatch(new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`));
    }
  });

  test("a switched-off skill disappears, and a project's own skill wins over the built-in", () => {
    const cwd = project();
    config().skills.disabled = ["testing"];
    expect(findSkills(cwd).some((s) => s.name === "testing")).toBe(false);
    expect(findSkills(cwd, true).find((s) => s.name === "testing")?.enabled).toBe(false);
    config().skills.disabled = [];
    mkdirSync(join(cwd, ".orbit", "skills", "debugging"), { recursive: true });
    writeFileSync(join(cwd, ".orbit", "skills", "debugging", "SKILL.md"), "---\nname: debugging\ndescription: ours\n---\n\n# Our way");
    const s = findSkills(cwd).find((x) => x.name === "debugging")!;
    expect(s.source).toBe("project");
    expect(loadSkill(cwd, "debugging").content).toContain("# Our way");
  });

  test("templates carry their own title and become a clean file", () => {
    const t = templates("skill").find((x) => x.id === "workflow")!;
    expect(t.title).toBe("A workflow");
    expect(t.text.startsWith("---\nname:")).toBe(true);
    expect(templates("knowledge").map((x) => x.id)).toContain("about-me");
  });

  test("saving normalises the frontmatter, deleting only touches your own", () => {
    const text = normaliseSkill("tea-time", "# Tea\n\nBoil water.", "Use when making tea.");
    expect(text).toBe("---\nname: tea-time\ndescription: Use when making tea.\n---\n\n# Tea\n\nBoil water.\n");
    const path = saveEntry("skill", "tea-time", text);
    expect(path).toBe(join(ORBIT_DIR, "skills", "tea-time", "SKILL.md"));
    expect(findSkills(project()).find((s) => s.name === "tea-time")?.source).toBe("orbit");
    deleteEntry("skill", "tea-time");
    expect(existsSync(path)).toBe(false);
    expect(() => deleteEntry("skill", "debugging")).toThrow();
    expect(() => saveEntry("skill", "../escape", "x")).toThrow();
  });

  test("knowledge marked always is in the prompt; the rest is listed and searchable", () => {
    const cwd = project();
    saveEntry("knowledge", "about-me", normaliseKnowledge("# About me\n\nI like short answers.", { description: "Who I am", always: true }));
    mkdirSync(join(cwd, ".orbit", "knowledge"), { recursive: true });
    writeFileSync(join(cwd, ".orbit", "knowledge", "deploys.md"), "---\ntitle: Deploys\ndescription: How this project ships\n---\n\nWe deploy with the blue button on Fridays never.");
    const prompt = knowledgePrompt(cwd);
    expect(prompt).toContain("I like short answers.");
    expect(prompt).toContain("- deploys: How this project ships");
    expect(prompt).toContain("- orbit:");
    expect(findKnowledge(cwd).find((k) => k.name === "deploys")?.source).toBe("project");
    expect(readKnowledge(cwd, "orbit")).toContain("# How Orbit works");
    expect(searchKnowledge(cwd, "blue button deploy")[0].name).toBe("deploys");
    config().knowledge.disabled = ["about-me"];
    expect(knowledgePrompt(cwd)).not.toContain("short answers");
    config().knowledge.disabled = [];
    deleteEntry("knowledge", "about-me");
  });
});

describe("Ori writes one", () => {
  test("only public pages can be read, also by IP", async () => {
    const { publicUrl } = await import("./libgen");
    for (const u of ["http://localhost:7777/api", "http://127.0.0.1/", "http://10.0.0.5/", "http://192.168.1.1/", "http://169.254.169.254/latest", "http://[::1]/", "file:///etc/passwd", "http://user:pw@1.1.1.1/", "http://printer.local/"])
      await expect(publicUrl(u), u).rejects.toThrow();
    expect((await publicUrl("https://1.1.1.1/")).hostname).toBe("1.1.1.1");
  });

  test("a draft comes back with a valid name, frontmatter and its cost, and is not saved", async () => {
    process.env.ORBIT_MOCK = "1";
    const { generate } = await import("./libgen");
    const d = await generate("g_test", "skill", "Reviewing Terraform plans before apply");
    expect(d.name).toMatch(/^[a-z0-9-]+$/);
    expect(d.text).toMatch(/^---\nname: .+\ndescription: Use when .+\n---\n\n# /);
    expect(d.cost).toBeGreaterThan(0);
    expect(findSkills(project()).some((s) => s.name === d.name)).toBe(false);
    const k = await generate("g_test2", "knowledge", "Swiss VAT rates for invoices");
    expect(k.text).toMatch(/^---\ntitle: .+\ndescription: .+\nalways: false\n---/);
    delete process.env.ORBIT_MOCK;
  });
});

describe("knowledge folders", () => {
  test("a folder of docs is searched by passage, with the file and heading it came from", async () => {
    const { searchAll, workspaceFolders, readFromFolders } = await import("./library");
    const cwd = mkdtempSync(join(tmpdir(), "orbit-kfold-"));
    mkdirSync(join(cwd, "docs", "ops"), { recursive: true });
    writeFileSync(join(cwd, "docs", "ops", "deploy.md"), "# Deploying\n\n## Rollback\n\nTo roll back, run make rollback with the previous tag. Never delete the old image.\n\n## Secrets\n\nSecrets live in the vault.\n");
    writeFileSync(join(cwd, "docs", "intro.md"), "# Intro\n\nWelcome to the project. It sells tea online.\n");
    mkdirSync(join(cwd, "docs", "node_modules"), { recursive: true });
    writeFileSync(join(cwd, "docs", "node_modules", "junk.md"), "rollback rollback rollback");
    const folders = workspaceFolders(cwd, JSON.stringify(["docs", "../outside"]));
    expect(folders).toEqual([join(cwd, "docs")]);
    const hits = searchAll(cwd, folders, "how do I roll back a deploy");
    expect(hits[0].source).toBe("docs/ops/deploy.md # Rollback");
    expect(hits[0].text).toContain("make rollback");
    expect(hits.some((h) => h.source.includes("node_modules"))).toBe(false);
    expect(readFromFolders(folders, "intro.md")).toContain("sells tea");
    expect(readFromFolders(folders, "../package.json")).toBeNull();
    // a changed file is picked up on the next search
    await Bun.sleep(20);
    writeFileSync(join(cwd, "docs", "intro.md"), "# Intro\n\nIt sells coffee now.\n");
    expect(searchAll(cwd, folders, "coffee")[0].source).toBe("docs/intro.md # Intro");
  });
});
