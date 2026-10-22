import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ORBIT_DIR, loadConfig } from "./config";
import { findSkills, frontmatter, loadSkill, projectInstructions } from "./context";

loadConfig();

describe("project instruction files", () => {
  test("are read in a fixed order and capped", () => {
    const dir = mkdtempSync(join(tmpdir(), "orbit-proj-"));
    writeFileSync(join(dir, "AGENTS.md"), "Use pnpm.");
    writeFileSync(join(dir, "CLAUDE.md"), "x".repeat(25_000));
    mkdirSync(join(dir, ".cursor", "rules"), { recursive: true });
    writeFileSync(join(dir, ".cursor", "rules", "style.mdc"), "Tabs, not spaces.");
    const files = projectInstructions(dir);
    expect(files.map((f) => f.path)).toEqual(["AGENTS.md", "CLAUDE.md", ".cursor/rules/style.mdc"]);
    expect(files[1].cut).toBe(true);
    expect(files[1].text.length).toBe(20_000);
  });
});

describe("skills", () => {
  test("frontmatter with a folded description", () => {
    expect(frontmatter("---\nname: pdf\ndescription: >\n  Fill PDF forms\n  and merge files\n---\n# body")).toEqual({ name: "pdf", description: "Fill PDF forms and merge files" });
    expect(frontmatter("# no frontmatter")).toEqual({});
  });

  test("project skills come first and override personal ones, and load with their files", () => {
    const proj = mkdtempSync(join(tmpdir(), "orbit-skills-"));
    const mk = (base: string, name: string, desc: string) => {
      mkdirSync(join(base, name, "scripts"), { recursive: true });
      writeFileSync(join(base, name, "SKILL.md"), `---\nname: ${name}\ndescription: ${desc}\n---\n\nSteps for ${desc}.`);
      writeFileSync(join(base, name, "scripts", "run.py"), "print(1)");
    };
    mk(join(ORBIT_DIR, "skills"), "release", "personal release steps");
    mk(join(ORBIT_DIR, "skills"), "changelog", "write a changelog");
    mk(join(proj, ".claude", "skills"), "release", "this project's release steps");
    const skills = findSkills(proj);
    const release = skills.find((s) => s.name === "release")!;
    expect(release.description).toBe("this project's release steps");
    expect(release.source).toBe("project");
    expect(skills.some((s) => s.name === "changelog")).toBe(true);
    const loaded = loadSkill(proj, "release");
    expect(loaded.content).toContain("scripts/run.py");
    expect(loaded.content).toContain("Steps for this project's release steps.");
    expect(loadSkill(proj, "nope").isError).toBe(true);
  });
});

describe("saved prompts", () => {
  test("markdown files become commands, project first", async () => {
    const { findCommands } = await import("./context");
    const proj = mkdtempSync(join(tmpdir(), "orbit-cmd-"));
    mkdirSync(join(proj, ".claude", "commands"), { recursive: true });
    writeFileSync(join(proj, ".claude", "commands", "review.md"), "---\ndescription: Review the diff\n---\nReview $ARGUMENTS for bugs.");
    mkdirSync(join(ORBIT_DIR, "prompts"), { recursive: true });
    writeFileSync(join(ORBIT_DIR, "prompts", "review.md"), "Personal review.");
    writeFileSync(join(ORBIT_DIR, "prompts", "standup.md"), "# Write my standup\nFrom today's commits.");
    const cmds = findCommands(proj);
    const review = cmds.find((c) => c.name === "review")!;
    expect(review).toMatchObject({ description: "Review the diff", body: "Review $ARGUMENTS for bugs.", source: "project" });
    expect(cmds.find((c) => c.name === "standup")!.description).toBe("Write my standup");
  });
});
