// Integrations: which known programs are installed, and opening files in your editor.

import { existsSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { CATALOG, defaultEditor, detect, editors, fill, findApp, type App } from "./catalog";
import { config } from "./config";

export function listIntegrations(force = false) {
  const found = detect(force);
  const chosen = chosenEditor();
  return {
    editor: config().integrations.editor,
    resolvedEditor: chosen?.id ?? null,
    apps: CATALOG.map((a) => ({
      id: a.id,
      name: a.name,
      cat: a.cat,
      bin: a.bin[0],
      path: found.get(a.id)?.path ?? null,
      readonly: a.readonly?.length ?? 0,
      guard: a.guard?.length ?? 0,
      hint: a.hint ?? null,
      editor: !!(a.open || a.scheme),
    })),
  };
}

export function chosenEditor(): App | undefined {
  const id = config().integrations.editor;
  if (id && id !== "auto" && id !== "none") return findApp(id);
  if (id === "none") return undefined;
  return defaultEditor();
}

const versions = new Map<string, string>();
const VERSION_ARGS: Record<string, string[]> = {
  go: ["version"],
  java: ["-version"],
  kubectl: ["version", "--client"],
  helm: ["version", "--short"],
  terraform: ["version"],
  ffmpeg: ["-version"],
  openssl: ["version"],
  tmux: ["-V"],
  ssh: ["-V"],
  adb: ["version"],
  flutter: ["--version", "--suppress-analytics"],
};
/** Ask each installed program for its version, a few at a time, with a short timeout. */
export async function probeVersions(): Promise<Record<string, string>> {
  const found = detect();
  const jobs = CATALOG.filter((a) => found.get(a.id)?.path && !versions.has(a.id) && !a.paths?.some((p) => found.get(a.id)?.path?.includes(".app")));
  const run = async (a: App) => {
    const path = found.get(a.id)!.path!;
    try {
      const proc = Bun.spawn([path, ...(VERSION_ARGS[a.id] ?? ["--version"])], { stdout: "pipe", stderr: "pipe", stdin: "ignore" });
      const t = setTimeout(() => proc.kill(), 2500);
      const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
      clearTimeout(t);
      // drop addresses (a proxy notice can mention 127.0.0.1), prefer the number after "version"
      const text = (out + "\n" + err).replace(/\b\d+\.\d+\.\d+\.\d+\b/g, "");
      const m = text.match(/version\D{0,3}(\d+\.\d+(?:\.\d+)?)/i) ?? text.match(/(\d+\.\d+(?:\.\d+)?)/);
      versions.set(a.id, m ? m[1] : "");
      return;
    } catch {
      versions.set(a.id, "");
    }
  };
  for (let i = 0; i < jobs.length; i += 8) await Promise.all(jobs.slice(i, i + 8).map(run));
  return Object.fromEntries(versions);
}

/**
 * Open a file (at a line) or a folder in the user's editor. The path must be
 * inside the workspace folder, so a request can't point the editor anywhere else.
 */
export function openInEditor(cwd: string, path: string, line?: number, appId?: string, find?: string): { ok: boolean; error?: string; link?: string; app?: string } {
  const app = appId ? findApp(appId) : chosenEditor();
  if (!app || !(app.open || app.scheme)) return { ok: false, error: "No editor found. Pick one in Settings, Integrations." };
  const full = resolve(cwd, path || ".");
  const root = resolve(cwd);
  if (!(full === root || full.startsWith(root + (root.endsWith("/") || root.endsWith("\\") ? "" : process.platform === "win32" ? "\\" : "/"))))
    return { ok: false, error: "That path is outside the workspace folder." };
  if (!isAbsolute(full) || !existsSync(full)) return { ok: false, error: "That file doesn't exist." };
  const isDir = statSync(full).isDirectory();
  // land on the text Claude just wrote, when the caller knows it but not the line
  if (!isDir && !line && find && statSync(full).size < 5_000_000) {
    const text = readFileSync(full, "utf8");
    const at = text.indexOf(find.split("\n")[0]);
    if (at >= 0) line = text.slice(0, at).split("\n").length;
  }
  const found = detect().get(app.id)?.path;
  const onPath = found && !found.endsWith(".app") && !found.endsWith(".exe");
  if (app.open && onPath) {
    const argv = isDir || !line ? [app.open[0], full] : fill(app.open, full, line);
    argv[0] = found!;
    try {
      Bun.spawn(argv, { stdin: "ignore", stdout: "ignore", stderr: "ignore", detached: true } as any).unref();
      return { ok: true, app: app.name };
    } catch (e) {
      // fall through to the link
    }
  }
  if (app.scheme) {
    const p = full.replace(/\\/g, "/");
    return { ok: true, app: app.name, link: fill([app.scheme], p.startsWith("/") ? p : `/${p}`, line ?? 1)[0] };
  }
  if (found?.endsWith(".app") && process.platform === "darwin") {
    Bun.spawn(["open", "-a", found, full], { stdin: "ignore", stdout: "ignore", stderr: "ignore" });
    return { ok: true, app: app.name };
  }
  return { ok: false, error: `${app.name} is installed but its command isn't on your PATH.` };
}

export const editorChoices = () =>
  editors().map((e) => ({ id: e.id, name: e.name, found: !!detect().get(e.id)?.path }));
