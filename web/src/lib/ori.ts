import type { OriPose } from "../components/ori/Ori";
import type { Detail, Workspace } from "./types";
import { useStore } from "./store";

/** Which pose goes with a tool, and what to call it. */
export function poseForTool(name: string): { pose: OriPose; doing: string } {
  if (name === "bash") return { pose: "working", doing: "Running a command" };
  if (/^(read_file|list_dir|glob|grep|load_skill)$/.test(name)) return { pose: "reading", doing: "Reading files" };
  if (name === "fetch_url" || name === "web_search") return { pose: "searching", doing: "Looking on the web" };
  if (/^(write_file|edit_file|doc_write|doc_edit|doc_comment)$/.test(name)) return { pose: "writing", doing: "Writing" };
  if (name === "doc_read") return { pose: "reading", doing: "Reading a doc" };
  if (name === "plan") return { pose: "planning", doing: "Planning" };
  if (name.startsWith("whiteboard")) return { pose: "drawing", doing: "On the board" };
  if (name === "screenshot" || name === "preview_open") return { pose: "camera", doing: "Looking at the page" };
  if (name === "delegate") return { pose: "helpers", doing: "Helpers are working" };
  return { pose: "working", doing: "Working" };
}

/** What Ori shows for a workspace right now. */
export function useOriStatus(ws: Workspace, detail?: Detail): { pose: OriPose; doing: string } {
  const stream = useStore((s) => s.streams[ws.id]);
  const ended = useStore((s) => s.ended[ws.id]);
  const pending = ws.pending > 0 || (ws.helpers ?? []).some((h) => (h.pending ?? 0) > 0);
  if (pending) return { pose: "needs", doing: "Waiting for you" };
  if (ws.running) {
    const blocks = stream?.blocks ?? [];
    const last: any = blocks[blocks.length - 1];
    const runningCall = Object.values(detail?.calls ?? {}).find((c) => c.status === "running");
    if (runningCall) return poseForTool(runningCall.name);
    if (last?.type === "tool_use" || last?.type === "server_tool_use") return poseForTool(last.name ?? "");
    if (last?.type === "thinking") return { pose: "thinking", doing: "Thinking" };
    if (last?.type === "text") return { pose: "working", doing: "Writing the answer" };
    return { pose: "thinking", doing: "Thinking" };
  }
  if ((ws.helpers ?? []).some((h) => h.running)) return { pose: "helpers", doing: "Helpers are working" };
  if (ended && Date.now() - ended.at < 25_000) {
    if (ended.reason === "done") return { pose: "done", doing: "Done" };
    if (ended.reason !== "stopped") return { pose: "oops", doing: "Something stopped the run" };
  }
  if (Date.now() - ws.updated_at > 30 * 60_000) return { pose: "sleeping", doing: "Resting" };
  return { pose: "idle", doing: "Ready" };
}
