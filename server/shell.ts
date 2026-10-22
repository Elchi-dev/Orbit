// One persistent shell per workspace, so `cd`, exported variables and venvs carry over between commands.
import { quietEnv } from "./catalog";
import type { Subprocess } from "bun";
import { existsSync } from "node:fs";

const IS_WIN = process.platform === "win32";
const MAX_OUTPUT = 60_000;

function pickShell(): string[] {
  if (IS_WIN) return ["powershell.exe", "-NoLogo", "-NoProfile", "-NonInteractive", "-Command", "-"];
  const candidates = [process.env.SHELL, "/bin/bash", "/usr/bin/bash", "/bin/zsh", "/bin/sh"].filter(Boolean) as string[];
  const sh = candidates.find((s) => /bash|zsh|sh$/.test(s) && existsSync(s)) ?? "/bin/sh";
  return [sh];
}

export interface RunResult {
  output: string;
  exitCode: number | null;
  timedOut: boolean;
  killed: boolean;
  durationMs: number;
}

export class Shell {
  private proc: Subprocess<"pipe", "pipe", "pipe"> | null = null;
  private buffer = "";
  private waiter: ((code: number | null) => void) | null = null;
  private token = "";
  private queue: Promise<unknown> = Promise.resolve();
  onData: ((chunk: string) => void) | null = null;

  constructor(public cwd: string) {}

  get pid() {
    return this.proc?.pid ?? null;
  }

  private start() {
    const cmd = pickShell();
    const proc = Bun.spawn(cmd, {
      cwd: existsSync(this.cwd) ? this.cwd : undefined,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, ...quietEnv() },
    });
    this.proc = proc;
    const pump = async (stream: ReadableStream<Uint8Array>) => {
      const dec = new TextDecoder();
      for await (const chunk of stream) this.ingest(dec.decode(chunk, { stream: true }));
    };
    pump(proc.stdout).catch(() => {});
    pump(proc.stderr).catch(() => {});
    proc.exited.then(() => {
      if (this.proc === proc) this.proc = null;
      this.waiter?.(null);
    });
  }

  private ingest(text: string) {
    this.buffer += text;
    const re = new RegExp(`__ORBIT_DONE_${this.token}_(-?\\d+)__`);
    const m = this.token ? this.buffer.match(re) : null;
    const visible = m ? text.replace(re, "") : text;
    if (visible.trim() || visible.includes("\n")) this.onData?.(visible.replace(/__ORBIT_DONE_\w+_-?\d+__\n?/g, ""));
    if (m && this.waiter) {
      const w = this.waiter;
      this.waiter = null;
      w(Number(m[1]));
    }
  }

  run(command: string, timeoutS: number): Promise<RunResult> {
    const job = this.queue.then(() => this.exec(command, timeoutS));
    this.queue = job.catch(() => {});
    return job;
  }

  private async exec(command: string, timeoutS: number): Promise<RunResult> {
    if (!this.proc) this.start();
    const proc = this.proc!;
    this.buffer = "";
    this.token = Math.random().toString(36).slice(2, 10);
    const started = performance.now();
    const script = IS_WIN
      ? `${command}\nWrite-Output "__ORBIT_DONE_${this.token}_$(if ($LASTEXITCODE -ne $null) { $LASTEXITCODE } else { 0 })__"\n`
      : `{\n${command}\n} < /dev/null 2>&1\n__orbit_ec=$?\nprintf '\\n__ORBIT_DONE_${this.token}_%s__\\n' "$__orbit_ec"\n`;
    let timedOut = false;
    let killed = false;
    const code = await new Promise<number | null>((resolve) => {
      this.waiter = resolve;
      const t = setTimeout(() => {
        timedOut = true;
        this.kill();
      }, timeoutS * 1000);
      proc.exited.then(() => clearTimeout(t));
      const orig = resolve;
      this.waiter = (c) => {
        clearTimeout(t);
        if (c === null) killed = true;
        orig(c);
      };
      proc.stdin.write(script);
      proc.stdin.flush();
    });
    let output = this.buffer.replace(new RegExp(`\\n?__ORBIT_DONE_${this.token}_-?\\d+__\\n?`), "").replace(/\r/g, "");
    if (output.length > MAX_OUTPUT) {
      output = output.slice(0, MAX_OUTPUT / 2) + `\n\n… ${output.length - MAX_OUTPUT} characters cut …\n\n` + output.slice(-MAX_OUTPUT / 2);
    }
    this.token = "";
    return { output, exitCode: code, timedOut, killed: killed && !timedOut, durationMs: Math.round(performance.now() - started) };
  }

  /** Kill switch: stops the shell and everything it started. The next command gets a fresh shell. */
  kill() {
    const p = this.proc;
    if (!p) return;
    this.proc = null;
    try {
      if (IS_WIN) Bun.spawnSync(["taskkill", "/PID", String(p.pid), "/T", "/F"]);
      else Bun.spawnSync(["pkill", "-KILL", "-P", String(p.pid)]);
    } catch {}
    try {
      p.kill(9);
    } catch {}
  }
}

const shells = new Map<string, Shell>();
export function shellFor(wsId: string, cwd: string) {
  let s = shells.get(wsId);
  if (!s) {
    s = new Shell(cwd);
    shells.set(wsId, s);
  }
  return s;
}
export function killShell(wsId: string) {
  shells.get(wsId)?.kill();
}
export function dropShell(wsId: string) {
  shells.get(wsId)?.kill();
  shells.delete(wsId);
}
