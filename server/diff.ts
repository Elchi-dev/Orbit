// A small line diff (Myers) that renders unified hunks, so the review panel works
// the same on every system, with or without git or diff installed.

type Op = { t: " " | "-" | "+"; line: string };

function myers(a: string[], b: string[]): Op[] {
  const n = a.length,
    m = b.length,
    max = n + m;
  const v = new Int32Array(2 * max + 2);
  const trace: Int32Array[] = [];
  for (let d = 0; d <= max; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[max + k - 1] < v[max + k + 1]) ? v[max + k + 1] : v[max + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) x++, y++;
      v[max + k] = x;
      if (x >= n && y >= m) return backtrack(trace, a, b, max);
    }
  }
  return [];
}

function backtrack(trace: Int32Array[], a: string[], b: string[], max: number): Op[] {
  const ops: Op[] = [];
  let x = a.length,
    y = b.length;
  for (let d = trace.length - 1; d >= 0; d--) {
    const v = trace[d];
    const k = x - y;
    const prevK = k === -d || (k !== d && v[max + k - 1] < v[max + k + 1]) ? k + 1 : k - 1;
    const prevX = v[max + prevK];
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) ops.push({ t: " ", line: a[--x] }), y--;
    if (d > 0) {
      if (x === prevX) ops.push({ t: "+", line: b[--y] });
      else ops.push({ t: "-", line: a[--x] });
    }
  }
  return ops.reverse();
}

export interface DiffResult {
  text: string;
  added: number;
  removed: number;
}

const MAX_LINES = 5000;

/** Unified diff of two texts with `context` lines around each change. */
export function unifiedDiff(before: string, after: string, context = 3): DiffResult {
  const a = before === "" ? [] : before.replace(/\r\n/g, "\n").split("\n");
  const b = after === "" ? [] : after.replace(/\r\n/g, "\n").split("\n");
  if (a.length > MAX_LINES || b.length > MAX_LINES) {
    return { text: `(too long to compare here: ${a.length} lines before, ${b.length} after)`, added: Math.max(0, b.length - a.length), removed: Math.max(0, a.length - b.length) };
  }
  const ops = myers(a, b);
  let added = 0,
    removed = 0;
  for (const o of ops) o.t === "+" ? added++ : o.t === "-" ? removed++ : 0;
  // group into hunks
  const out: string[] = [];
  let i = 0;
  let ai = 0,
    bi = 0;
  const pos: { a: number; b: number }[] = [];
  for (const o of ops) {
    pos.push({ a: ai, b: bi });
    if (o.t !== "+") ai++;
    if (o.t !== "-") bi++;
  }
  while (i < ops.length) {
    while (i < ops.length && ops[i].t === " ") i++;
    if (i >= ops.length) break;
    const start = Math.max(0, i - context);
    // take changes until more than two contexts' worth of unchanged lines separate them
    let end = i;
    let trailing = 0;
    while (end < ops.length) {
      if (ops[end].t === " ") {
        if (trailing === context * 2) break;
        trailing++;
      } else trailing = 0;
      end++;
    }
    end -= Math.max(0, trailing - context);
    const slice = ops.slice(start, end);
    const aStart = pos[start].a + 1,
      bStart = pos[start].b + 1;
    const aLen = slice.filter((o) => o.t !== "+").length,
      bLen = slice.filter((o) => o.t !== "-").length;
    out.push(`@@ -${aLen ? aStart : aStart - 1},${aLen} +${bLen ? bStart : bStart - 1},${bLen} @@`);
    for (const o of slice) out.push(o.t + o.line);
    i = end;
  }
  return { text: out.join("\n"), added, removed };
}

// ---------- hunks one by one, for review ----------
export interface Hunk {
  /** the hunk as unified diff text, starting with its @@ line */
  text: string;
  added: number;
  removed: number;
}
interface Split {
  ops: Op[];
  /** which hunk each op belongs to, or -1 for unchanged lines outside every hunk */
  owner: number[];
  hunks: Hunk[];
  eol: string;
}

function split(before: string, after: string, context = 3): Split | null {
  const eol = /\r\n/.test(after || before) ? "\r\n" : "\n";
  const a = before === "" ? [] : before.replace(/\r\n/g, "\n").split("\n");
  const b = after === "" ? [] : after.replace(/\r\n/g, "\n").split("\n");
  if (a.length > MAX_LINES || b.length > MAX_LINES) return null;
  const ops = myers(a, b);
  const owner = new Array(ops.length).fill(-1);
  const hunks: Hunk[] = [];
  let ai = 0,
    bi = 0;
  const pos = ops.map((o) => {
    const p = { a: ai, b: bi };
    if (o.t !== "+") ai++;
    if (o.t !== "-") bi++;
    return p;
  });
  let i = 0;
  while (i < ops.length) {
    while (i < ops.length && ops[i].t === " ") i++;
    if (i >= ops.length) break;
    const start = Math.max(0, i - context);
    let end = i,
      trailing = 0;
    while (end < ops.length) {
      if (ops[end].t === " ") {
        if (trailing === context * 2) break;
        trailing++;
      } else trailing = 0;
      end++;
    }
    end -= Math.max(0, trailing - context);
    const slice = ops.slice(start, end);
    const aLen = slice.filter((o) => o.t !== "+").length,
      bLen = slice.filter((o) => o.t !== "-").length;
    const head = `@@ -${aLen ? pos[start].a + 1 : pos[start].a},${aLen} +${bLen ? pos[start].b + 1 : pos[start].b},${bLen} @@`;
    for (let k = start; k < end; k++) if (ops[k].t !== " ") owner[k] = hunks.length;
    hunks.push({ text: [head, ...slice.map((o) => o.t + o.line)].join("\n"), added: slice.filter((o) => o.t === "+").length, removed: slice.filter((o) => o.t === "-").length });
    i = end;
  }
  return { ops, owner, hunks, eol };
}

export function hunksOf(before: string, after: string): Hunk[] | null {
  return split(before, after)?.hunks ?? null;
}

/**
 * Takes one hunk's side and leaves the rest. `toAfter` builds the old text with that
 * hunk applied (keeping it); otherwise the new text with that hunk put back (undoing it).
 */
export function applyHunk(before: string, after: string, index: number, toAfter: boolean): string {
  const s = split(before, after);
  if (!s || index < 0 || index >= s.hunks.length) throw new Error("That change isn't there any more");
  const lines: string[] = [];
  s.ops.forEach((o, k) => {
    const mine = s.owner[k] === index;
    // inside the hunk take the side we want; outside it, the side we start from
    const side = mine ? (toAfter ? "+" : "-") : toAfter ? "-" : "+";
    if (o.t === " " || o.t === side) lines.push(o.line);
  });
  return lines.join(s.eol);
}
