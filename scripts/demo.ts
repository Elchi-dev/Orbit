// Starts Orbit with the mock model and a handful of example workspaces, so the interface can be tried
// (and the screenshots in docs/images retaken) without an API key. Your real ~/.orbit is never touched.
//   bun scripts/demo.ts            then open http://localhost:7777
import { mkdirSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const home = process.env.ORBIT_HOME ?? join(tmpdir(), "orbit-demo");
rmSync(home, { recursive: true, force: true });
mkdirSync(home, { recursive: true });
process.env.ORBIT_HOME = home;
process.env.ORBIT_MOCK = "1";

const { db } = await import("../server/db");
const { loadConfig, config, saveConfig } = await import("../server/config");
const { costOf } = await import("../server/usage");
loadConfig();

const c = config();
c.permissions.judge_notes = "rm -rf inside the workspace folder is fine, don't block it.\nNever touch ~/.ssh or ~/.aws.";
c.permissions.rules = [
  { pattern: "git push --force*", verdict: "deny" },
  { pattern: "curl *", verdict: "ask" },
];
c.workspaces.home = join(home, "workspaces");
saveConfig(c);

const MIN = 60_000;
const t0 = Date.now();
let seq = 0;
const id = (p: string) => `${p}${(++seq).toString(36).padStart(6, "0")}demo`;

interface Step {
  user?: string;
  assistant?: any[];
  results?: { id: string; content: string; error?: boolean }[];
}

function workspace(o: { title: string; dir: string; style: object; mode?: string; minutesAgo: number; steps?: Step[]; tokens?: number; calls?: any[] }) {
  const wid = id("w_");
  const cwd = join(homedir(), "code", o.dir);
  mkdirSync(cwd, { recursive: true });
  const at = t0 - o.minutesAgo * MIN;
  db.run(
    "INSERT INTO workspaces (id, title, cwd, mode, style, titled, created_at, updated_at) VALUES (?,?,?,?,?,1,?,?)",
    [wid, o.title, cwd, o.mode ?? "manual", JSON.stringify(o.style), at - 40 * MIN, at],
  );
  let ts = at - 30 * MIN;
  for (const s of o.steps ?? []) {
    const add = (role: string, content: any[]) => {
      ts += 20_000;
      const mid = id("m_");
      db.run("INSERT INTO messages (id, workspace_id, role, content, created_at) VALUES (?,?,?,?,?)", [mid, wid, role, JSON.stringify(content), ts]);
      const text = content.filter((b) => b.type === "text").map((b) => b.text).join("\n");
      if (text) db.run("INSERT INTO search (text, message_id, workspace_id) VALUES (?,?,?)", [text, mid, wid]);
      return mid;
    };
    if (s.user) add("user", [{ type: "text", text: s.user }]);
    if (s.assistant) {
      const mid = add("assistant", s.assistant);
      const u = { input: 2400, output: 380, cache_read: 18000, cache_write: 1200 };
      db.run(
        "INSERT INTO usage (workspace_id, message_id, kind, model, input, output, cache_read, cache_write, ttft_ms, tps, cost, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
        [wid, mid, "pilot", "claude-opus-5-5", u.input, u.output, u.cache_read, u.cache_write, 640, 84, costOf("claude-opus-5-5", u), ts],
      );
      for (const b of s.assistant.filter((b) => b.type === "tool_use")) {
        const meta = (o.calls ?? []).find((x) => x.id === b.id) ?? {};
        const r = s.results?.find((x) => x.id === b.id);
        db.run(
          "INSERT INTO tool_calls (id, workspace_id, message_id, name, input, subject, status, output, is_error, decided_by, reason, judge_ms, duration_ms, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
          [b.id, wid, mid, b.name, JSON.stringify(b.input), meta.subject ?? "", r?.error ? "error" : "done", r?.content ?? null, r?.error ? 1 : 0, meta.by ?? "readonly", meta.reason ?? null, meta.judgeMs ?? null, meta.ms ?? 40, ts],
        );
      }
    }
    if (s.results) add("user", s.results.map((r) => ({ type: "tool_result", tool_use_id: r.id, content: r.content, ...(r.error ? { is_error: true } : {}) })));
  }
  if (o.tokens) {
    db.run(
      "INSERT INTO usage (workspace_id, kind, model, input, output, cache_read, cache_write, cost, created_at) VALUES (?,?,?,?,?,?,?,?,?)",
      [wid, "pilot", "claude-opus-5-5", o.tokens * 0.2, o.tokens * 0.05, o.tokens * 0.7, o.tokens * 0.05, costOf("claude-opus-5-5", { input: o.tokens * 0.2, output: o.tokens * 0.05, cache_read: o.tokens * 0.7, cache_write: o.tokens * 0.05 }), at],
    );
  }
  return { wid, cwd };
}

// 1. a finished coding run with every kind of decision
const zod = { grep: "toolu_demo_grep", e1: "toolu_demo_e1", e2: "toolu_demo_e2", test: "toolu_demo_test" };
const api = join(homedir(), "code", "acme-api");
workspace({
  title: "Fix tests after zod 4",
  dir: "acme-api",
  style: { color: "#7A64E0", surface: "gas", rings: false },
  mode: "auto",
  minutesAgo: 2,
  steps: [
    { user: "The tests in packages/api fail since the zod 4 upgrade. Fix them and keep the public types the same." },
    {
      assistant: [
        { type: "thinking", thinking: "Three failing suites, all in schema files. The error names `.nonstrict()`, which zod 4 renamed. Find every use before editing.", signature: "demo" },
        { type: "text", text: "Three failures with one cause: zod 4 renamed `.nonstrict()` to `.loose()`. Finding every use first." },
        { type: "tool_use", id: zod.grep, name: "grep", input: { pattern: "nonstrict", path: "packages/api" } },
      ],
      results: [{ id: zod.grep, content: "src/schemas/user.ts:14:  .nonstrict()\nsrc/schemas/order.ts:9:  .nonstrict()" }],
    },
    {
      assistant: [
        { type: "text", text: "Two schemas use it. Changing both." },
        { type: "tool_use", id: zod.e1, name: "edit_file", input: { path: "packages/api/src/schemas/user.ts", old_string: "  email: z.string().email(),\n}).nonstrict()", new_string: "  email: z.string().email(),\n}).loose()" } },
        { type: "tool_use", id: zod.e2, name: "edit_file", input: { path: "packages/api/src/schemas/order.ts", old_string: "}).nonstrict()", new_string: "}).loose()" } },
      ],
      results: [
        { id: zod.e1, content: `Edited ${api}/packages/api/src/schemas/user.ts (1 replacement)` },
        { id: zod.e2, content: `Edited ${api}/packages/api/src/schemas/order.ts (1 replacement)` },
      ],
    },
    {
      assistant: [{ type: "tool_use", id: zod.test, name: "bash", input: { command: "bun test packages/api" } }],
      results: [{ id: zod.test, content: "bun test v1.4.2\n\nschemas/user.test.ts:      41 pass\nschemas/order.test.ts:     63 pass\nroutes/invoice.test.ts:   108 pass\n\n 212 pass\n 0 fail\nRan 212 tests across 3 files. [1.84s]" }],
    },
    {
      assistant: [
        {
          type: "text",
          text: "All 212 tests pass. I compared the emitted `.d.ts` files before and after: the public types are identical, so nothing that depends on this package needs to change.\n\n| File | Change |\n| --- | --- |\n| `schemas/user.ts` | `.nonstrict()` to `.loose()` |\n| `schemas/order.ts` | `.nonstrict()` to `.loose()` |\n\nBoth edits are in the undo journal if you want them back.",
        },
      ],
    },
  ],
  calls: [
    { id: zod.grep, subject: "read", by: "readonly", ms: 38 },
    { id: zod.e1, subject: `write ${api}/packages/api/src/schemas/user.ts`, by: "rule", reason: `Allowed by rule "write ${api}/**"`, ms: 4 },
    { id: zod.e2, subject: `write ${api}/packages/api/src/schemas/order.ts`, by: "rule", reason: `Allowed by rule "write ${api}/**"`, ms: 3 },
    { id: zod.test, subject: "bun test packages/api", by: "judge", reason: "Runs the test suite inside the workspace, which is what the user asked for.", judgeMs: 410, ms: 1840 },
  ],
});
db.run("INSERT INTO rules (scope, pattern, verdict, kind, created_at) VALUES ('global', ?, 'allow', 'glob', ?)", [`write ${api}/**`, t0]);
{
  const u = { input: 1900, output: 40, cache_read: 0, cache_write: 0 };
  db.run(
    "INSERT INTO usage (workspace_id, kind, model, input, output, cache_read, cache_write, cost, created_at) SELECT id, 'judge', 'claude-sonnet-5-5', ?, ?, 0, 0, ?, ? FROM workspaces WHERE title = 'Fix tests after zod 4'",
    [u.input, u.output, costOf("claude-sonnet-5-5", u), t0],
  );
}

// 2. waits for a decision in the screenshots (auto mode, the judge will ask)
workspace({ title: "Home server backups", dir: "homelab", style: { color: "#C9B1AA", surface: "rocky", rings: false }, mode: "auto", minutesAgo: 6, tokens: 22_000 });

// 3. a chart the agent drew
const chart = "toolu_demo_chart";
workspace({
  title: "Hosting cost comparison",
  dir: "hosting",
  style: { color: "#2BA3AB", surface: "ocean", rings: true },
  minutesAgo: 35,
  tokens: 410_000,
  steps: [
    { user: "Compare what our three servers would cost per month at Hetzner, UpCloud and Infomaniak, same specs." },
    {
      assistant: [
        { type: "text", text: "Same specs everywhere: 8 vCPU, 32 GB RAM, 240 GB NVMe, prices in CHF per month without VAT." },
        {
          type: "tool_use",
          id: chart,
          name: "ui_show",
          input: {
            kind: "chart",
            title: "Monthly cost for three servers, CHF",
            content: JSON.stringify({ type: "bar", labels: ["Hetzner", "UpCloud", "Infomaniak"], series: [{ name: "Compute", values: [114, 186, 201] }, { name: "Backups", values: [23, 31, 40] }] }),
          },
        },
      ],
      results: [{ id: chart, content: "Shown to the user" }],
    },
    { assistant: [{ type: "text", text: "Hetzner is cheapest by a wide margin, 137 CHF against 217 and 241. UpCloud and Infomaniak include managed backups in more regions, which is the only reason I'd pick them." }] },
  ],
  calls: [{ id: chart, by: "builtin", ms: 1 }],
});

// 4 to 6. the rest of the sky
workspace({ title: "Migrate CI to Bun", dir: "ci", style: { color: "#E58C78", surface: "lava", rings: false }, minutesAgo: 90, tokens: 160_000 });
workspace({ title: "Thesis notes", dir: "thesis", style: { color: "#3E5BC8", surface: "gas", rings: false }, minutesAgo: 240, tokens: 820_000 });
workspace({ title: "Landing page copy", dir: "landing", style: { color: "#8FB3C6", surface: "ice", rings: false }, minutesAgo: 12 * 24 * 60, tokens: 40_000 });

db.run("INSERT INTO pins (workspace_id, text, created_at) SELECT id, 'The API package is published to npm as @acme/api; never change exported types without a major version.', ? FROM workspaces WHERE title = 'Fix tests after zod 4'", [t0]);

console.log(`demo data in ${home}`);
await import("../server/index");
