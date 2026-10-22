import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { config, loadConfig } from "./config";
import { db, now } from "./db";
import { getProfile, listProfiles } from "./profiles";
import { toolDefs } from "./tools";
import { runTurn } from "./agent";

loadConfig();

describe("profiles", () => {
  test("five come built in, and Pair follows the default mode", () => {
    expect(listProfiles().map((p) => p.id)).toEqual(["pair", "terminal", "autopilot", "frontend", "research"]);
    config().permissions.default_mode = "auto";
    expect(getProfile("pair").mode).toBe("auto");
    config().permissions.default_mode = "manual";
  });

  test("orbit.toml changes a built-in and adds new ones", () => {
    config().profiles = { terminal: { effort: "low" }, reviewer: { name: "Reviewer", tools: ["read_file", "grep"], mode: "rules" } };
    expect(getProfile("terminal")).toMatchObject({ effort: "low", layout: "terminal", builtin: true });
    expect(getProfile("reviewer")).toMatchObject({ name: "Reviewer", mode: "rules", builtin: false, layout: "log" });
    expect(getProfile("nope").id).toBe("pair");
    config().profiles = {};
  });

  test("Research gets no shell and no file writes", () => {
    const names = toolDefs(getProfile("research")).map((t) => t.name);
    expect(names).toContain("read_file");
    expect(names).not.toContain("bash");
    expect(names).not.toContain("write_file");
    expect(toolDefs(getProfile("pair")).map((t) => t.name)).toContain("bash");
  });

  test("Autopilot works on its own: a delete inside the folder runs without anyone asked", async () => {
    process.env.ORBIT_MOCK = "1";
    const cwd = mkdtempSync(join(tmpdir(), "orbit-auto-"));
    const id = `w_${Math.random().toString(36).slice(2, 10)}`;
    db.run("INSERT INTO workspaces (id, title, cwd, mode, profile, created_at, updated_at) VALUES (?,?,?,?,?,?,?)", [id, "t", cwd, "full", "autopilot", now(), now()]);
    expect(await runTurn(id, [{ type: "text", text: "delete the tmp folder" }])).toBe("done");
    const call = db.query<{ status: string; decided_by: string }, [string]>("SELECT status, decided_by FROM tool_calls WHERE workspace_id = ?").get(id);
    expect(call).toMatchObject({ status: "done", decided_by: "full" });
    delete process.env.ORBIT_MOCK;
  });
});
