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
  /** which settings section opens next */
  settingsTab: string | null;
  openSettings: (tab?: string) => void;
  connected: boolean;
  send: (msg: object) => void;

  /** text waiting to be put into a workspace's composer (from a deep link or the editor) */
  drafts: Record<string, string>;
  missions: Record<string, import("../components/cockpit/Missions").Mission[]>;
  /** what each workspace's preview shows, and whether the pane is open */
  previews: Record<string, { url: string; target: string; kind: "files" | "server"; nonce: number } | null>;
  previewOpen: Record<string, boolean>;
  /** how and when each workspace's last run ended, for Ori */
  ended: Record<string, { reason: string; at: number }>;
  /** messages waiting for the next step of a running workspace */
  queued: Record<string, number>;
  /** the side panel: which tab, which doc, and what Claude changed that you haven't looked at */
  panelTab: Record<string, import("./types").PanelTab>;
  docs: Record<string, import("./types").Doc[]>;
  docById: Record<string, import("./types").Doc>;
  docSel: Record<string, string | null>;
  boards: Record<string, import("./types").Board>;
  fresh: Record<string, Record<string, boolean | undefined>>;
  plugins: import("./types").PluginInfo[];
  /** memories suggested and waiting for a yes or no */
  memorySuggested: number;
  loadPlugins: () => Promise<void>;
  openPanel: (wsId: string, tab: import("./types").PanelTab | null) => void;
  selectDoc: (wsId: string, id: string | null) => void;
  loadDocs: (wsId: string) => Promise<void>;
  loadBoard: (wsId: string) => Promise<void>;
  setPreviewOpen: (wsId: string, open: boolean) => void;
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
/** workspaces where you're editing something in the side panel, so Claude's changes don't switch tabs under you */
export const panelLocks = new Set<string>();

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
  settingsTab: null,
  connected: false,
  send: () => {},
  drafts: {},
  missions: {},
  previews: {},
  previewOpen: {},
  queued: {},
  ended: {},
  panelTab: {},
  docs: {},
  docById: {},
  docSel: {},
  boards: {},
  fresh: {},
  plugins: [],
  memorySuggested: 0,
  loadPlugins: async () => {
    const r = await api.get<{ plugins: import("./types").PluginInfo[] }>("/api/plugins").catch(() => null);
    if (r) set({ plugins: r.plugins });
  },
  openPanel: (wsId, tab) => {
    if (!tab) return set({ previewOpen: { ...get().previewOpen, [wsId]: false } });
    set({
      previewOpen: { ...get().previewOpen, [wsId]: true },
      panelTab: { ...get().panelTab, [wsId]: tab },
      fresh: { ...get().fresh, [wsId]: { ...get().fresh[wsId], [tab]: false } },
    });
  },
  selectDoc: (wsId, id) => set({ docSel: { ...get().docSel, [wsId]: id } }),
  loadDocs: async (wsId) => {
    const list = await api.get<import("./types").Doc[]>(`/api/workspaces/${wsId}/docs`);
    set({ docs: { ...get().docs, [wsId]: list } });
  },
  loadBoard: async (wsId) => {
    const b = await api.get<import("./types").Board>(`/api/workspaces/${wsId}/board`);
    set({ boards: { ...get().boards, [wsId]: b } });
  },
  setPreviewOpen: (wsId, open) => set({ previewOpen: { ...get().previewOpen, [wsId]: open } }),
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
  openSettings: (tab) => set({ overlay: "settings", settingsTab: tab ?? null }),
  toast: (t) => {
    const id = toastId++;
    set({ toasts: [...get().toasts, { ...t, id }].slice(-4) });
    setTimeout(() => get().dismissToast(id), t.tone === "bad" ? 9000 : 5000);
  },
  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),

  loadServer: async () => {
    const s = await api.get<ServerState>("/api/state");
    set({ server: s, approvals: s.approvals, memorySuggested: (s as any).memorySuggested ?? 0 });
  },
  loadWorkspaces: async () => {
    const list = await api.get<Workspace[]>("/api/workspaces");
    set({ workspaces: Object.fromEntries(list.map((w) => [w.id, w])) });
  },
  loadDetail: async (id) => {
    try {
      const d = await api.get<any>(`/api/workspaces/${id}`);
      if (d.preview) set({ previews: { ...get().previews, [id]: { ...d.preview, nonce: Date.now() } } });
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
    // a helper's state shows in its parent's list as well
    const patchHelper = (id: string, patch: Partial<import("./types").Helper>) => {
      const pid = get().workspaces[id]?.parent_id;
      const p = pid ? get().workspaces[pid] : undefined;
      if (p?.helpers?.some((h) => h.id === id)) patchWs(pid!, { helpers: p.helpers.map((h) => (h.id === id ? { ...h, ...patch } : h)) });
    };
    // Claude put something in the side panel: show it if the panel was never closed here,
    // otherwise mark the tab so it can be found
    const reveal = (id: string, tab: "docs" | "board", then?: () => void) => {
      const st = get();
      const visible = st.previewOpen[id] && st.panelTab[id] === tab;
      // follow Claude to where it's working, unless you closed the panel or are typing in it
      if (visible || (st.previewOpen[id] !== false && !panelLocks.has(id))) {
        if (!visible) st.openPanel(id, tab);
        then?.();
      } else {
        set({ fresh: { ...st.fresh, [id]: { ...st.fresh[id], [tab]: true } } });
        if (st.panelTab[id] !== tab) then?.();
      }
    };
    switch (e.type) {
      case "hello":
        set({ server: e.state, approvals: e.state.approvals, memorySuggested: e.state.memorySuggested ?? 0 });
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
        patchHelper(wsId!, { running: true });
        set({ live: { ...s.live, [wsId!]: {} } });
        break;
      case "turn_end":
        patchWs(wsId!, { running: false });
        patchHelper(wsId!, { running: false });
        set({ streams: { ...get().streams, [wsId!]: undefined }, live: { ...get().live, [wsId!]: {} }, ended: { ...get().ended, [wsId!]: { reason: e.reason ?? "done", at: Date.now() } } });
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
        patchHelper(wsId!, { pending: (s.workspaces[wsId!]?.pending ?? 0) + 1 });
        if (document.hidden) notify("Orbit needs you", `${e.workspaceTitle}: ${e.subject.slice(0, 80)}`);
        break;
      case "approval_resolved":
        set({ approvals: s.approvals.filter((a) => a.id !== e.id) });
        patchWs(wsId!, { pending: Math.max(0, (s.workspaces[wsId!]?.pending ?? 1) - 1) });
        patchHelper(wsId!, { pending: Math.max(0, (s.workspaces[wsId!]?.pending ?? 1) - 1) });
        break;
      case "pins":
      case "file_changed":
        if (s.details[wsId!]) get().loadDetail(wsId!);
        break;
      case "preview": {
        const cur = s.previews[wsId!];
        set({
          previews: { ...s.previews, [wsId!]: e.url ? { url: e.url, target: e.target, kind: e.kind, nonce: Date.now() } : null },
          // a page Claude opens shows up; closing the pane stays your call
          previewOpen: e.url && !cur ? { ...s.previewOpen, [wsId!]: true } : s.previewOpen,
          panelTab: e.url && !cur ? { ...s.panelTab, [wsId!]: "preview" } : s.panelTab,
        });
        break;
      }
      case "helper": {
        const h = e.helper as import("./types").Helper;
        const parent = s.workspaces[wsId!];
        if (parent) {
          const list = [...(parent.helpers ?? []).filter((x) => x.id !== h.id), { ...(parent.helpers ?? []).find((x) => x.id === h.id), ...h }];
          patchWs(wsId!, { helpers: list.sort((a, b) => a.created_at - b.created_at) });
        }
        const child = get().workspaces[h.id];
        if (child) patchWs(h.id, { helper_state: h.state, report: h.report, title: h.title });
        else
          api
            .get<any>(`/api/workspaces/${h.id}`)
            .then((d) => set({ workspaces: { ...get().workspaces, [h.id]: d.workspace } }))
            .catch(() => {});
        break;
      }
      case "doc": {
        const d = e.doc as import("./types").Doc;
        const list = (s.docs[wsId!] ?? []).filter((x) => x.id !== d.id);
        const open = (d.comments ?? []).filter((c) => !c.parent_id && !c.resolved).length;
        set({ docs: { ...s.docs, [wsId!]: [{ ...d, open }, ...list] }, docById: { ...s.docById, [d.id]: d } });
        if (e.by === "agent") reveal(wsId!, "docs", () => set({ docSel: { ...get().docSel, [wsId!]: d.id } }));
        break;
      }
      case "doc_deleted":
        set({ docs: { ...s.docs, [wsId!]: (s.docs[wsId!] ?? []).filter((x) => x.id !== e.id) }, docSel: s.docSel[wsId!] === e.id ? { ...s.docSel, [wsId!]: null } : s.docSel });
        break;
      case "board":
        set({ boards: { ...s.boards, [wsId!]: e.board } });
        if (e.by === "agent") reveal(wsId!, "board");
        break;
      case "queued":
        set({ queued: { ...s.queued, [wsId!]: e.count } });
        break;
      case "plan":
        patchWs(wsId!, { plan: e.plan });
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
      case "remote":
        window.dispatchEvent(new CustomEvent("orbit:remote", { detail: e.status }));
        break;
      case "plugins":
        set({ plugins: e.plugins });
        break;
      case "memories":
        set({ memorySuggested: e.suggested ?? 0 });
        window.dispatchEvent(new Event("orbit:memories"));
        break;
      case "page_check":
        window.dispatchEvent(new CustomEvent("orbit:page_check", { detail: e }));
        break;
      case "plugin_log":
        window.dispatchEvent(new CustomEvent("orbit:plugin_log", { detail: e }));
        break;
      case "libgen":
        window.dispatchEvent(new CustomEvent("orbit:libgen", { detail: e }));
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
