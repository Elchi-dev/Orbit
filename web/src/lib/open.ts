import { api } from "./api";
import { useStore } from "./store";

/** Open a file (at a line) or the workspace folder in the user's editor. */
export async function openInEditor(workspaceId: string, path = ".", line?: number, find?: string) {
  try {
    const r = await api.post<{ ok: boolean; link?: string; app?: string }>("/api/open", { workspaceId, path, line, find });
    if (r.link) window.location.href = r.link;
    useStore.getState().toast({ title: `Opened in ${r.app ?? "your editor"}`, tone: "good" });
  } catch (e) {
    useStore.getState().toast({ title: "Couldn't open it", body: (e as Error).message, tone: "warn" });
  }
}
