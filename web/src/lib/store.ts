import { create } from "zustand";
import { api } from "./api";
import type { Approval, Detail, Message, ServerState, StreamBlock, ToolCall, UsageEvent, Workspace } from "./types";

export type View = { kind: "orrery" } | { kind: "ws"; id: string };
export type Drawer = null | "shell" | "files" | "git" | "missions" | "memory" | "workspace";
export interface Toast {
  id: number;
  title: string;
  body?: string;
  tone: "info" | "good" | "warn" | "bad";
  workspaceId?: string;
}

interface Store {
  server: ServerState | null;
  workspaces: Record<string, Workspace>;
  details: Record<string, Detail>;
  streams: Record<string, { id: string; blocks: StreamBlock[] } | undefined>;
  live: Record<string, { tps?: number }>;
  lastUsage: Record<string, UsageEvent>;
  shellOut: Record<string, string>;
  approvals: Approval[];
  toasts: Toast[];
  view: View;
  drawer: Drawer;
  overlay: null | "settings" | "palette";
  connected: boolean;
  send: (msg: object) => void;

  /** text waiting to be put into a workspace's composer (from a deep link or the editor) */
  drafts: Record<string, string>;
  missions: Record<string, import("../components/cockpit/Missions").Mission[]>;
  setIncoming: (wsId: string, text: string | null) => void;
  setView: (v: View) => void;
  setDrawer: (d: Drawer) => void;
  setOverlay: (o: Store["overlay"]) => void;
  toast: (t: Omit<Toast, "id">) => void;
  dismissToast: (id: number) => void;
  loadServer: () => Promise<void>;
  loadWorkspaces: () => Promise<void>;
  loadDetail: (id: string) => Promise<void>;
  createWorkspace: (opts?: { title?: string; cwd?: string; incognito?: boolean; mode?: string; profile?: string }) => Promise<Workspace>;
  patchWorkspace: (id: string, patch: Partial<Workspace>) => Promise<void>;
  handle: (e: any) => void;
}

let toastId = 1;

export const useStore = create<Store>((set, get) => ({
  server: null,
  workspaces: {},
  details: {},
  streams: {},
  live: {},
  lastUsage: {},
  shellOut: {},
  approvals: [],
  toasts: [],
  view: { kind: "orrery" },
  drawer: null,
  overlay: null,
  connected: false,
  send: () => {},
  drafts: {},
  missions: {},
  setIncoming: (wsId, text) => {
    const drafts = { ...get().drafts };
    if (text) drafts[wsId] = text;
    else delete drafts[wsId];
    set({ drafts });
  },

  setView: (v) => {
    set({ view: v, drawer: null });
    const hash = v.kind === "ws" ? `#/w/${v.id}` : "#/";
    if (location.hash !== hash) history.pushState(null, "", hash);
    if (v.kind === "ws") get().loadDetail(v.id);
  },
  setDrawer: (d) => set({ drawer: get().drawer === d ? null : d }),
  setOverlay: (o) => set({ overlay: o }),
  toast: (t) => {
    const id = toastId++;
    set({ toasts: [...get().toasts, { ...t, id }].slice(-4) });
    setTimeout(() => get().dismissToast(id), t.tone === "bad" ? 9000 : 5000);
  },
  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),

  loadServer: async () => {
    const s = await api.get<ServerState>("/api/state");
    set({ server: s, approvals: s.approvals });
  },
  loadWorkspaces: async () => {
    const list = await api.get<Workspace[]>("/api/workspaces");
    set({ workspaces: Object.fromEntries(list.map((w) => [w.id, w])) });
  },
  loadDetail: async (id) => {
    try {
      const d = await api.get<any>(`/api/workspaces/${id}`);
      set({
        workspaces: { ...get().workspaces, [id]: d.workspace },
        details: {
          ...get().details,
          [id]: {
            messages: d.messages,
            calls: Object.fromEntries((d.calls as ToolCall[]).map((c) => [c.id, c])),
            pins: d.pins,
            snapshots: d.snapshots,
            last: d.last,
            judge: d.judge,
          },
        },
      });
    } catch {
      get().setView({ kind: "orrery" });
    }
  },
  createWorkspace: async (opts = {}) => {
    const w = await api.post<Workspace>("/api/workspaces", opts);
    set({ workspaces: { ...get().workspaces, [w.id]: w } });
    return w;
  },
  patchWorkspace: async (id, patch) => {
    const w = await api.patch<Workspace>(`/api/workspaces/${id}`, patch);
    set({ workspaces: { ...get().workspaces, [id]: w } });
  },

  handle: (e) => {
    const s = get();
    const wsId: string | undefined = e.workspaceId;
    const patchDetail = (id: string, fn: (d: Detail) => Detail) => {
      const d = get().details[id];
      if (d) set({ details: { ...get().details, [id]: fn(d) } });
    };
    const patchWs = (id: string, patch: Partial<Workspace>) => {
      const w = get().workspaces[id];
      if (w) set({ workspaces: { ...get().workspaces, [id]: { ...w, ...patch } } });
    };
    switch (e.type) {
      case "hello":
        set({ server: e.state, approvals: e.state.approvals });
        break;
      case "state":
        set({ server: { ...(s.server as ServerState), ...e } });
        break;
      case "workspace":
        set({ workspaces: { ...s.workspaces, [e.workspace.id]: { ...s.workspaces[e.workspace.id], ...e.workspace } } });
        break;
      case "workspace_deleted": {
        const { [e.workspaceId]: _, ...rest } = s.workspaces;
        set({ workspaces: rest });
        if (s.view.kind === "ws" && s.view.id === e.workspaceId) get().setView({ kind: "orrery" });
        break;
      }
      case "turn_start":
        patchWs(wsId!, { running: true });
        set({ live: { ...s.live, [wsId!]: {} } });
        break;
      case "turn_end":
        patchWs(wsId!, { running: false });
        set({ streams: { ...get().streams, [wsId!]: undefined }, live: { ...get().live, [wsId!]: {} } });
        get().loadServer();
        if (e.reason === "done" && document.hidden) notify("Orbit", `${get().workspaces[wsId!]?.title ?? "A workspace"} finished`);
        break;
      case "block_start": {
        const cur = s.streams[wsId!];
        const blocks = cur && cur.id === e.streamId ? [...cur.blocks] : [];
        blocks[e.index] = { type: e.block.type, text: "", name: e.block.name, id: e.block.id };
        set({ streams: { ...s.streams, [wsId!]: { id: e.streamId, blocks } } });
        break;
      }
      case "delta": {
        const cur = s.streams[wsId!];
        if (!cur) break;
        const blocks = [...cur.blocks];
        const b = blocks[e.index] ?? { type: e.kind === "thinking" ? "thinking" : "text", text: "" };
        blocks[e.index] = { ...b, text: b.text + e.text };
        set({ streams: { ...s.streams, [wsId!]: { ...cur, blocks } } });
        break;
      }
      case "speed":
        set({ live: { ...s.live, [wsId!]: { tps: e.tps } } });
        break;
      case "message":
        patchDetail(wsId!, (d) => (d.messages.some((m) => m.id === e.message.id) ? d : { ...d, messages: [...d.messages, e.message as Message] }));
        if (e.streamId) set({ streams: { ...get().streams, [wsId!]: undefined } });
        patchWs(wsId!, { messageCount: (get().workspaces[wsId!]?.messageCount ?? 0) + 1, updated_at: Date.now() });
        break;
      case "usage":
        set({ lastUsage: { ...s.lastUsage, [wsId!]: e } });
        patchWs(wsId!, { stats: e.stats });
        if (s.server) set({ server: { ...s.server, today: e.today, rate: e.rate ?? s.server.rate } });
        break;
      case "tool_call":
        patchDetail(wsId!, (d) => ({ ...d, calls: { ...d.calls, [e.call.id]: e.call } }));
        break;
      case "tool_status":
        patchDetail(wsId!, (d) => (d.calls[e.id] ? { ...d, calls: { ...d.calls, [e.id]: { ...d.calls[e.id], status: e.status } } } : d));
        break;
      case "tool_output":
        set({ shellOut: { ...s.shellOut, [e.id]: ((s.shellOut[e.id] ?? "") + e.chunk).slice(-20000) } });
        break;
      case "approval_request":
        set({ approvals: [...s.approvals.filter((a) => a.id !== e.id), e] });
        patchWs(wsId!, { pending: (s.workspaces[wsId!]?.pending ?? 0) + 1 });
        if (document.hidden) notify("Orbit needs you", `${e.workspaceTitle}: ${e.subject.slice(0, 80)}`);
        break;
      case "approval_resolved":
        set({ approvals: s.approvals.filter((a) => a.id !== e.id) });
        patchWs(wsId!, { pending: Math.max(0, (s.workspaces[wsId!]?.pending ?? 1) - 1) });
        break;
      case "pins":
      case "file_changed":
        if (s.details[wsId!]) get().loadDetail(wsId!);
        break;
      case "missions":
        set({ missions: { ...s.missions, [wsId!]: e.missions } });
        break;
      case "compacted":
        get().loadDetail(wsId!);
        get().toast({
          title: e.compacted ? `Folded ${e.compacted} older messages into the summary` : "Nothing older to fold",
          body: e.compacted ? `About ${Math.round(e.before / 1000)}k tokens of history down to ${Math.round(e.after / 1000)}k.` : undefined,
          tone: "good",
          workspaceId: wsId,
        });
        break;
      case "cleared":
        patchDetail(wsId!, (d) => ({ ...d, messages: [], calls: {} }));
        set({ lastUsage: { ...s.lastUsage, [wsId!]: undefined as any } });
        get().loadDetail(wsId!);
        window.dispatchEvent(new CustomEvent("orbit:cleared", { detail: { workspaceId: wsId, freed: e.freed } }));
        break;
      case "notify":
        get().toast({ title: e.title, body: e.body, tone: "info", workspaceId: wsId });
        notify(e.title, e.body);
        break;
      case "error":
        get().toast({ title: e.kind === "budget" ? "Budget reached" : "Something stopped the run", body: e.message, tone: e.kind === "budget" ? "warn" : "bad", workspaceId: wsId });
        break;
      case "rules":
        window.dispatchEvent(new Event("orbit:rules"));
        break;
    }
  },
}));

function notify(title: string, body: string) {
  if (typeof Notification === "undefined") return;
  if (Notification.permission === "granted") new Notification(title, { body });
}

export function connectSocket() {
  let ws: WebSocket | null = null;
  let retry = 0;
  const open = () => {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    ws = new WebSocket(`${proto}://${location.host}/ws`);
    ws.onopen = () => {
      retry = 0;
      useStore.setState({ connected: true, send: (m) => ws?.readyState === 1 && ws.send(JSON.stringify(m)) });
      useStore.getState().loadWorkspaces();
      const v = useStore.getState().view;
      if (v.kind === "ws") useStore.getState().loadDetail(v.id);
    };
    ws.onmessage = (m) => useStore.getState().handle(JSON.parse(m.data));
    ws.onclose = () => {
      useStore.setState({ connected: false });
      setTimeout(open, Math.min(5000, 400 * 2 ** retry++));
    };
  };
  open();
}
