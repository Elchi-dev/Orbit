import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { db, now } from "./db";
import { createMission, launch, listMissions, nextRun, updateMission, validSchedule } from "./missions";

describe("schedules", () => {
  const wed = new Date(2026, 9, 21, 10, 30); // a Wednesday, 10:30 local time
  test("daily, weekdays, weekly and hourly", () => {
    expect(new Date(nextRun({ kind: "daily", time: "09:00" }, wed)!)).toEqual(new Date(2026, 9, 22, 9, 0));
    expect(new Date(nextRun({ kind: "daily", time: "11:15" }, wed)!)).toEqual(new Date(2026, 9, 21, 11, 15));
    const fri = new Date(2026, 9, 23, 18, 0);
    expect(new Date(nextRun({ kind: "weekdays", time: "09:00" }, fri)!)).toEqual(new Date(2026, 9, 26, 9, 0)); // skips the weekend
    expect(new Date(nextRun({ kind: "weekly", day: 1, time: "08:00" }, wed)!)).toEqual(new Date(2026, 9, 26, 8, 0));
    expect(new Date(nextRun({ kind: "hourly", every: 2 }, wed)!)).toEqual(new Date(2026, 9, 21, 12, 0));
    expect(nextRun({ kind: "hook" }, wed)).toBeNull();
  });
  test("bad input becomes something safe", () => {
    expect(validSchedule({ kind: "daily", time: "25:99:00" })).toEqual({ kind: "daily", time: "09:00" });
    expect(validSchedule({ kind: "hourly", every: 999 })).toEqual({ kind: "hourly", every: 24 });
    expect(validSchedule({ kind: "rm -rf" })).toEqual({ kind: "hook" });
  });
});

describe("a mission run", () => {
  test("runs unattended: read-only work goes through, everything else is refused without asking", async () => {
    process.env.ORBIT_MOCK = "1";
    const cwd = mkdtempSync(join(tmpdir(), "orbit-mission-"));
    const ws = `w_${Math.random().toString(36).slice(2, 10)}`;
    db.run("INSERT INTO workspaces (id, title, cwd, mode, created_at, updated_at) VALUES (?,?,?,?,?,?)", [ws, "t", cwd, "manual", now(), now()]);

    const look = createMission(ws, { title: "Look", prompt: "list the files", schedule: { kind: "hook" } });
    expect(look.hook).toMatch(/^[a-f0-9]{20}$/);
    expect(await launch(look.id, "manual")).toBe("done");
    const calls = db.query<{ status: string; decided_by: string }, [string]>("SELECT status, decided_by FROM tool_calls WHERE workspace_id = ?").all(ws);
    expect(calls[0]).toMatchObject({ status: "done", decided_by: "readonly" });

    const clean = createMission(ws, { title: "Clean", prompt: "delete the tmp folder", schedule: { kind: "daily", time: "03:00" } });
    expect(clean.next_run).toBeGreaterThan(now());
    // a manual workspace would ask; a mission must not wait, so the delete is refused
    expect(await launch(clean.id, "manual")).toBe("done");
    const del = db.query<{ status: string; decided_by: string }, [string]>("SELECT status, decided_by FROM tool_calls WHERE workspace_id = ? AND subject LIKE 'rm %'").get(ws);
    expect(del).toMatchObject({ status: "denied", decided_by: "mode" });
    expect(listMissions(ws).find((m) => m.id === clean.id)!.last_status).toBe("done");

    expect(updateMission(clean.id, { enabled: false }).next_run).toBeNull();
    delete process.env.ORBIT_MOCK;
  });
});
