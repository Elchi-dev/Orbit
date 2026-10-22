// The whiteboard: one canvas per workspace where Claude lays things out for the user
// (notes, text, checklists, screenshots, images, links, files, frames that group them,
// arrows between them) and the user moves, edits and adds to it. Both sides see the
// other's changes; Claude reads back what the user did since it last looked.

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { extname, join, resolve, sep } from "node:path";
import { ORBIT_DIR } from "./config";
import { db, getWorkspace, now } from "./db";
import { broadcast } from "./hub";

db.exec(`
CREATE TABLE IF NOT EXISTS boards (
  workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  items TEXT NOT NULL DEFAULT '[]',
  edges TEXT NOT NULL DEFAULT '[]',
  version INTEGER NOT NULL DEFAULT 0,
  agent_seen INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
`);

export const KINDS = ["note", "text", "checklist", "image", "link", "file", "frame"] as const;
export type Kind = (typeof KINDS)[number];
export const COLORS = ["yellow", "peach", "lavender", "mint", "sky", "rose", "gray"] as const;

export interface Item {
  id: string;
  kind: Kind;
  x: number;
  y: number;
  w: number;
  h: number;
  title?: string;
  text?: string;
  color?: string;
  /** image source: shot:<name>, asset:<name> or file:<path in the workspace> */
  src?: string;
  url?: string;
  path?: string;
  items?: { text: string; done: boolean }[];
  by: "agent" | "user";
  updated_at: number;
}
export interface Edge {
  id: string;
  from: string;
  to: string;
  label?: string;
  by: "agent" | "user";
}
export interface Board {
  items: Item[];
  edges: Edge[];
  version: number;
  agent_seen: number;
}

const SIZE: Record<Kind, [number, number]> = {
  note: [220, 160],
  text: [320, 120],
  checklist: [260, 200],
  image: [360, 240],
  link: [280, 96],
  file: [260, 72],
  frame: [760, 520],
};
const MAX_ITEMS = 400;
const GAP = 32;

export function getBoard(wsId: string): Board {
  const r = db.query<{ items: string; edges: string; version: number; agent_seen: number }, [string]>("SELECT items, edges, version, agent_seen FROM boards WHERE workspace_id = ?").get(wsId);
  if (!r) return { items: [], edges: [], version: 0, agent_seen: 0 };
  return { items: JSON.parse(r.items), edges: JSON.parse(r.edges), version: r.version, agent_seen: r.agent_seen };
}

function save(wsId: string, b: Board, by: "agent" | "user") {
  const version = b.version + 1;
  db.run(
    `INSERT INTO boards (workspace_id, items, edges, version, agent_seen, updated_at) VALUES (?,?,?,?,?,?)
     ON CONFLICT(workspace_id) DO UPDATE SET items = excluded.items, edges = excluded.edges, version = excluded.version, agent_seen = excluded.agent_seen, updated_at = excluded.updated_at`,
    [wsId, JSON.stringify(b.items), JSON.stringify(b.edges), version, by === "agent" ? version : b.agent_seen, now()],
  );
  const fresh = getBoard(wsId);
  broadcast("board", { workspaceId: wsId, board: fresh, by });
  return fresh;
}

const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : d);
const short = () => crypto.randomUUID().replace(/-/g, "").slice(0, 8);

/** The next free spot: inside a frame if one is given, else to the right of everything, wrapping into rows. */
function place(items: Item[], w: number, h: number, frame?: Item): { x: number; y: number } {
  const area = frame ? { x: frame.x + 24, y: frame.y + 56, w: frame.w - 48 } : { x: 0, y: 0, w: 1600 };
  const inside = items.filter((i) => i.kind !== "frame" && (!frame || within(i, frame)));
  const taken = frame ? inside : items;
  // try positions row by row until one doesn't overlap
  for (let y = area.y; y < area.y + 20_000; y += 40) {
    for (let x = area.x; x + w <= area.x + Math.max(area.w, w); x += 40) {
      const box = { x, y, w, h };
      if (!taken.some((t) => overlaps(box, t))) return { x, y };
    }
  }
  return { x: area.x, y: area.y + 20_000 };
}
const overlaps = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) =>
  a.x < b.x + b.w + GAP && a.x + a.w + GAP > b.x && a.y < b.y + b.h + GAP && a.y + a.h + GAP > b.y;
const within = (i: Item, f: Item) => i.x >= f.x && i.y >= f.y && i.x + i.w <= f.x + f.w && i.y + i.h <= f.y + f.h;

function cleanSrc(wsId: string, src: unknown): string | undefined {
  const s = String(src ?? "").trim();
  if (!s) return undefined;
  if (/^shot:[\w.-]+\.png$/.test(s) || /^asset:[\w.-]+$/.test(s)) return s;
  // a bare screenshot name, as the screenshot tool prints it
  if (/^[\w.-]+-\d+\.png$/.test(s)) return `shot:${s}`;
  const path = s.replace(/^file:/, "");
  const ws = getWorkspace(wsId);
  if (!ws) return undefined;
  const full = resolve(ws.cwd, path);
  if (full !== resolve(ws.cwd) && !full.startsWith(resolve(ws.cwd) + sep)) throw new Error(`${path} is outside the workspace folder`);
  if (!existsSync(full)) throw new Error(`${path} doesn't exist`);
  return `file:${full.slice(resolve(ws.cwd).length + 1)}`;
}

function fields(wsId: string, o: any, base?: Partial<Item>) {
  const out: Partial<Item> = {};
  if (o.title != null) out.title = String(o.title).slice(0, 200);
  if (o.text != null) out.text = String(o.text).slice(0, 20_000);
  if (o.color != null) out.color = (COLORS as readonly string[]).includes(o.color) ? o.color : base?.color;
  if (o.url != null) {
    const u = String(o.url);
    if (!/^https?:\/\//.test(u)) throw new Error("A link needs an http or https address");
    out.url = u.slice(0, 2000);
  }
  if (o.path != null) out.path = String(o.path).slice(0, 1000);
  if (o.src != null) out.src = cleanSrc(wsId, o.src);
  if (Array.isArray(o.items)) out.items = o.items.slice(0, 100).map((i: any) => (typeof i === "string" ? { text: i.slice(0, 500), done: false } : { text: String(i?.text ?? "").slice(0, 500), done: !!i?.done }));
  if (o.w != null) out.w = Math.max(80, Math.min(4000, num(o.w, 200)));
  if (o.h != null) out.h = Math.max(40, Math.min(4000, num(o.h, 120)));
  return out;
}

export type Op =
  | { op: "add"; kind: Kind; ref?: string; frame?: string; x?: number; y?: number; [k: string]: unknown }
  | { op: "update"; id: string; [k: string]: unknown }
  | { op: "move"; id: string; x: number; y: number }
  | { op: "remove"; id: string }
  | { op: "connect"; from: string; to: string; label?: string }
  | { op: "disconnect"; from: string; to: string }
  | { op: "clear" };

/** Apply a batch of changes. Later ops may refer to items added earlier in the same batch by their ref. */
export function apply(wsId: string, ops: Op[], by: "agent" | "user", baseVersion?: number) {
  const b = getBoard(wsId);
  if (baseVersion != null && baseVersion !== b.version) throw new Error("stale");
  const refs = new Map<string, string>();
  const id = (r: unknown) => {
    const s = String(r ?? "");
    return refs.get(s) ?? s;
  };
  const find = (r: unknown) => {
    const it = b.items.find((i) => i.id === id(r));
    if (!it) throw new Error(`No item ${r} on the board`);
    return it;
  };
  const added: Record<string, string> = {};
  for (const o of ops.slice(0, 200) as any[]) {
    switch (o?.op) {
      case "add": {
        if (b.items.length >= MAX_ITEMS) throw new Error(`The board holds at most ${MAX_ITEMS} items`);
        const kind: Kind = (KINDS as readonly string[]).includes(o.kind) ? o.kind : "note";
        const f = fields(wsId, o);
        const [dw, dh] = SIZE[kind];
        const w = f.w ?? dw;
        const h = f.h ?? (kind === "text" && f.text ? Math.min(600, 48 + Math.ceil(f.text.length / 42) * 22) : kind === "checklist" && f.items ? 64 + f.items.length * 30 : dh);
        const frame = o.frame != null ? find(o.frame) : undefined;
        const pos = o.x != null && o.y != null ? { x: num(o.x, 0), y: num(o.y, 0) } : place(b.items, w, h, frame);
        const item: Item = { id: short(), kind, ...pos, ...f, w, h, color: f.color ?? (kind === "note" ? "yellow" : undefined), by, updated_at: now() };
        if (kind === "frame") b.items.unshift(item); // frames sit behind what's in them
        else b.items.push(item);
        if (o.ref) refs.set(String(o.ref), item.id);
        added[o.ref ?? item.id] = item.id;
        break;
      }
      case "update": {
        const it = find(o.id);
        Object.assign(it, fields(wsId, o, it), { by, updated_at: now() });
        if (o.x != null) it.x = num(o.x, it.x);
        if (o.y != null) it.y = num(o.y, it.y);
        break;
      }
      case "move": {
        const it = find(o.id);
        const dx = num(o.x, it.x) - it.x;
        const dy = num(o.y, it.y) - it.y;
        // moving a frame carries what's in it
        if (it.kind === "frame") for (const c of b.items) if (c !== it && within(c, it)) (c.x += dx), (c.y += dy);
        it.x += dx;
        it.y += dy;
        it.by = by;
        it.updated_at = now();
        break;
      }
      case "remove": {
        const it = find(o.id);
        b.items = b.items.filter((i) => i !== it);
        b.edges = b.edges.filter((e) => e.from !== it.id && e.to !== it.id);
        break;
      }
      case "connect": {
        const from = find(o.from).id;
        const to = find(o.to).id;
        if (!b.edges.some((e) => e.from === from && e.to === to)) b.edges.push({ id: short(), from, to, label: o.label ? String(o.label).slice(0, 120) : undefined, by });
        break;
      }
      case "disconnect": {
        const from = id(o.from);
        const to = id(o.to);
        b.edges = b.edges.filter((e) => !(e.from === from && e.to === to) && !(e.from === to && e.to === from));
        break;
      }
      case "clear":
        b.items = [];
        b.edges = [];
        break;
      default:
        throw new Error(`Unknown op ${o?.op}. Use add, update, move, remove, connect, disconnect or clear.`);
    }
  }
  return { board: save(wsId, b, by), added };
}

/** The board as Claude reads it: every item in a line, and what the user did since its last look. */
export function readForAgent(wsId: string): string {
  const b = getBoard(wsId);
  if (!b.items.length) return "The whiteboard is empty.";
  const fresh = (i: Item) => i.by === "user";
  const line = (i: Item) => {
    const what = i.kind === "checklist" ? (i.items ?? []).map((c) => `${c.done ? "[x]" : "[ ]"} ${c.text}`).join("; ") : i.kind === "image" ? i.src : i.kind === "link" ? i.url : i.kind === "file" ? i.path : (i.text ?? "");
    return `- ${i.id} ${i.kind}${i.title ? ` "${i.title}"` : ""} at ${i.x},${i.y} ${i.w}x${i.h}${i.color ? ` ${i.color}` : ""}${fresh(i) ? " (user)" : ""}: ${String(what ?? "").replace(/\n/g, " / ").slice(0, 300)}`;
  };
  const parts = [`Whiteboard, version ${b.version}, ${b.items.length} items:`, ...b.items.map(line)];
  if (b.edges.length) parts.push("Arrows:", ...b.edges.map((e) => `- ${e.from} -> ${e.to}${e.label ? ` "${e.label}"` : ""}`));
  if (b.version > b.agent_seen) parts.push(`The user changed the board since you last looked (items marked "(user)" were added, edited or moved by them).`);
  db.run("UPDATE boards SET agent_seen = version WHERE workspace_id = ?", [wsId]);
  return parts.join("\n");
}

// ---------- uploaded images ----------
const ASSETS = join(ORBIT_DIR, "assets");
const IMAGE_EXT: Record<string, string> = { "image/png": ".png", "image/jpeg": ".jpg", "image/gif": ".gif", "image/webp": ".webp", "image/svg+xml": ".svg", "image/avif": ".avif" };

export function saveAsset(data: Uint8Array, type: string): string {
  const ext = IMAGE_EXT[type];
  if (!ext) throw new Error("Only images can go on the board");
  if (data.byteLength > 15_000_000) throw new Error("That image is over 15 MB");
  mkdirSync(ASSETS, { recursive: true });
  const name = `${Date.now()}-${short()}${ext}`;
  writeFileSync(join(ASSETS, name), data);
  return name;
}
export const assetPath = (name: string) => (/^[\w-]+\.(png|jpg|gif|webp|svg|avif)$/.test(name) ? join(ASSETS, name) : null);
export const isImagePath = (p: string) => /^\.(png|jpe?g|gif|webp|svg|avif)$/i.test(extname(p));
