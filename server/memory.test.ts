import { describe, expect, test } from "bun:test";
import { db, insertMessage, now } from "./db";
import { loadConfig, config } from "./config";
import { addMemory, getMemory, listMemories, memoryPrompt, noteUsed, suggestFrom, updateMemory } from "./memory";

loadConfig();

function workspace(incognito = 0) {
  const id = `w_${Math.random().toString(36).slice(2, 10)}`;
  db.run("INSERT INTO workspaces (id, title, cwd, mode, incognito, created_at, updated_at) VALUES (?,?,?,?,?,?,?)", [id, "t", "/tmp", "manual", incognito, now(), now()]);
  return id;
}
const talk = (ws: string, n: number) => {
  for (let i = 0; i < n; i++) {
    insertMessage(ws, "user", [{ type: "text", text: `I always use pnpm, message ${i}` }]);
    insertMessage(ws, "assistant", [{ type: "text", text: "Noted." }]);
  }
};

describe("memory", () => {
  test("a run suggests memories; nothing goes in front of Claude until kept", async () => {
    process.env.ORBIT_MOCK = "1";
    const ws = workspace();
    talk(ws, 2);
    await suggestFrom(ws);
    const suggested = listMemories("suggested");
    expect(suggested.map((m) => m.text)).toEqual(["Prefers short answers with the code first."]);
    expect(memoryPrompt()).toBe("");
    updateMemory(suggested[0].id, { status: "kept", text: "Prefers short answers, code first." });
    expect(memoryPrompt()).toContain(`<memory id="${suggested[0].id}">Prefers short answers, code first.</memory>`);
    // the same fact isn't suggested twice
    talk(ws, 3);
    await suggestFrom(ws);
    expect(listMemories("suggested")).toHaveLength(0);
    delete process.env.ORBIT_MOCK;
  });

  test("private workspaces and helpers never feed memory", async () => {
    process.env.ORBIT_MOCK = "1";
    const before = listMemories().length;
    const ws = workspace(1);
    talk(ws, 2);
    await suggestFrom(ws);
    expect(listMemories().length).toBe(before);
    delete process.env.ORBIT_MOCK;
  });

  test("an answer that names its memories counts them; unknown ids are ignored", () => {
    const m = addMemory("Deploys with Docker Compose");
    expect(noteUsed(`Use compose up.\n[memory: ${m.id}, m_nope]`)).toEqual([m.id]);
    expect(getMemory(m.id)!.used).toBe(1);
    expect(noteUsed("No marker here")).toEqual([]);
  });

  test("switched off, nothing is suggested or shown", async () => {
    config().memory.enabled = false;
    expect(memoryPrompt()).toBe("");
    config().memory.enabled = true;
  });
});
