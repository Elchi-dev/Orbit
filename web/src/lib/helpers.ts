import type { Helper, Workspace } from "./types";

export const helpersBusy = (w: Workspace) => (w.helpers ?? []).filter((h) => h.running).length;
export const needsYou = (w: Workspace) => w.pending > 0 || (w.helpers ?? []).some((h) => (h.pending ?? 0) > 0);

/** "working", "working, 3 helpers" or "3 helpers working" */
export function helpersLine(w: Workspace) {
  const n = helpersBusy(w);
  if (!n) return "working";
  const word = n === 1 ? "1 helper" : `${n} helpers`;
  return w.running ? `working, ${word}` : `${word} working`;
}

export const AGENT_LABEL: Record<string, string> = {
  explorer: "Explorer",
  builder: "Builder",
  reviewer: "Reviewer",
  tester: "Tester",
};
export const agentLabel = (a?: string | null) => (a ? (AGENT_LABEL[a] ?? a.replace(/[-_]/g, " ").replace(/^./, (c) => c.toUpperCase())) : "Helper");

export function stateLabel(h: Pick<Helper, "state" | "running" | "pending">) {
  if (h.pending) return "needs you";
  if (h.running || h.state === "running") return "working";
  return { done: "done", failed: "failed", stopped: "stopped", merged: "merged", discarded: "discarded" }[h.state as string] ?? "";
}
