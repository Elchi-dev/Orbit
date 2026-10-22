import { discardHelper, helpersOf, helperView, listAgents, mergeHelper } from "./helpers";
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync, unlinkSync } from "node:fs";
import { join, resolve, dirname, extname } from "node:path";
import { homedir } from "node:os";
import { loadConfig, config, saveConfig, deepMerge, CONFIG_PATH, ORBIT_DIR, type Config } from "./config";
import { db, now, uid, getWorkspace, listMessages, workspaceStats, costSince, startOfDay, startOfMonth, type WorkspaceRow } from "./db";
import { apiKey, setSecret, deleteSecret } from "./secrets";
import { validateKey, isMock } from "./anthropic";
import { addClient, removeClient, broadcast } from "./hub";
import { runTurn, stop, kill, isRunning, clearHistory, compact, runningIds, lastRate, steer } from "./agent";
import { resolveApproval, pendingApprovals, allRules, addRule } from "./gate";
import { dropShell } from "./shell";
import {
  state as gitState,
  diff as gitDiff,
  stage as gitStage,
  stageAll as gitStageAll,
  unstage as gitUnstage,
  discard as gitDiscard,
  commit as gitCommit,
  draftMessage as gitDraft,
  checkout as gitSwitch,
  createBranch as gitBranch,
  push as gitPush,
  pull as gitPull,
  init as gitInit,
} from "./git";
import { screenshot, shotPath } from "./screenshot";
import { closePreview, openPreview, previewState, resolveTarget, startPreviewServer } from "./preview";
import { keep, reviewList, revert, revertAll } from "./review";
import { byHook, createMission, deleteMission, launch, listMissions, startScheduler, updateMission } from "./missions";
import { findCommands, findSkills, projectInstructions } from "./context";
import { getProfile, listProfiles } from "./profiles";
import { mcpStatus, reconnect, stopAllMcp, syncMcp } from "./mcp";
import { editorChoices, listIntegrations, openInEditor, probeVersions } from "./integrations";
import { assets } from "./embedded";
import { originAllowed } from "./origin";

declare const ORBIT_VERSION: string;
const VERSION = typeof ORBIT_VERSION === "string" ? ORBIT_VERSION : "dev";

// ---- command line ----
const argv = process.argv.slice(2);
const flag = (name: string) => {
  const i = argv.findIndex((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (i < 0) return undefined;
  const a = argv[i];
  return a.includes("=") ? a.split("=").slice(1).join("=") : argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : "true";
};
if (flag("version") || argv.includes("-v")) {
  console.log(`orbit ${VERSION}`);
  process.exit(0);
}
if (flag("help") || argv.includes("-h")) {
  console.log(`orbit ${VERSION}: your own AI workspace on localhost

  orbit                 start and open http://localhost:7777
  orbit .               open this folder as a workspace (starts Orbit if needed)
  orbit ~/code/api      the same for any folder
  orbit --port 7778     use another port
  orbit --no-open       don't open the browser
  orbit --mock          run with a fake model (no API calls), for trying the interface
  orbit --version

  Config: ~/.orbit/orbit.toml   Data: ~/.orbit/orbit.db   (set ORBIT_HOME to move both)`);
  process.exit(0);
}
// a folder given on the command line opens as a workspace
const VALUE_FLAGS = new Set(["--port", "--host"]);
const positional = argv.find((a, i) => !a.startsWith("-") && !VALUE_FLAGS.has(argv[i - 1] ?? ""));
const OPEN_PATH = positional ? resolve(positional.replace(/^~(?=$|[\\/])/, homedir())) : null;
if (OPEN_PATH && !existsSync(OPEN_PATH)) {
  console.error(`  No such folder: ${OPEN_PATH}`);
  process.exit(1);
}
const openHash = () => (OPEN_PATH ? `/#/open?path=${encodeURIComponent(OPEN_PATH)}` : "");

function openBrowser(target: string) {
  const opener = process.platform === "darwin" ? ["open", target] : process.platform === "win32" ? ["cmd", "/c", "start", "", target] : ["xdg-open", target];
  try {
    Bun.spawn(opener, { stdout: "ignore", stderr: "ignore" });
  } catch {}
}

if (flag("mock")) process.env.ORBIT_MOCK = "1";
if (flag("no-open")) process.env.ORBIT_NO_OPEN = "1";

loadConfig();
const cfg = config();
syncMcp();
startScheduler();
const PORT = Number(flag("port") ?? process.env.PORT ?? cfg.server.port);
const HOST = flag("host") ?? process.env.HOST ?? cfg.server.host;
const TOKEN = crypto.randomUUID();
const LOCAL_HOSTS = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

// ---------- helpers ----------
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8" } });
const bad = (message: string, status = 400) => json({ error: message }, status);

function cookieToken(req: Request) {
  const c = req.headers.get("cookie") ?? "";
  return c.match(/(?:^|;\s*)orbit_token=([^;]+)/)?.[1];
}
function hostOk(req: Request) {
  if (HOST !== "127.0.0.1" && HOST !== "localhost") return true;
  return LOCAL_HOSTS.test(req.headers.get("host") ?? "");
}
function originOk(req: Request) {
  return originAllowed(req.headers.get("origin"), req.headers.get("host"));
}
function authed(req: Request) {
  return hostOk(req) && originOk(req) && cookieToken(req) === TOKEN;
}

const PLANET_COLORS = ["#7A64E0", "#3E5BC8", "#E58C78", "#2BA3AB", "#C2547A", "#9C8BF0", "#D9733A", "#6E86E8"];
const SURFACES = ["gas", "rocky", "ice", "ocean", "lava"];
const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];

function slug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "workspace";
}

function wsPayload(w: WorkspaceRow) {
  const stats = workspaceStats(w.id);
  const pending = pendingApprovals().filter((p) => p.workspaceId === w.id).length;
  const msgCount = db.query<{ n: number }, [string]>("SELECT COUNT(*) AS n FROM messages WHERE workspace_id = ?").get(w.id)!.n;
  let plan: unknown[] = [];
  try {
    plan = JSON.parse(w.plan || "[]");
  } catch {}
  const helpers = w.parent_id ? [] : helpersOf(w.id).map((h) => ({ ...helperView(h), running: isRunning(h.id), pending: pendingApprovals().filter((p) => p.workspaceId === h.id).length }));
  return { ...w, style: JSON.parse(w.style || "{}"), plan, stats, running: isRunning(w.id), pending, messageCount: msgCount, helpers };
}

function publicConfig() {
  return config();
}

function stateSummary() {
  const c = config();
  const today = costSince(startOfDay());
  const month = costSince(startOfMonth());
  return {
    version: VERSION,
    mock: isMock(),
    hasKey: !!apiKey(),
    configPath: CONFIG_PATH,
    dataDir: ORBIT_DIR,
    platform: process.platform,
    home: homedir(),
    config: publicConfig(),
    today,
    month,
    rate: lastRate,
    running: runningIds(),
    approvals: pendingApprovals(),
    budget: c.budget,
    profiles: listProfiles(),
  };
}

function listWorkspaces() {
  return db
    .query<WorkspaceRow, []>("SELECT * FROM workspaces WHERE archived = 0 ORDER BY updated_at DESC")
    .all()
    .map(wsPayload);
}

function createWorkspace(body: any) {
  const c = config();
  const id = uid("w_");
  const title = String(body.title ?? "New workspace").slice(0, 80);
  const tilde = (p: string) => p.replace(/^~(?=$|[\\/])/, homedir());
  const cwd = body.cwd ? resolve(tilde(String(body.cwd))) : join(resolve(tilde(c.workspaces.home)), `${slug(title)}-${id.slice(2, 7)}`);
  mkdirSync(cwd, { recursive: true });
  const style = { color: pick(PLANET_COLORS), surface: pick(SURFACES), rings: Math.random() < 0.25 };
  const profile = getProfile(body.profile ? String(body.profile) : undefined);
  db.run(
    "INSERT INTO workspaces (id, title, cwd, model, mode, style, system_prompt, incognito, titled, profile, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
    [id, title, cwd, body.model ?? null, body.mode ?? profile.mode, JSON.stringify(style), body.system_prompt ?? "", body.incognito ? 1 : 0, body.title ? 1 : 0, profile.id, now(), now()],
  );
  const w = getWorkspace(id)!;
  broadcast("workspace", { workspace: wsPayload(w) });
  return w;
}

function workspaceDetail(id: string) {
  const w = getWorkspace(id);
  if (!w) return null;
  const messages = listMessages(id).map((m) => ({ ...m, content: JSON.parse(m.content) }));
  const calls = db.query("SELECT * FROM tool_calls WHERE workspace_id = ? ORDER BY created_at").all(id);
  const pins = db.query("SELECT * FROM pins WHERE workspace_id = ? ORDER BY id").all(id);
  const snapshots = db
    .query("SELECT id, path, existed, restored, created_at FROM snapshots WHERE workspace_id = ? ORDER BY id DESC LIMIT 100")
    .all(id);
  const last = db
    .query("SELECT model, input, output, cache_read, cache_write, ttft_ms, tps, cost FROM usage WHERE workspace_id = ? AND kind = 'pilot' ORDER BY id DESC LIMIT 1")
    .get(id);
  const judge = db.query<{ cost: number; n: number }, [string]>("SELECT COALESCE(SUM(cost),0) AS cost, COUNT(*) AS n FROM usage WHERE workspace_id = ? AND kind = 'judge'").get(id);
  return { workspace: wsPayload(w), messages, calls, pins, snapshots, last, judge, approvals: pendingApprovals().filter((a) => a.workspaceId === id), preview: previewState(id) };
}

function undoLast(id: string) {
  const s = db
    .query<{ id: number; path: string; existed: number; content: Uint8Array | null }, [string]>(
      "SELECT id, path, existed, content FROM snapshots WHERE workspace_id = ? AND restored = 0 ORDER BY id DESC LIMIT 1",
    )
    .get(id);
  if (!s) return null;
  if (s.existed && s.content) {
    mkdirSync(dirname(s.path), { recursive: true });
    writeFileSync(s.path, Buffer.from(s.content));
  } else if (!s.existed && existsSync(s.path)) unlinkSync(s.path);
  db.run("UPDATE snapshots SET restored = 1 WHERE id = ?", [s.id]);
  broadcast("file_changed", { workspaceId: id, path: s.path, kind: "undo" });
  return s.path;
}

function exportMarkdown(id: string) {
  const w = getWorkspace(id)!;
  let md = `# ${w.title}\n\nFolder: ${w.cwd}\n\n`;
  for (const m of listMessages(id)) {
    for (const b of JSON.parse(m.content) as any[]) {
      if (b.type === "text") md += `**${m.role === "user" ? "You" : "Claude"}:** ${b.text}\n\n`;
      else if (b.type === "tool_use") md += `\`\`\`\n$ ${b.name} ${b.name === "bash" ? b.input.command : JSON.stringify(b.input)}\n\`\`\`\n\n`;
      else if (b.type === "tool_result") md += `<details><summary>output</summary>\n\n\`\`\`\n${String(typeof b.content === "string" ? b.content : "").slice(0, 4000)}\n\`\`\`\n</details>\n\n`;
    }
  }
  return md;
}

function listDir(p: string) {
  const path = resolve(p.replace(/^~(?=$|\/)/, homedir()) || homedir());
  try {
    const entries = readdirSync(path, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith("."))
      .map((e) => e.name)
      .sort()
      .slice(0, 300);
    return { path, parent: dirname(path), entries };
  } catch (e) {
    return { path, parent: dirname(path), entries: [], error: (e as Error).message };
  }
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".json": "application/json",
  ".ico": "image/x-icon",
};

function staticFile(pathname: string): Response | null {
  const key = pathname === "/" ? "/index.html" : pathname;
  const a = assets[key];
  if (a) {
    return new Response(Buffer.from(a.data, "base64"), {
      headers: { "content-type": a.type, "cache-control": key === "/index.html" ? "no-cache" : "public, max-age=31536000, immutable" },
    });
  }
  const dist = resolve(import.meta.dir, "../dist");
  const file = resolve(dist, "." + key);
  if (file.startsWith(dist) && existsSync(file) && statSync(file).isFile())
    return new Response(Bun.file(file), { headers: { "content-type": MIME[extname(file)] ?? "application/octet-stream" } });
  return null;
}

function indexResponse(): Response {
  const r = staticFile("/index.html");
  const headers = new Headers(r?.headers ?? { "content-type": "text/html; charset=utf-8" });
  headers.append("set-cookie", `orbit_token=${TOKEN}; HttpOnly; SameSite=Strict; Path=/`);
  if (!r)
    return new Response(
      `<!doctype html><meta charset="utf-8"><title>Orbit</title><body style="background:#0A0A1A;color:#F2EFFF;font-family:system-ui;padding:40px">Orbit server is running. The interface isn't built yet: run <code>bun run build:web</code>, or use <code>bun run dev</code> and open the Vite URL.</body>`,
      { headers },
    );
  return new Response(r.body, { headers });
}

// ---------- routes ----------
async function api(req: Request, url: URL): Promise<Response> {
  const p = url.pathname;
  const m = req.method;
  const body = async () => {
    try {
      return await req.json();
    } catch {
      return {};
    }
  };
  let match: RegExpMatchArray | null;

  if (p === "/api/state" && m === "GET") return json(stateSummary());

  if (p === "/api/key" && m === "POST") {
    const { key } = await body();
    if (!key || typeof key !== "string") return bad("Paste an API key");
    const v = await validateKey(key.trim());
    if (!v.ok) return bad(v.error ?? "That key didn't work");
    setSecret("anthropic", key.trim());
    broadcast("state", stateSummary());
    return json({ ok: true });
  }
  if (p === "/api/key" && m === "DELETE") {
    deleteSecret("anthropic");
    return json({ ok: true });
  }

  if (p === "/api/config" && m === "GET") return json(config());
  if (p === "/api/config" && m === "PUT") {
    const patch = await body();
    const next = deepMerge(structuredClone(config()), patch) as Config;
    if (Array.isArray(patch?.permissions?.rules)) next.permissions.rules = patch.permissions.rules;
    // tables that can lose entries are replaced, not merged
    if (patch?.mcp?.servers) next.mcp.servers = patch.mcp.servers;
    if (patch?.profiles) next.profiles = patch.profiles;
    saveConfig(next);
    syncMcp();
    broadcast("state", stateSummary());
    return json(next);
  }

  if (p === "/api/profiles" && m === "GET") return json(listProfiles());
  if (p === "/api/mcp" && m === "GET") return json(mcpStatus());
  if ((match = p.match(/^\/api\/mcp\/([\w.-]+)\/reconnect$/)) && m === "POST") {
    await reconnect(match[1]);
    return json(mcpStatus());
  }
  if (p === "/api/integrations" && m === "GET") return json({ ...listIntegrations(url.searchParams.has("rescan")), editors: editorChoices() });
  if (p === "/api/integrations/versions" && m === "GET") return json(await probeVersions());
  if (p === "/api/open" && m === "POST") {
    const b = await body();
    const ws = getWorkspace(String(b.workspaceId ?? ""));
    if (!ws) return bad("No such workspace");
    const r = openInEditor(ws.cwd, String(b.path ?? "."), Number(b.line) || undefined, b.app ? String(b.app) : undefined, b.find ? String(b.find) : undefined);
    return r.ok ? json(r) : bad(r.error ?? "Couldn't open it");
  }

  if (p === "/api/workspaces/open" && m === "POST") {
    // find the newest workspace for a folder, or make one; used by `orbit <folder>` and the editor extensions
    let path = String((await body()).path ?? "").replace(/^~(?=$|[\\/])/, homedir());
    if (!path || !existsSync(path)) return bad("That folder doesn't exist");
    path = resolve(path);
    const isFile = !statSync(path).isDirectory();
    // the workspace for this folder, or for the nearest folder above it, newest first
    const rows = db
      .query<{ id: string; cwd: string }, []>("SELECT id, cwd FROM workspaces WHERE archived = 0 AND incognito = 0 ORDER BY updated_at DESC")
      .all();
    const sep = process.platform === "win32" ? "\\" : "/";
    const near = rows
      .filter((r) => path === r.cwd || path.startsWith(r.cwd.endsWith(sep) ? r.cwd : r.cwd + sep))
      .sort((a, b) => b.cwd.length - a.cwd.length)[0];
    if (isFile && !near) path = dirname(path);
    const w = near ? getWorkspace(near.id)! : createWorkspace({ cwd: path, title: path.split(/[\\/]/).filter(Boolean).pop() ?? "Workspace" });
    return json(wsPayload(w));
  }

  if (p === "/api/workspaces" && m === "GET") return json(listWorkspaces());
  if (p === "/api/workspaces" && m === "POST") return json(wsPayload(createWorkspace(await body())));

  if ((match = p.match(/^\/api\/workspaces\/([\w]+)$/))) {
    const id = match[1];
    if (!getWorkspace(id)) return bad("No such workspace", 404);
    if (m === "GET") return json(workspaceDetail(id));
    if (m === "PATCH") {
      const b = await body();
      const allowed = ["title", "cwd", "model", "mode", "system_prompt", "judge_notes", "archived", "profile"] as const;
      for (const k of allowed) if (k in b) db.run(`UPDATE workspaces SET ${k} = ? WHERE id = ?`, [b[k], id]);
      if ("style" in b) db.run("UPDATE workspaces SET style = ? WHERE id = ?", [JSON.stringify(b.style), id]);
      if ("title" in b) db.run("UPDATE workspaces SET titled = 1 WHERE id = ?", [id]);
      if ("cwd" in b) {
        mkdirSync(String(b.cwd), { recursive: true });
        dropShell(id);
      }
      const w = getWorkspace(id)!;
      broadcast("workspace", { workspace: wsPayload(w) });
      return json(wsPayload(w));
    }
    if (m === "DELETE") {
      for (const h of helpersOf(id)) {
        kill(h.id);
        dropShell(h.id);
        if (h.branch && !["merged", "discarded"].includes(h.helper_state)) await discardHelper(h.id).catch(() => {});
        db.run("DELETE FROM workspaces WHERE id = ?", [h.id]);
      }
      kill(id);
      dropShell(id);
      db.run("DELETE FROM search WHERE workspace_id = ?", [id]);
      db.run("DELETE FROM usage WHERE workspace_id = ? AND ? = 1", [id, url.searchParams.get("purge") === "1" ? 1 : 0]);
      db.run("DELETE FROM workspaces WHERE id = ?", [id]);
      broadcast("workspace_deleted", { workspaceId: id });
      return json({ ok: true });
    }
  }
  if ((match = p.match(/^\/api\/helpers\/([\w]+)\/(merge|discard)$/)) && m === "POST") {
    try {
      const r = match[2] === "merge" ? await mergeHelper(match[1]) : await discardHelper(match[1]);
      const h = getWorkspace(match[1]);
      if (h?.parent_id) broadcast("workspace", { workspace: wsPayload(getWorkspace(h.parent_id)!) });
      return json(r);
    } catch (e) {
      return bad((e as Error).message, 409);
    }
  }
  if (p === "/api/agents" && m === "GET") {
    const w = url.searchParams.get("ws") ? getWorkspace(url.searchParams.get("ws")!) : null;
    return json(listAgents(w?.cwd).map(({ prompt, ...a }) => ({ ...a, prompt: prompt.slice(0, 2000) })));
  }
  if ((match = p.match(/^\/api\/workspaces\/([\w]+)\/git(?:\/([a-z-]+))?$/))) {
    const w = getWorkspace(match[1]);
    if (!w) return bad("No such workspace", 404);
    const action = match[2] ?? "";
    try {
      if (!action && m === "GET") return json(await gitState(w.cwd));
      if (action === "diff" && m === "GET") return json({ diff: await gitDiff(w.cwd, url.searchParams.get("path") ?? "", url.searchParams.get("staged") === "1") });
      if (m !== "POST") return bad("Not found", 404);
      const b = await body();
      if (action === "stage") await (b.all ? gitStageAll(w.cwd) : gitStage(w.cwd, b.paths));
      else if (action === "unstage") await gitUnstage(w.cwd, b.paths);
      else if (action === "discard") await gitDiscard(w.cwd, b.paths);
      else if (action === "commit") await gitCommit(w.cwd, String(b.message ?? ""), !!b.all);
      else if (action === "draft") return json({ message: await gitDraft(w.id, w.cwd) });
      else if (action === "switch") await gitSwitch(w.cwd, String(b.branch ?? ""));
      else if (action === "branch") await gitBranch(w.cwd, String(b.branch ?? ""));
      else if (action === "push") await gitPush(w.cwd);
      else if (action === "pull") await gitPull(w.cwd);
      else if (action === "init") await gitInit(w.cwd);
      else return bad("Not found", 404);
      return json(await gitState(w.cwd));
    } catch (e) {
      return bad((e as Error).message);
    }
  }

  if ((match = p.match(/^\/api\/workspaces\/([\w]+)\/context$/)) && m === "GET") {
    const w = getWorkspace(match[1]);
    if (!w) return bad("No such workspace", 404);
    const c = config();
    return json({
      files: c.context.project_files ? projectInstructions(w.cwd).map((f) => ({ path: f.path, chars: f.text.length, cut: f.cut })) : [],
      skills: findSkills(w.cwd).map((s) => ({ name: s.name, description: s.description, source: s.source, dir: s.dir })),
      commands: findCommands(w.cwd),
    });
  }

  if ((match = p.match(/^\/api\/workspaces\/([\w]+)\/review(?:\/(keep|undo))?$/))) {
    const w = getWorkspace(match[1]);
    if (!w) return bad("No such workspace", 404);
    try {
      if (!match[2] && m === "GET") return json(reviewList(w.id));
      if (m === "POST") {
        const { path, all } = await body();
        if (match[2] === "keep") keep(w.id, all ? undefined : String(path ?? ""));
        else if (all) revertAll(w.id);
        else revert(w.id, String(path ?? ""));
        return json(reviewList(w.id));
      }
    } catch (e) {
      return bad((e as Error).message);
    }
  }
  if ((match = p.match(/^\/api\/workspaces\/([\w]+)\/preview$/))) {
    if (!getWorkspace(match[1])) return bad("No such workspace", 404);
    try {
      if (m === "GET") return json(previewState(match[1]));
      if (m === "POST") return json(openPreview(match[1], String((await body()).target ?? ".")));
      if (m === "DELETE") {
        closePreview(match[1]);
        return json({ ok: true });
      }
    } catch (e) {
      return bad((e as Error).message);
    }
  }
  if ((match = p.match(/^\/api\/workspaces\/([\w]+)\/screenshot$/)) && m === "POST") {
    if (!getWorkspace(match[1])) return bad("No such workspace", 404);
    const b = await body();
    try {
      // your own action: any address, or a path in the workspace
      const target = String(b.url ?? b.target ?? "").trim();
      const url = /^https?:\/\//.test(target) ? target : resolveTarget(match[1], target || ".").url;
      const s = await screenshot(url, Number(b.width) || 1280, { full: !!b.full, remote: true });
      return json({ image: s.image, console: s.console, width: s.width, file: s.file });
    } catch (e) {
      return bad((e as Error).message);
    }
  }
  if ((match = p.match(/^\/api\/shots\/([\w.-]+\.png)$/)) && m === "GET") {
    const f = shotPath(match[1]);
    if (!f || !existsSync(f)) return bad("No such screenshot", 404);
    return new Response(Bun.file(f), { headers: { "content-type": "image/png", "cache-control": "private, max-age=86400" } });
  }
  if ((match = p.match(/^\/api\/workspaces\/([\w]+)\/missions$/))) {
    if (!getWorkspace(match[1])) return bad("No such workspace", 404);
    if (m === "GET") return json(listMissions(match[1]));
    if (m === "POST") {
      try {
        return json(createMission(match[1], await body()));
      } catch (e) {
        return bad((e as Error).message);
      }
    }
  }
  if ((match = p.match(/^\/api\/missions\/(m_\w+)(?:\/(run))?$/))) {
    try {
      if (match[2] === "run" && m === "POST") {
        launch(match[1], "manual").catch(() => {});
        return json({ started: true });
      }
      if (m === "PATCH") return json(updateMission(match[1], await body()));
      if (m === "DELETE") {
        deleteMission(match[1]);
        return json({ ok: true });
      }
    } catch (e) {
      return bad((e as Error).message);
    }
  }

  if ((match = p.match(/^\/api\/workspaces\/([\w]+)\/compact$/)) && m === "POST") {
    if (!getWorkspace(match[1])) return bad("No such workspace", 404);
    try {
      return json(await compact(match[1], Number((await body()).keep) || 3));
    } catch (e) {
      return bad((e as Error).message);
    }
  }
  if ((match = p.match(/^\/api\/workspaces\/([\w]+)\/clear$/)) && m === "POST") {
    const { keepSummary } = await body();
    return json(await clearHistory(match[1], !!keepSummary));
  }
  if ((match = p.match(/^\/api\/workspaces\/([\w]+)\/undo$/)) && m === "POST") {
    const path = undoLast(match[1]);
    return path ? json({ path }) : bad("Nothing to undo");
  }
  if ((match = p.match(/^\/api\/workspaces\/([\w]+)\/export$/)) && m === "GET") {
    const id = match[1];
    const w = getWorkspace(id);
    if (!w) return bad("No such workspace", 404);
    if (url.searchParams.get("format") === "json") return json(workspaceDetail(id));
    return new Response(exportMarkdown(id), {
      headers: { "content-type": "text/markdown; charset=utf-8", "content-disposition": `attachment; filename="${slug(w.title)}.md"` },
    });
  }
  if ((match = p.match(/^\/api\/workspaces\/([\w]+)\/pins(?:\/(\d+))?$/))) {
    const id = match[1];
    if (m === "POST") {
      const { text } = await body();
      if (text) db.run("INSERT INTO pins (workspace_id, text, created_at) VALUES (?,?,?)", [id, String(text), now()]);
    } else if (m === "DELETE" && match[2]) db.run("DELETE FROM pins WHERE id = ? AND workspace_id = ?", [Number(match[2]), id]);
    broadcast("pins", { workspaceId: id });
    return json(db.query("SELECT * FROM pins WHERE workspace_id = ? ORDER BY id").all(id));
  }

  if (p === "/api/rules" && m === "GET") return json(allRules(url.searchParams.get("workspace") ?? undefined));
  if (p === "/api/rules" && m === "POST") {
    const b = await body();
    if (!b.pattern || !["allow", "deny", "ask"].includes(b.verdict)) return bad("A rule needs a pattern and a verdict");
    addRule(b.scope ?? "global", String(b.pattern), b.verdict, b.kind === "regex" ? "regex" : "glob");
    return json({ ok: true });
  }
  if ((match = p.match(/^\/api\/rules\/(\d+)$/)) && m === "DELETE") {
    db.run("DELETE FROM rules WHERE id = ?", [Number(match[1])]);
    broadcast("rules", {});
    return json({ ok: true });
  }

  if (p === "/api/search" && m === "GET") {
    const q = (url.searchParams.get("q") ?? "").trim();
    if (!q) return json([]);
    const fts = q
      .split(/\s+/)
      .map((t) => `"${t.replace(/"/g, "")}"*`)
      .join(" ");
    try {
      const rows = db
        .query(
          `SELECT s.workspace_id, s.message_id, snippet(search, 0, '[[', ']]', '…', 14) AS snippet, w.title
           FROM search s JOIN workspaces w ON w.id = s.workspace_id WHERE search MATCH ? ORDER BY rank LIMIT 30`,
        )
        .all(fts);
      return json(rows);
    } catch {
      return json([]);
    }
  }

  if (p === "/api/usage" && m === "GET") {
    const days = db
      .query(
        `SELECT strftime('%Y-%m-%d', created_at/1000, 'unixepoch', 'localtime') AS day, kind, SUM(cost) AS cost, SUM(input+output+cache_read+cache_write) AS tokens
         FROM usage WHERE created_at >= ? GROUP BY day, kind ORDER BY day`,
      )
      .all(now() - 30 * 86400_000);
    return json({ days, today: costSince(startOfDay()), month: costSince(startOfMonth()), rate: lastRate });
  }

  if (p === "/api/fs" && m === "GET") return json(listDir(url.searchParams.get("path") ?? homedir()));

  return bad("Not found", 404);
}

// ---------- websocket messages ----------
function onSocketMessage(raw: string) {
  let msg: any;
  try {
    msg = JSON.parse(raw);
  } catch {
    return;
  }
  switch (msg.type) {
    case "send": {
      const content: any[] = [];
      for (const a of msg.attachments ?? []) {
        if (a.kind === "image") content.push({ type: "image", source: { type: "base64", media_type: a.mediaType, data: a.data } });
        else if (a.kind === "pdf") content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: a.data } });
        else if (a.kind === "text") content.push({ type: "text", text: `<attachment name="${a.name}">\n${a.text}\n</attachment>` });
      }
      if (msg.text?.trim()) content.push({ type: "text", text: msg.text });
      if (!content.length) return;
      // already working: the message joins the run at its next step
      if (isRunning(msg.workspaceId)) {
        steer(msg.workspaceId, content);
        break;
      }
      const web = typeof msg.web === "boolean" ? msg.web : getProfile(getWorkspace(msg.workspaceId)?.profile).web;
      runTurn(msg.workspaceId, content, { effort: msg.effort, web }).catch((e) =>
        broadcast("error", { workspaceId: msg.workspaceId, message: (e as Error).message, kind: "busy" }),
      );
      break;
    }
    case "approval":
      resolveApproval(msg.id, msg.decision, msg.pattern, msg.note);
      break;
    case "stop":
      stop(msg.workspaceId);
      break;
    case "kill":
      kill(msg.workspaceId);
      break;
  }
}

// ---------- server ----------
let server: ReturnType<typeof Bun.serve>;
try {
  server = Bun.serve({
    port: PORT,
    hostname: HOST,
    idleTimeout: 120,
    async fetch(req, srv) {
      const url = new URL(req.url);
      if (!hostOk(req)) return new Response("Forbidden host", { status: 403 });
      if (url.pathname === "/ws") {
        if (!authed(req)) return new Response("Unauthorized", { status: 401 });
        return srv.upgrade(req, { data: {} }) ? undefined : new Response("Upgrade failed", { status: 400 });
      }
      if (url.pathname === "/api/session" && process.env.ORBIT_DEV === "1" && originOk(req)) {
        // dev only: the Vite dev server serves index.html, so hand out the session cookie here
        return new Response("{}", { headers: { "content-type": "application/json", "set-cookie": `orbit_token=${TOKEN}; HttpOnly; SameSite=Strict; Path=/` } });
      }
      if (url.pathname === "/api/session") return json({});
      // a mission's webhook: the token in the path is the key, so no session cookie is needed
      const hook = url.pathname.match(/^\/hook\/([a-f0-9]{20})$/);
      if (hook && req.method === "POST") {
        const mission = byHook(hook[1]);
        if (!mission) return bad("No mission with that hook", 404);
        if (isRunning(mission.workspace_id)) return bad("The workspace is busy; try again when it's done", 409);
        const raw = await req.text();
        let extra = raw;
        try {
          const j = JSON.parse(raw);
          extra = typeof j?.text === "string" ? j.text : JSON.stringify(j, null, 2);
        } catch {}
        launch(mission.id, "hook", extra.slice(0, 20_000)).catch(() => {});
        return json({ started: true, mission: mission.title || mission.id }, 202);
      }
      if (url.pathname.startsWith("/api/")) {
        if (!authed(req)) return bad("Unauthorized: reload the page", 401);
        try {
          return await api(req, url);
        } catch (e) {
          console.error(e);
          return bad((e as Error).message, 500);
        }
      }
      if (url.pathname === "/" || url.pathname === "/index.html") return indexResponse();
      return staticFile(url.pathname) ?? indexResponse();
    },
    websocket: {
      open(ws) {
        addClient(ws);
        ws.send(JSON.stringify({ type: "hello", state: stateSummary() }));
      },
      message(_ws, data) {
        onSocketMessage(typeof data === "string" ? data : new TextDecoder().decode(data));
      },
      close(ws) {
        removeClient(ws);
      },
    },
  });
} catch (e) {
  // already running? then hand the folder to it instead of failing
  const running = `http://localhost:${PORT}`;
  const alive = await fetch(`${running}/api/session`, { signal: AbortSignal.timeout(1500) }).then((r) => r.ok).catch(() => false);
  if (alive) {
    console.log(`  Orbit is already running at ${running}${OPEN_PATH ? `, opening ${OPEN_PATH} there` : ""}.`);
    if (!process.env.ORBIT_NO_OPEN) openBrowser(running + openHash());
    process.exit(0);
  }
  console.error(`\n  Orbit could not start on ${HOST}:${PORT}: ${(e as Error).message}\n  Set PORT=7778 to use another port.\n`);
  process.exit(1);
}

const PREVIEW_PORT = startPreviewServer(Number(process.env.ORBIT_PREVIEW_PORT) || (server.port ?? PORT) + 1);
const url = `http://${HOST === "0.0.0.0" ? "localhost" : HOST === "127.0.0.1" ? "localhost" : HOST}:${server.port}`;
console.log(`
   ◯  Orbit ${VERSION}${isMock() ? "  (mock model)" : ""}
      ${url}
      data   ${ORBIT_DIR}
      config ${CONFIG_PATH}${PREVIEW_PORT ? `\n      preview http://127.0.0.1:${PREVIEW_PORT}` : ""}
`);

if ((cfg.server.open_browser || OPEN_PATH) && !process.env.ORBIT_NO_OPEN) openBrowser(url + openHash());

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    for (const id of runningIds()) kill(id);
    stopAllMcp();
    process.exit(0);
  });
}
