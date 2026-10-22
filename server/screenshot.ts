// Screenshots through the Chrome, Chromium, Edge or Brave already on this machine, in
// headless mode, so Orbit needs no browser of its own. The page's console messages
// come back too, which is where most "it looks broken" answers are.

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { ORBIT_DIR } from "./config";

const CANDIDATES = [
  "google-chrome",
  "google-chrome-stable",
  "chromium",
  "chromium-browser",
  "chrome",
  "microsoft-edge",
  "microsoft-edge-stable",
  "brave-browser",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
  `${process.env.PROGRAMFILES ?? "C:\\Program Files"}\\Google\\Chrome\\Application\\chrome.exe`,
  `${process.env["PROGRAMFILES(X86)"] ?? "C:\\Program Files (x86)"}\\Microsoft\\Edge\\Application\\msedge.exe`,
  `${process.env.LOCALAPPDATA ?? ""}\\Google\\Chrome\\Application\\chrome.exe`,
];

let found: string | null | undefined;

/** The browser to use: ORBIT_CHROME, then a system Chrome-family browser, then one Playwright downloaded. */
export function findChrome(): string | null {
  if (found !== undefined) return found;
  const env = process.env.ORBIT_CHROME;
  if (env && existsSync(env)) return (found = env);
  for (const c of CANDIDATES) {
    const p = c.includes("/") || c.includes("\\") ? (existsSync(c) ? c : null) : Bun.which(c);
    if (p) return (found = p);
  }
  // browsers Playwright downloaded (npx playwright install) work as well
  for (const base of [process.env.PLAYWRIGHT_BROWSERS_PATH, join(homedir(), ".cache", "ms-playwright"), join(homedir(), "Library", "Caches", "ms-playwright")]) {
    if (!base || !existsSync(base)) continue;
    try {
      const dirs = require("node:fs").readdirSync(base).filter((d: string) => d.startsWith("chromium-")).sort().reverse();
      for (const d of dirs) {
        for (const rel of ["chrome-linux/chrome", "chrome-mac/Chromium.app/Contents/MacOS/Chromium", "chrome-win/chrome.exe"]) {
          const p = join(base, d, rel);
          if (existsSync(p)) return (found = p);
        }
      }
    } catch {}
  }
  return (found = null);
}

export const VIEWPORT_HEIGHT = (w: number) => (w <= 480 ? 844 : w <= 900 ? 1180 : 900);

export interface Shot {
  /** base64 PNG */
  image: string;
  width: number;
  height: number;
  /** console messages and page errors, in order */
  console: string[];
  /** where the PNG is kept, under ~/.orbit/shots */
  file: string;
}

function parseConsole(stderr: string): string[] {
  const out: string[] = [];
  for (const line of stderr.split("\n")) {
    // older Chrome: [...:ERROR:CONSOLE(12)] "msg", source: http://... (12)
    // newer Chrome: [...:INFO:CONSOLE:12] "msg", source: http://... (12), every level as INFO
    const m = line.match(/:(INFO|WARNING|ERROR|VERBOSE\d*):CONSOLE(?:\(\d+\)|:\d+)\] "(.*)", source: (.*?) \((\d+)\)\s*$/);
    if (m) {
      const level = m[1] === "ERROR" || /^Uncaught /.test(m[2]) ? "error" : m[1] === "WARNING" ? "warning" : "log";
      const src = m[3].replace(/^https?:\/\/[^/]+/, "") || "/";
      out.push(`${level}: ${m[2]} (${src}:${m[4]})`);
    }
  }
  return out.slice(0, 60);
}

/** Load a page in headless Chrome at a width and capture what it shows. */
export const isLocalUrl = (u: string) => /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/.test(u);

export async function screenshot(url: string, width = 1280, opts: { height?: number; full?: boolean; timeoutMs?: number; remote?: boolean } = {}): Promise<Shot> {
  const chrome = findChrome();
  if (!chrome) throw new Error("No Chrome, Chromium, Edge or Brave found. Install one, or set ORBIT_CHROME to a browser's path.");
  if (!/^https?:\/\//.test(url)) throw new Error("A screenshot needs an http or https address.");
  if (!opts.remote && !isLocalUrl(url)) throw new Error("Screenshots of other sites need to be asked for explicitly.");
  const w = Math.max(240, Math.min(3840, Math.round(width)));
  const h = opts.full ? 4000 : Math.max(240, Math.min(4000, Math.round(opts.height ?? VIEWPORT_HEIGHT(w))));
  const dir = join(tmpdir(), `orbit-shot-${crypto.randomUUID().slice(0, 8)}`);
  mkdirSync(dir, { recursive: true });
  const out = join(dir, "shot.png");
  const args = [
    chrome,
    "--headless=new",
    "--disable-gpu",
    "--hide-scrollbars",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    "--mute-audio",
    `--user-data-dir=${join(dir, "profile")}`,
    `--window-size=${w},${h}`,
    "--force-device-scale-factor=1",
    "--virtual-time-budget=4000",
    "--enable-logging=stderr",
    "--v=0",
    `--screenshot=${out}`,
    url,
  ];
  if (process.getuid?.() === 0) args.splice(1, 0, "--no-sandbox"); // Chrome refuses to run as root otherwise
  const run = async (argv: string[], ms: number) => {
    const proc = Bun.spawn(argv, { stdout: "ignore", stderr: "pipe", stdin: "ignore" });
    const timer = setTimeout(() => proc.kill(), ms);
    const err = await new Response(proc.stderr).text();
    await proc.exited;
    clearTimeout(timer);
    return err;
  };
  // the time budget lets timers and fetches settle; a page that never goes quiet (a long-lived
  // request) would hold it forever, so after a while take the shot as soon as the page loads
  let stderr = await run(args, opts.timeoutMs ?? 12_000);
  if (!existsSync(out)) stderr = await run(args.filter((a) => !a.startsWith("--virtual-time-budget")), 20_000);
  try {
    if (!existsSync(out)) throw new Error(`The browser didn't produce a screenshot.${stderr.trim() ? ` ${stderr.trim().split("\n").slice(-1)[0].slice(0, 200)}` : ""}`);
    const png = readFileSync(out);
    const shots = join(ORBIT_DIR, "shots");
    mkdirSync(shots, { recursive: true });
    const name = `${Date.now()}-${w}.png`;
    writeFileSync(join(shots, name), png);
    return { image: png.toString("base64"), width: w, height: h, console: parseConsole(stderr), file: name };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export const shotPath = (name: string) => (/^[\w.-]+\.png$/.test(name) ? join(ORBIT_DIR, "shots", name) : null);
export { parseConsole as _parseConsole };
