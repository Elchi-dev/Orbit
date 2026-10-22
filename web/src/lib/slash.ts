import { api } from "./api";
import { openInEditor } from "./open";
import { useStore } from "./store";
import type { Workspace } from "./types";

export interface SlashItem {
  name: string;
  hint: string;
  /** shown after the name while typing, like "low | medium | high" */
  args?: string;
  /** "action" runs at once; "prompt" puts text into the composer for you to send */
  kind: "action" | "prompt" | "skill";
  body?: string;
}

export interface SlashCtx {
  ws: Workspace;
  setText: (t: string) => void;
  setWeb: (on: boolean) => void;
  web: boolean;
  setEffort: (e: string) => void;
}

const EFFORTS = ["low", "medium", "high", "xhigh", "max"];
const MODES = ["manual", "auto", "rules"];

export const BUILTINS: SlashItem[] = [
  { name: "compact", hint: "Fold older messages into a summary, keep the last 3 requests", kind: "action" },
  { name: "clear", hint: "Start over in this workspace, keeping a summary", kind: "action" },
  { name: "web", hint: "Switch web search on or off", kind: "action" },
  { name: "effort", hint: "How hard Claude thinks on the next message", args: EFFORTS.join(" | "), kind: "action" },
  { name: "mode", hint: "Approval mode for this workspace", args: MODES.join(" | "), kind: "action" },
  { name: "model", hint: "The model for this workspace", args: "name, or default", kind: "action" },
  { name: "pin", hint: "Pin a fact to this workspace's memory", args: "text", kind: "action" },
  { name: "git", hint: "Open the git panel", kind: "action" },
  { name: "shell", hint: "Open the shell panel", kind: "action" },
  { name: "files", hint: "Open the changed files", kind: "action" },
  { name: "open", hint: "Open the folder in your editor", kind: "action" },
  { name: "export", hint: "Download this workspace as Markdown", kind: "action" },
  { name: "settings", hint: "Open Settings", kind: "action" },
];

/** Run a built-in command. Returns a message for a toast when something was off. */
export async function runSlash(name: string, args: string, ctx: SlashCtx): Promise<void> {
  const st = useStore.getState();
  const { ws } = ctx;
  const say = (title: string, tone: "good" | "info" | "warn" = "good", body?: string) => st.toast({ title, tone, body });
  switch (name) {
    case "compact": {
      say("Compacting", "info", "The scribe is writing the summary.");
      try {
        await api.post(`/api/workspaces/${ws.id}/compact`, { keep: Number(args) || 3 });
      } catch (e) {
        say("Nothing compacted", "warn", (e as Error).message);
      }
      return;
    }
    case "clear":
      await api.post(`/api/workspaces/${ws.id}/clear`, { keepSummary: args.trim() !== "all" });
      return;
    case "web": {
      const on = args === "on" ? true : args === "off" ? false : !ctx.web;
      ctx.setWeb(on);
      return say(on ? "Web search on" : "Web search off", "info");
    }
    case "effort":
      if (!EFFORTS.includes(args)) return say("Pick an effort", "warn", EFFORTS.join(", "));
      ctx.setEffort(args);
      return say(`Effort ${args} for the next message`, "info");
    case "mode":
      if (!MODES.includes(args)) return say("Pick a mode", "warn", MODES.join(", "));
      await st.patchWorkspace(ws.id, { mode: args as any });
      return say(`${args[0].toUpperCase()}${args.slice(1)} mode`, "info");
    case "model": {
      const models = Object.keys(st.server?.config.pricing ?? {});
      const pick = args === "default" ? null : models.find((m) => m === args || m.includes(args));
      if (args !== "default" && !pick) return say("No such model", "warn", models.join(", "));
      await st.patchWorkspace(ws.id, { model: pick } as any);
      return say(pick ? `Using ${pick} here` : "Using the default model here", "info");
    }
    case "pin":
      if (!args.trim()) return say("Write what to pin after /pin", "warn");
      await api.post(`/api/workspaces/${ws.id}/pins`, { text: args.trim() });
      return say("Pinned", "good");
    case "git":
    case "shell":
    case "files":
      if (st.drawer !== name) st.setDrawer(name);
      return;
    case "open":
      return openInEditor(ws.id);
    case "export":
      window.location.href = `/api/workspaces/${ws.id}/export`;
      return;
    case "settings":
      return st.setOverlay("settings");
  }
}

/** Fill a saved prompt: $ARGUMENTS takes the rest of the line, or the arguments go at the end. */
export function expand(body: string, args: string) {
  if (body.includes("$ARGUMENTS")) return body.replaceAll("$ARGUMENTS", args);
  return args ? `${body}\n\n${args}` : body;
}
