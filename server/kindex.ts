// Knowledge folders: a folder of docs in a workspace (say docs/ or a wiki
// export) indexed on this computer and searched by the knowledge tool, instead
// of pasted into every request. Files are cut into passages at headings and
// ranked with BM25. The index is kept in memory and refreshed per file when
// its modification time changes.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

const EXT = /\.(md|mdx|markdown|txt|rst|adoc|org|html?)$/i;
const SKIP = new Set(["node_modules", ".git", "dist", "build", ".next", "target", "vendor", "__pycache__", ".venv"]);
const MAX_FILES = 3000;
const MAX_FILE = 2_000_000;

interface Chunk {
  file: string;
  heading: string;
  text: string;
  terms: Map<string, number>;
  len: number;
}
interface FileEntry {
  mtime: number;
  chunks: Chunk[];
}
interface Index {
  files: Map<string, FileEntry>;
  /** document frequency per term, over chunks */
  df: Map<string, number>;
  chunks: number;
  totalLen: number;
  built: number;
}

const indexes = new Map<string, Index>();

export const tokenize = (t: string) =>
  t
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 1 && w.length < 40);

function chunksOf(file: string, raw: string): Chunk[] {
  const text = /\.html?$/i.test(file) ? raw.replace(/<(script|style)[\s\S]*?<\/\1>/gi, "").replace(/<[^>]+>/g, " ") : raw;
  const out: Chunk[] = [];
  let heading = "";
  let buf: string[] = [];
  const flush = () => {
    const body = buf.join("\n").trim();
    buf = [];
    if (!body) return;
    // long sections are cut into pieces of about 1,500 characters at paragraph breaks
    const paras = body.split(/\n\s*\n/);
    let piece = "";
    for (const p of paras) {
      if (piece && piece.length + p.length > 1500) {
        out.push(make(file, heading, piece));
        piece = "";
      }
      piece += (piece ? "\n\n" : "") + p;
    }
    if (piece) out.push(make(file, heading, piece));
  };
  for (const line of text.split(/\r?\n/)) {
    const h = line.match(/^(#{1,6})\s+(.+)$/) || line.match(/^(=+|-+)\s*$/);
    if (h && h[2]) {
      flush();
      heading = h[2].trim();
    }
    buf.push(line);
  }
  flush();
  return out;
}
function make(file: string, heading: string, text: string): Chunk {
  const terms = new Map<string, number>();
  const words = tokenize(`${heading} ${heading} ${file.replace(/[/\\._-]/g, " ")} ${text}`);
  for (const w of words) terms.set(w, (terms.get(w) ?? 0) + 1);
  return { file, heading, text, terms, len: words.length };
}

function walk(root: string, dir: string, out: string[]) {
  if (out.length >= MAX_FILES) return;
  let entries: import("node:fs").Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (out.length >= MAX_FILES) return;
    if (e.name.startsWith(".") && e.name !== ".orbit") continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (!SKIP.has(e.name)) walk(root, p, out);
    } else if (e.isFile() && EXT.test(e.name)) out.push(p);
  }
}

/** Builds or refreshes the index of one folder; cheap when nothing changed. */
export function indexFolder(dir: string): Index {
  const root = resolve(dir);
  const idx = indexes.get(root) ?? { files: new Map(), df: new Map(), chunks: 0, totalLen: 0, built: 0 };
  const paths: string[] = [];
  walk(root, root, paths);
  const seen = new Set(paths);
  let changed = false;
  for (const p of paths) {
    let st: import("node:fs").Stats;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.size > MAX_FILE) continue;
    const old = idx.files.get(p);
    if (old && old.mtime === st.mtimeMs) continue;
    try {
      idx.files.set(p, { mtime: st.mtimeMs, chunks: chunksOf(relative(root, p).split(sep).join("/"), readFileSync(p, "utf8")) });
      changed = true;
    } catch {}
  }
  for (const p of [...idx.files.keys()])
    if (!seen.has(p)) {
      idx.files.delete(p);
      changed = true;
    }
  if (changed || !idx.built) {
    idx.df.clear();
    idx.chunks = 0;
    idx.totalLen = 0;
    for (const f of idx.files.values())
      for (const c of f.chunks) {
        idx.chunks++;
        idx.totalLen += c.len;
        for (const t of c.terms.keys()) idx.df.set(t, (idx.df.get(t) ?? 0) + 1);
      }
    idx.built = Date.now();
  }
  indexes.set(root, idx);
  return idx;
}

export interface Hit {
  folder: string;
  file: string;
  heading: string;
  text: string;
  score: number;
}

/** Passages of other texts (knowledge files), searchable alongside the folders. */
const textChunks = new Map<string, Chunk[]>();
export function chunksOfText(name: string, text: string): Chunk[] {
  const key = `${name}\u0000${text.length}\u0000${text.slice(0, 64)}`;
  let c = textChunks.get(key);
  if (!c) {
    c = chunksOf(name, text);
    textChunks.set(key, c);
  }
  return c;
}

/** BM25 over every passage in the folders and the extra texts, ranked together. */
export function searchFolders(folders: string[], query: string, limit = 6, extra: { source: string; chunks: Chunk[] }[] = []): Hit[] {
  const q = [...new Set(tokenize(query))];
  if (!q.length) return [];
  const all: { folder: string; c: Chunk }[] = [];
  for (const folder of folders) for (const f of indexFolder(folder).files.values()) for (const c of f.chunks) all.push({ folder, c });
  for (const e of extra) for (const c of e.chunks) all.push({ folder: "", c });
  if (!all.length) return [];
  const df = new Map<string, number>();
  let total = 0;
  for (const { c } of all) {
    total += c.len;
    for (const t of q) if (c.terms.has(t)) df.set(t, (df.get(t) ?? 0) + 1);
  }
  const avg = total / all.length;
  const k1 = 1.2,
    b = 0.75;
  const hits: Hit[] = [];
  for (const { folder, c } of all) {
    let score = 0;
    let matched = 0;
    for (const t of q) {
      const tf = c.terms.get(t);
      if (!tf) continue;
      matched++;
      const d = df.get(t) ?? 0;
      const idf = Math.log(1 + (all.length - d + 0.5) / (d + 0.5));
      score += idf * ((tf * (k1 + 1)) / (tf + k1 * (1 - b + (b * c.len) / avg)));
    }
    // passages with more of the words first
    if (score > 0) hits.push({ folder, file: c.file, heading: c.heading, text: c.text, score: score * (0.5 + matched / q.length / 2) });
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}

export function folderStats(folder: string) {
  const idx = indexFolder(folder);
  return { files: idx.files.size, passages: idx.chunks };
}

/** Reads one file from a knowledge folder, refusing anything outside it. */
export function readFromFolders(folders: string[], rel: string): string | null {
  for (const folder of folders) {
    const root = resolve(folder);
    const full = resolve(root, rel);
    if (!full.startsWith(root + sep)) continue;
    try {
      if (statSync(full).isFile() && EXT.test(full)) return readFileSync(full, "utf8").slice(0, 200_000);
    } catch {}
  }
  return null;
}
