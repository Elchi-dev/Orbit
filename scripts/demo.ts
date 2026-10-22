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

// 7. helpers: one lead sends three helpers at once
{
  const calls = { a: "toolu_demo_helper_a", b: "toolu_demo_helper_b", c: "toolu_demo_helper_c" };
  const { wid, cwd } = workspace({
    title: "Speed up CI",
    dir: "acme-web",
    style: { color: "#D9A85B", surface: "rock", rings: true },
    mode: "auto",
    minutesAgo: 1,
    steps: [
      { user: "CI takes 14 minutes. Find out where the time goes and cut it, without skipping any tests." },
      {
        assistant: [
          { type: "text", text: "Three separate jobs, so three helpers at once: one measures, one splits the end to end suite on its own branch, one reviews the cache setup." },
          { type: "tool_use", id: calls.a, name: "delegate", input: { agent: "explorer", name: "Where the 14 minutes go", task: "Read the last 20 CI runs in .github/workflows and the logs in ci-logs/. Report the slowest steps with their median time." } },
          { type: "tool_use", id: calls.b, name: "delegate", input: { agent: "builder", name: "Shard the e2e suite", isolate: true, paths: ["e2e", ".github/workflows"], task: "Split the Playwright suite in e2e/ into 4 shards in CI. Keep every test. Run it locally to check the shards add up to the full suite." } },
          { type: "tool_use", id: calls.c, name: "delegate", input: { agent: "reviewer", name: "Check the dependency cache", task: "Review how .github/workflows/ci.yml caches node_modules and the Playwright browsers. Report anything that makes the cache miss." } },
        ],
        results: [
          { id: calls.a, content: "Helper finished. Report: e2e 8m 40s, install 2m 10s, unit tests 1m 30s." },
          { id: calls.b, content: "Helper finished on branch orbit/shard-the-e2e-suite-4f2a." },
          { id: calls.c, content: "Helper finished. Report: the cache key includes the lockfile hash and the run id." },
        ],
      },
      {
        assistant: [
          {
            type: "text",
            text: "Most of the time was the end to end suite running on one machine, and a dependency cache that never hit.\n\n- **Shards:** the e2e suite now runs on 4 machines; all 186 tests still run, about 2m 30s each. It's on its own branch for you to merge.\n- **Cache:** the key included `github.run_id`, so every run started cold. Dropping it saves about 2 minutes.\n\nTogether that should bring CI from 14 minutes to about 5.",
          },
        ],
      },
    ],
    calls: [
      { id: calls.a, by: "builtin", ms: 41_000 },
      { id: calls.b, by: "builtin", ms: 188_000 },
      { id: calls.c, by: "builtin", ms: 36_000 },
    ],
  });
  const helper = (o: { call: string; agent: string; title: string; model: string; report: string; branch?: string; cost: number; task: string; work: string }) => {
    const hid = id("w_");
    db.run(
      "INSERT INTO workspaces (id, title, cwd, mode, style, titled, parent_id, agent, model, helper_state, report, branch, call_id, created_at, updated_at) VALUES (?,?,?,?,?,1,?,?,?,?,?,?,?,?,?)",
      [hid, o.title, cwd, "auto", "{}", wid, o.agent, o.model, "done", o.report, o.branch ?? "", o.call, t0 - 3 * MIN, t0 - MIN],
    );
    db.run("INSERT INTO messages (id, workspace_id, role, content, created_at) VALUES (?,?,?,?,?)", [id("m_"), hid, "user", JSON.stringify([{ type: "text", text: o.task }]), t0 - 3 * MIN]);
    db.run("INSERT INTO messages (id, workspace_id, role, content, created_at) VALUES (?,?,?,?,?)", [id("m_"), hid, "assistant", JSON.stringify([{ type: "text", text: `${o.work}\n\n${o.report}` }]), t0 - MIN]);
    db.run("INSERT INTO usage (workspace_id, kind, model, input, output, cache_read, cache_write, cost, created_at) VALUES (?,?,?,?,?,?,?,?,?)", [hid, "pilot", o.model, 30000, 4000, 90000, 6000, o.cost, t0 - MIN]);
  };
  helper({
    call: calls.a,
    agent: "explorer",
    title: "Where the 14 minutes go",
    model: "claude-sonnet-5-5",
    cost: 0.21,
    task: "Read the last 20 CI runs in .github/workflows and the logs in ci-logs/. Report the slowest steps with their median time.",
    work: "Reading the workflow and the 20 newest logs.",
    report: "Outcome: done, 20 runs measured.\n\n- **e2e** 8m 40s median, one machine (`ci.yml:48`)\n- **install** 2m 10s, the cache never hits\n- **unit tests** 1m 30s, already parallel\n\nFiles changed: none.",
  });
  helper({
    call: calls.b,
    agent: "builder",
    title: "Shard the e2e suite",
    model: "claude-opus-5-5",
    cost: 1.36,
    branch: "orbit/shard-the-e2e-suite-4f2a",
    task: "Split the Playwright suite in e2e/ into 4 shards in CI. Keep every test. Run it locally to check the shards add up to the full suite.",
    work: "Adding a matrix of four shards and running each locally.",
    report: "Outcome: done. 4 shards, 186 tests, the same 186 as before.\n\n- `ci.yml`: a `shard: [1, 2, 3, 4]` matrix and `--shard=${{ matrix.shard }}/4`\n- each shard about 2m 30s locally\n\nFiles changed: .github/workflows/ci.yml, e2e/playwright.config.ts",
  });
  helper({
    call: calls.c,
    agent: "reviewer",
    title: "Check the dependency cache",
    model: "claude-opus-5-5",
    cost: 0.34,
    task: "Review how .github/workflows/ci.yml caches node_modules and the Playwright browsers. Report anything that makes the cache miss.",
    work: "Reading the cache steps.",
    report: "Outcome: one real problem.\n\n1. **High:** the key ends in `${{ github.run_id }}` (`ci.yml:22`), so it never matches. Use the lockfile hash alone.\n2. Low: the Playwright browsers aren't cached at all.\n\nFiles changed: none.",
  });
}

// 8. a doc with comments, and a whiteboard
{
  const { createDoc, addComment, getDoc } = await import("../server/docs");
  const { apply } = await import("../server/board");
  const lp = db.query<{ id: string }, []>("SELECT id FROM workspaces WHERE title = 'Landing page copy'").get()!.id;
  db.run("UPDATE workspaces SET updated_at = ? WHERE id = ?", [t0 - 20 * MIN, lp]);
  const d = createDoc(
    lp,
    "Launch plan",
    "# Launch plan\n\n## Goal\nShip the public beta on the 14th with the API, the docs and a status page.\n\n## Steps\n1. Freeze the API on the 7th; only fixes after that.\n2. Write the getting started guide and the API reference.\n3. Set up the status page and the alerts behind it.\n4. Invite the first 50 people from the waiting list.\n\n## Risks\n- The billing provider still needs to approve the account.\n- Two of the five integration tests fail on Windows.\n",
    "agent",
  );
  const c = addComment(d, { author: "user", quote: "Write the getting started guide and the API reference.", body: "Can the API reference come later? It takes longer than the guide." });
  addComment(getDoc(d.id)!, { author: "agent", parent_id: c.id, body: "Yes. The reference can be generated from the OpenAPI file in a day, so I moved it to after the freeze and kept the guide in step 2." });
  addComment(getDoc(d.id)!, { author: "user", quote: "Invite the first 50 people", body: "Make it 30, support is just two of us." });
  const host = db.query<{ id: string }, []>("SELECT id FROM workspaces WHERE title = 'Hosting cost comparison'").get()!.id;
  apply(
    host,
    [
      { op: "add", kind: "frame", ref: "opts", title: "Three ways to host it", x: 0, y: 0, w: 780, h: 260 },
      { op: "add", kind: "note", ref: "a", frame: "opts", text: "Hetzner\n137 CHF a month\nCheapest, backups extra", color: "mint" },
      { op: "add", kind: "note", ref: "b", frame: "opts", text: "UpCloud\n217 CHF a month\nManaged backups", color: "sky" },
      { op: "add", kind: "note", ref: "c", frame: "opts", text: "Infomaniak\n241 CHF a month\nSwiss, green power", color: "lavender" },
      { op: "add", kind: "checklist", ref: "todo", title: "Before we pick", x: 0, y: 320, items: [{ text: "Check egress pricing", done: true }, { text: "Ask about IPv6", done: false }, { text: "Test a restore from backup", done: false }] },
      { op: "add", kind: "text", ref: "rec", x: 330, y: 330, w: 450, text: "**Recommendation:** Hetzner, with a nightly offsite backup. The savings pay for the backup twice over." },
      { op: "add", kind: "link", ref: "l", x: 330, y: 470, url: "https://www.hetzner.com/cloud", title: "Hetzner Cloud pricing" },
      { op: "connect", from: "a", to: "rec", label: "pick" },
    ],
    "agent",
  );
}

db.run("INSERT INTO pins (workspace_id, text, created_at) SELECT id, 'The API package is published to npm as @acme/api; never change exported types without a major version.', ? FROM workspaces WHERE title = 'Fix tests after zod 4'", [t0]);

console.log(`demo data in ${home}`);
await import("../server/index");
