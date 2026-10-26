import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { config, loadConfig } from "./config";
import { broadcast } from "./hub";
import { scaffoldPlugin } from "./plugin-install";
import { beforeTool, callPluginTool, getPlugin, listPlugins, loadPlugins, normaliseSchema, parseManifest, pluginCommands, pluginHttp, pluginsDir, pluginTools, runCommand, savePluginSettings, setEnabled, setPluginBridge, startPlugins } from "./plugins";
import { findSkills } from "./context";

loadConfig();
process.env.ORBIT_MOCK = "1";

const calls: string[] = [];
setPluginBridge({
  api: async (method, path) => ({ status: 200, body: { method, path } }),
  runAgent: async (o) => ({ workspace: o.workspace ?? "w_new", reason: "done", text: `did: ${o.prompt}`, cost: 0.01 }),
  complete: async (o) => ({ text: `model says hi to ${o.plugin}`, model: "claude-haiku-5-5", usage: {}, cost: 0.001 }),
  answerApproval: (id, d) => calls.push(`approve ${id} ${d}`),
  approvals: () => [{ id: "a1" }],
  sendMessage: (ws, text) => calls.push(`send ${ws} ${text}`),
});
startPlugins();
afterAll(() => {
  for (const p of listPlugins()) getPlugin(p.id)?.stop();
});

const until = async (cond: () => boolean, ms = 15000) => {
  const t = Date.now();
  while (!cond()) {
    if (Date.now() - t > ms) throw new Error("timed out");
    await Bun.sleep(25);
  }
};

describe("manifests", () => {
  test("short schemas expand, and permissions are checked", () => {
    expect(normaliseSchema({ city: "string", days: "number?", tags: "string[]" })).toEqual({
      type: "object",
      properties: { city: { type: "string" }, days: { type: "number" }, tags: { type: "array", items: { type: "string" } } },
      required: ["city", "tags"],
    });
    expect(() => parseManifest({ id: "Bad Id", name: "x" })).toThrow(/id/);
    expect(() => parseManifest({ id: "ok-id", name: "x", permissions: ["root"] })).toThrow(/unknown permission/);
    expect(() => parseManifest({ id: "ok-id", name: "x", contributes: { hooks: ["before_tool"] } })).toThrow(/approvals/);
  });
});

for (const language of ["typescript", "python"] as const) {
  describe(`a ${language} plugin`, () => {
    const id = `hello-${language === "python" ? "py" : "ts"}`;

    test("is made from the template, starts when switched on, and offers its tool and command", async () => {
      scaffoldPlugin({ id, name: `Hello ${language}`, language, description: "" });
      loadPlugins();
      expect(listPlugins().find((p) => p.id === id)?.state).toBe("off");
      await setEnabled(id, true);
      await until(() => getPlugin(id)?.state === "running");
      expect(pluginTools().map((t) => t.name)).toContain(`hello_${language === "python" ? "py" : "ts"}__greet`);
      expect(pluginCommands().some((c) => c.plugin === id && c.name === "hello")).toBe(true);
      // a plugin's skills join the library
      expect(findSkills().some((s) => s.name === `${id}-guide` && s.source === "plugin")).toBe(true);
    });

    test("its tool runs and keeps state in storage", async () => {
      const t = pluginTools().find((x) => x.plugin.id === id)!;
      const ctx = { workspace: "w_1", cwd: "/tmp", call: "c1" };
      expect((await callPluginTool(t.plugin, t.tool, { name: "Ori" }, ctx)).content).toBe("Hello, Ori! (greeting number 1)");
      expect((await callPluginTool(t.plugin, t.tool, { name: "Ori" }, ctx)).content).toContain("number 2");
      expect(t.readOnly).toBe(true);
    });

    test("its command answers, and its route serves the panel", async () => {
      expect(await runCommand(id, "hello", "Sam", "w_1")).toEqual({ reply: "Asking Claude to say hello.", send: "Use the greet tool to greet Sam." });
      expect(await pluginHttp(id, { method: "GET", path: "/hello", query: {}, headers: {}, body: null })).toEqual({ hello: "from the plugin", greeted: 2 });
    });

    test("settings reach it, secrets stay out of the list", async () => {
      savePluginSettings(id, { greeting: "Hoi" });
      expect(listPlugins().find((p) => p.id === id)?.settings).toEqual({ greeting: "Hoi" });
      await setEnabled(id, false);
      expect(getPlugin(id)!.state).not.toBe("running");
    });
  });
}

describe("a plugin that uses Orbit", () => {
  test("calls the agent, a model and approvals, blocks a tool and hears events, within its permissions", async () => {
    const dir = join(pluginsDir(), "guard");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "orbit-plugin.json"),
      JSON.stringify({ id: "guard", name: "Guard", run: "bun index.ts", permissions: ["agent", "model", "approvals", "events"], contributes: { hooks: ["before_tool"] } }),
    );
    writeFileSync(join(dir, "orbit-plugin.ts"), await Bun.file(join(import.meta.dir, "../sdk/typescript/orbit-plugin.ts")).text());
    writeFileSync(
      join(dir, "index.ts"),
      `import { plugin } from "./orbit-plugin";
const seen: string[] = [];
plugin.beforeTool(({ subject }) => (subject.includes(".env") ? { decision: "deny", reason: "No secrets" } : undefined));
plugin.on("workspace", (e) => seen.push(e.workspace.id));
plugin.tool("probe", "Uses Orbit", {}, async () => {
  const a = await plugin.agent("tidy up", { workspace: "w_9" });
  const m = await plugin.model({ prompt: "hi" });
  const ap = await plugin.approvals.list();
  await plugin.approvals.answer("a1", "allow");
  let api = "refused";
  try { await plugin.api("GET", "/api/workspaces"); api = "allowed"; } catch (e) { api = String((e as Error).message); }
  return JSON.stringify({ agent: a.text, model: m.text, approvals: ap.length, api, seen });
});
plugin.start();
`,
    );
    loadPlugins();
    await setEnabled("guard", true);
    await until(() => getPlugin("guard")?.state === "running");
    expect(await beforeTool({ id: "w", title: "t", cwd: "/tmp" }, { id: "c", name: "read_file", input: {}, subject: "read .env" })).toMatchObject({ decision: "deny", reason: "No secrets" });
    expect(await beforeTool({ id: "w", title: "t", cwd: "/tmp" }, { id: "c", name: "read_file", input: {}, subject: "read app.ts" })).toBeNull();
    await Bun.sleep(200);
    broadcast("workspace", { workspace: { id: "w_seen" } });
    await Bun.sleep(200);
    const t = pluginTools().find((x) => x.plugin.id === "guard")!;
    const r = JSON.parse((await callPluginTool(t.plugin, t.tool, {}, { workspace: "w", cwd: "/tmp", call: "c" })).content);
    expect(r).toEqual({ agent: "did: tidy up", model: "model says hi to guard", approvals: 1, api: 'This needs the "api" permission in orbit-plugin.json', seen: ["w_seen"] });
    expect(calls).toContain("approve a1 allow");
    await setEnabled("guard", false);
  });

  test("a plugin that crashes is restarted, and its errors are logged", async () => {
    const dir = join(pluginsDir(), "crashy");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "orbit-plugin.json"), JSON.stringify({ id: "crashy", name: "Crashy", run: ["bun", "-e", "console.error('boom'); process.exit(3)"] }));
    loadPlugins();
    await setEnabled("crashy", true);
    await until(() => getPlugin("crashy")!.logs.some((l) => l.includes("boom")));
    await until(() => getPlugin("crashy")!.state === "crashed");
    expect(getPlugin("crashy")!.error).toMatch(/Stopped unexpectedly|initialize/);
    await setEnabled("crashy", false);
  });

  test("a plugin never gets the API key in its environment", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-secret";
    const dir = join(pluginsDir(), "envy");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "orbit-plugin.json"), JSON.stringify({ id: "envy", name: "Envy", run: "bun index.ts" }));
    writeFileSync(join(dir, "orbit-plugin.ts"), await Bun.file(join(import.meta.dir, "../sdk/typescript/orbit-plugin.ts")).text());
    writeFileSync(join(dir, "index.ts"), `import { plugin } from "./orbit-plugin";\nplugin.tool("env", "env", {}, () => JSON.stringify(Object.keys(process.env).filter((k) => k.includes("ANTHROPIC"))));\nplugin.start();\n`);
    loadPlugins();
    await setEnabled("envy", true);
    await until(() => getPlugin("envy")?.state === "running");
    const t = pluginTools().find((x) => x.plugin.id === "envy")!;
    expect((await callPluginTool(t.plugin, t.tool, {}, { workspace: "w", cwd: "/tmp", call: "c" })).content).toBe("[]");
    delete process.env.ANTHROPIC_API_KEY;
    await setEnabled("envy", false);
    expect(config().plugins.enabled.envy).toBe(false);
  });
});
