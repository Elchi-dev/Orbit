import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowLeft, Check, Copy, ExternalLink, FilePlus2, Loader2, Pencil, Plus, Save, Search, Sparkles, Square, Trash2, Eye } from "lucide-react";
import { api } from "../../lib/api";
import { useStore } from "../../lib/store";
import type { Config } from "../../lib/types";
import { Ori, type OriPose } from "../ori/Ori";
import { Galaxy } from "../ui/Galaxy";
import { Markdown } from "../cockpit/Blocks";

type Kind = "skill" | "knowledge";
type Source = "project" | "orbit" | "claude" | "builtin";
interface Entry {
  name: string;
  title?: string;
  description: string;
  source: Source;
  enabled: boolean;
  always?: boolean;
}
interface Template {
  id: string;
  title: string;
  description: string;
  text: string;
}
interface Library {
  skills: Entry[];
  knowledge: Entry[];
  templates: { skill: Template[]; knowledge: Template[] };
  enabled: { skills: boolean; knowledge: boolean };
  generator: string;
}
interface Draft {
  name: string;
  title: string;
  description: string;
  text: string;
  sources: string[];
  cost: number;
}
type View =
  | { type: "list" }
  | { type: "open"; kind: Kind; name: string }
  | { type: "new"; kind: Kind; name: string; text: string; draft?: Draft }
  | { type: "ori"; kind: Kind };

const SOURCE: Record<Source, string> = { builtin: "Built in", orbit: "Yours", project: "Project", claude: "Claude Code" };
const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63);
const modelName = (id: string) => id.replace(/^claude-/, "").replace(/-(\d+)-(\d+)$/, " $1.$2").replace(/^\w/, (c) => c.toUpperCase());

/** Settings, Library: the skills and knowledge Claude has, yours and built in. */
export function LibraryPage({ draft, setDraft }: { draft: Config; setDraft: (c: Config) => void }) {
  const [lib, setLib] = useState<Library | null>(null);
  const [kind, setKind] = useState<Kind>("skill");
  const [view, setView] = useState<View>({ type: "list" });
  const load = () => api.get<Library>("/api/library").then(setLib);
  useEffect(() => {
    load();
  }, []);

  /** switches save at once, and the open settings follow so a later Save keeps them */
  async function patch<K extends "skills" | "knowledge">(section: K, value: Partial<Config[K]>) {
    await api.put("/api/config", { [section]: value });
    setDraft({ ...draft, [section]: { ...draft[section], ...value } });
    useStore.setState((s) => (s.server ? { server: { ...s.server, config: { ...s.server.config, [section]: { ...s.server.config[section], ...value } } } } : {}));
    load();
  }

  if (!lib) return <Loader2 className="spin" size={18} />;
  const back = () => {
    setView({ type: "list" });
    load();
  };

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div key={view.type === "list" ? "list" : view.type + ("name" in view ? view.name : "")} className="lib" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6, transition: { duration: 0.12 } }} transition={{ type: "spring", stiffness: 320, damping: 30 }}>
        {view.type === "list" && <List lib={lib} kind={kind} setKind={setKind} setView={setView} patch={patch} draft={draft} />}
        {view.type === "open" && <Open view={view} back={back} setView={setView} />}
        {view.type === "new" && <Editor view={view} back={back} onSaved={(name) => setView({ type: "open", kind: view.kind, name })} />}
        {view.type === "ori" && <OriWrites kind={view.kind} model={lib.generator} back={back} onDraft={(d) => setView({ type: "new", kind: view.kind, name: d.name, text: d.text, draft: d })} />}
      </motion.div>
    </AnimatePresence>
  );
}

function List({
  lib,
  kind,
  setKind,
  setView,
  patch,
  draft,
}: {
  lib: Library;
  kind: Kind;
  setKind: (k: Kind) => void;
  setView: (v: View) => void;
  patch: <K extends "skills" | "knowledge">(section: K, value: Partial<Config[K]>) => Promise<void>;
  draft: Config;
}) {
  const [q, setQ] = useState("");
  const [menu, setMenu] = useState(false);
  const all = kind === "skill" ? lib.skills : lib.knowledge;
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return t ? all.filter((e) => `${e.name} ${e.title ?? ""} ${e.description}`.toLowerCase().includes(t)) : all;
  }, [all, q]);
  const yours = shown.filter((e) => e.source !== "builtin");
  const built = shown.filter((e) => e.source === "builtin");
  const section = kind === "skill" ? "skills" : "knowledge";
  const on = kind === "skill" ? lib.enabled.skills : lib.enabled.knowledge;
  const disabled = (kind === "skill" ? draft.skills.disabled : draft.knowledge?.disabled) ?? [];
  const toggle = (name: string, enabled: boolean) => patch(section, { disabled: enabled ? disabled.filter((n) => n !== name) : [...new Set([...disabled, name])] } as any);

  return (
    <>
      <header className="lib-head">
        <div>
          <h2>Library</h2>
          <p className="muted">
            {kind === "skill"
              ? "Skills are instructions for a kind of work. Claude sees their names and loads one when a task fits."
              : "Knowledge is reference you keep for Claude. Files marked always are in front of it every time; the rest it looks up when they matter."}
          </p>
        </div>
        <Ori pose={kind === "skill" ? "reading" : "searching"} size={64} />
      </header>

      <div className="lib-bar">
        <div className="seg" role="tablist" aria-label="Show">
          {(["skill", "knowledge"] as Kind[]).map((k) => (
            <button key={k} role="tab" aria-selected={kind === k} className={`btn seg-btn ${kind === k ? "on" : ""}`} onClick={() => setKind(k)}>
              {kind === k && <motion.span layoutId="lib-seg" className="seg-hl" transition={{ type: "spring", stiffness: 420, damping: 34 }} />}
              <span>{k === "skill" ? "Skills" : "Knowledge"}</span>
              <small>{(k === "skill" ? lib.skills : lib.knowledge).length}</small>
            </button>
          ))}
        </div>
        <div className="lib-new">
          <button className="btn b-peach sz-m" onClick={() => setMenu((m) => !m)} aria-expanded={menu}>
            <Plus size={16} /> New
          </button>
          <AnimatePresence>
            {menu && (
              <motion.div className="menu lib-menu glass panel" initial={{ opacity: 0, scale: 0.95, y: -4 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.12 } }} style={{ transformOrigin: "top right" }} onMouseLeave={() => setMenu(false)}>
                <button className="btn menu-item lib-ask" onClick={() => setView({ type: "ori", kind })}>
                  <Ori pose="writing" size={30} still />
                  <span>
                    <b>Ask Ori to write one</b>
                    <small>Searches current practice, a few cents</small>
                  </span>
                </button>
                <button className="btn menu-item" onClick={() => setView({ type: "new", kind, name: "", text: kind === "skill" ? "---\nname: \ndescription: Use when \n---\n\n# Title\n\n" : "---\ntitle: \ndescription: \nalways: false\n---\n\n# Title\n\n" })}>
                  <FilePlus2 size={17} />
                  <span>
                    <b>Blank</b>
                    <small>Start from nothing</small>
                  </span>
                </button>
                <div className="menu-sep" />
                {lib.templates[kind].map((t) => (
                  <button key={t.id} className="btn menu-item" onClick={() => setView({ type: "new", kind, name: "", text: t.text })}>
                    <Copy size={16} />
                    <span>
                      <b>{t.title}</b>
                      <small>{t.description}</small>
                    </span>
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      <div className="toggle-row">
        <span>
          <b>{kind === "skill" ? "Use skills" : "Use knowledge"}</b>
          <span className="muted small">{on ? "On for every workspace. Switch single ones off below." : "Off: Claude doesn't see any of them."}</span>
        </span>
        <button className="switch" role="switch" aria-checked={on} aria-label={kind === "skill" ? "Use skills" : "Use knowledge"} onClick={() => patch(section, { enabled: !on } as any)} />
      </div>

      <div className="field lib-search">
        <Search size={16} className="field-icon" />
        <label htmlFor="lib-q" className="sr">
          Filter
        </label>
        <input id="lib-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder={kind === "skill" ? "Filter skills" : "Filter knowledge"} />
      </div>

      <div className={`lib-list ${on ? "" : "off"}`}>
        {yours.length > 0 && <h3>Yours</h3>}
        {yours.map((e, i) => (
          <Row key={e.name} e={e} i={i} open={() => setView({ type: "open", kind, name: e.name })} toggle={toggle} />
        ))}
        {built.length > 0 && <h3>Built in</h3>}
        {built.map((e, i) => (
          <Row key={e.name} e={e} i={i + yours.length} open={() => setView({ type: "open", kind, name: e.name })} toggle={toggle} />
        ))}
        {shown.length === 0 && <p className="muted small">{q ? "Nothing matches." : "Nothing here yet."}</p>}
      </div>
      {kind === "knowledge" && (
        <p className="muted small">
          Yours are files in <code>~/.orbit/knowledge</code>, a project's in its <code>.orbit/knowledge</code> folder.
        </p>
      )}
      {kind === "skill" && (
        <p className="muted small">
          Yours are folders in <code>~/.orbit/skills</code>; a project's in <code>.orbit/skills</code> or <code>.claude/skills</code>. One with the same name as a built-in replaces it.
        </p>
      )}
    </>
  );
}

function Row({ e, i, open, toggle }: { e: Entry; i: number; open: () => void; toggle: (name: string, on: boolean) => void }) {
  return (
    <div className={`lib-row rise ${e.enabled ? "" : "is-off"}`} style={{ "--i": Math.min(i, 12) } as any}>
      <button className="btn lib-row-main" onClick={open}>
        <span className="lib-row-top">
          <b>{e.title && e.title !== e.name ? e.title : e.name}</b>
          <span className={`chip lib-src src-${e.source}`}>{SOURCE[e.source]}</span>
          {e.always && <span className="chip chip-ui">always</span>}
        </span>
        <span className="muted small lib-desc">{e.description || "No description"}</span>
      </button>
      <button className="switch" role="switch" aria-checked={e.enabled} aria-label={`Use ${e.name}`} onClick={() => toggle(e.name, !e.enabled)} />
    </div>
  );
}

function Open({ view, back, setView }: { view: { kind: Kind; name: string }; back: () => void; setView: (v: View) => void }) {
  const toast = useStore((s) => s.toast);
  const [doc, setDoc] = useState<{ text: string; source: Source; editable: boolean } | null>(null);
  const [text, setText] = useState("");
  const [edit, setEdit] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api.get<{ text: string; source: Source; editable: boolean }>(`/api/library/${view.kind}/${view.name}`).then((d) => {
      setDoc(d);
      setText(d.text);
    });
  }, [view.kind, view.name]);
  if (!doc) return <Loader2 className="spin" size={18} />;
  const body = text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");

  async function save() {
    setBusy(true);
    try {
      await api.put(`/api/library/${view.kind}/${view.name}`, { text });
      toast({ title: "Saved", tone: "good" });
      setEdit(false);
      setDoc({ ...doc!, text });
    } finally {
      setBusy(false);
    }
  }
  async function copy() {
    await api.put(`/api/library/${view.kind}/${view.name}`, { text: doc!.text });
    toast({ title: "Your copy is in place", body: "It replaces the built-in from now on. Edit it as you like.", tone: "good" });
    setDoc({ ...doc!, source: "orbit", editable: true });
    setEdit(true);
  }
  async function remove() {
    await api.del(`/api/library/${view.kind}/${view.name}`);
    toast({ title: "Deleted", tone: "info" });
    back();
  }

  return (
    <>
      <div className="lib-detail-head">
        <button className="btn b-ghost sz-s" onClick={back}>
          <ArrowLeft size={15} className="nudge-left" /> Library
        </button>
        <span className={`chip lib-src src-${doc.source}`}>{SOURCE[doc.source]}</span>
      </div>
      <h2 className="lib-name">{view.name}</h2>
      <div className="lib-actions">
        {doc.editable ? (
          <>
            <button className="btn b-outline sz-s" onClick={() => setEdit((e) => !e)}>
              {edit ? <Eye size={15} /> : <Pencil size={15} />} {edit ? "Preview" : "Edit"}
            </button>
            {edit && (
              <button className="btn b-peach sz-s" onClick={save} disabled={busy || text === doc.text}>
                {busy ? <Loader2 size={15} className="spin" /> : <Save size={15} />} Save
              </button>
            )}
            <button className="btn b-ghost sz-s danger-hover" onClick={remove}>
              <Trash2 size={15} /> Delete
            </button>
          </>
        ) : doc.source === "builtin" ? (
          <button className="btn b-outline sz-s" onClick={copy}>
            <Copy size={15} /> Make my own copy to edit
          </button>
        ) : (
          <span className="muted small">Read from Claude Code's folder; edit it there.</span>
        )}
        <button className="btn b-ghost sz-s" onClick={() => setView({ type: "new", kind: view.kind, name: "", text: doc.text.replace(/^name: .*$/m, "name: ") })}>
          <FilePlus2 size={15} /> Use as a start
        </button>
      </div>
      {edit ? (
        <textarea className="lib-text" value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} aria-label="Contents" />
      ) : (
        <article className="lib-read">
          <Markdown text={body} />
        </article>
      )}
    </>
  );
}

function Editor({ view, back, onSaved }: { view: { kind: Kind; name: string; text: string; draft?: Draft }; back: () => void; onSaved: (name: string) => void }) {
  const toast = useStore((s) => s.toast);
  const [name, setName] = useState(view.name);
  const [text, setText] = useState(view.text);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(!!view.draft);
  const fmName = text.match(/^name:\s*(\S+)/m)?.[1] ?? text.match(/^title:\s*(.+)$/m)?.[1];
  const finalName = slug(name || fmName || "");

  async function save() {
    setErr("");
    if (!finalName) return setErr("Give it a name.");
    setBusy(true);
    try {
      const exists = await api.get(`/api/library/${view.kind}/${finalName}`).then((d: any) => d.source !== "builtin").catch(() => false);
      if (exists && !confirmReplace(finalName)) return setBusy(false);
      await api.put(`/api/library/${view.kind}/${finalName}`, { text });
      toast({ title: view.kind === "skill" ? "Skill saved" : "Knowledge saved", body: "Claude can use it from the next message on.", tone: "good" });
      onSaved(finalName);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="lib-detail-head">
        <button className="btn b-ghost sz-s" onClick={back}>
          <ArrowLeft size={15} className="nudge-left" /> Library
        </button>
        <span className="muted small">{view.kind === "skill" ? "New skill" : "New knowledge"}</span>
      </div>
      {view.draft && (
        <div className="lib-draft-note">
          <Ori pose="done" size={44} />
          <div>
            <b>Here's my draft.</b>
            <span className="muted small">
              Check it and change what doesn't fit you, then save. Cost ${view.draft.cost.toFixed(3)}
              {view.draft.sources.length ? `, from ${view.draft.sources.length} source${view.draft.sources.length === 1 ? "" : "s"}` : ""}.
            </span>
            {view.draft.sources.length > 0 && (
              <details className="lib-sources">
                <summary className="small">Sources</summary>
                <ul>
                  {view.draft.sources.map((u) => (
                    <li key={u}>
                      <a className="lnk small" href={u} target="_blank" rel="noreferrer">
                        {u.replace(/^https?:\/\//, "").slice(0, 70)} <ExternalLink size={11} />
                      </a>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        </div>
      )}
      <label className="set-field">
        <span className="form-label">Name</span>
        <div className="field">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={fmName || (view.kind === "skill" ? "like code-review" : "like about-me")} />
        </div>
        {finalName && finalName !== name && <span className="muted small">Saved as {finalName}</span>}
      </label>
      <div className="lib-actions">
        <button className="btn b-outline sz-s" onClick={() => setPreview((p) => !p)}>
          {preview ? <Pencil size={15} /> : <Eye size={15} />} {preview ? "Edit" : "Preview"}
        </button>
        <button className="btn b-peach sz-s" onClick={save} disabled={busy}>
          {busy ? <Loader2 size={15} className="spin" /> : <Check size={15} />} Save
        </button>
      </div>
      {err && <p className="bad-text small">{err}</p>}
      {preview ? (
        <article className="lib-read">
          <Markdown text={text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "")} />
        </article>
      ) : (
        <textarea className="lib-text" value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} aria-label="Contents" autoFocus={!view.draft} />
      )}
    </>
  );
}

function confirmReplace(name: string) {
  return window.confirm(`You already have one called ${name}. Replace it?`);
}

const STEP_POSE: Record<string, OriPose> = { start: "thinking", search: "searching", read: "reading", write: "writing", done: "done", error: "oops" };

function OriWrites({ kind, model, back, onDraft }: { kind: Kind; model: string; back: () => void; onDraft: (d: Draft) => void }) {
  const [request, setRequest] = useState("");
  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState<{ step: string; text: string }[]>([]);
  const [err, setErr] = useState("");
  const id = useRef("");
  const pose: OriPose = running ? STEP_POSE[steps[steps.length - 1]?.step ?? "start"] ?? "thinking" : err ? "oops" : "writing";

  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (d.id !== id.current) return;
      setSteps((s) => (d.step === "search" && !d.text ? s : [...s, { step: d.step, text: d.text }]));
    };
    window.addEventListener("orbit:libgen", on);
    return () => window.removeEventListener("orbit:libgen", on);
  }, []);

  async function go() {
    id.current = `g-${crypto.randomUUID().slice(0, 8)}`;
    setSteps([]);
    setErr("");
    setRunning(true);
    try {
      const d = await api.post<Draft>("/api/library/generate", { id: id.current, kind, request });
      onDraft(d);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setRunning(false);
    }
  }

  const label = (s: { step: string; text: string }) =>
    s.step === "start" ? "Thinking about what it needs" : s.step === "search" ? `Searching: ${s.text}` : s.step === "read" ? `Reading ${s.text.replace(/^https?:\/\//, "").slice(0, 60)}` : s.step === "write" ? "Writing" : s.step === "done" ? "Done" : s.text;

  return (
    <>
      <div className="lib-detail-head">
        <button className="btn b-ghost sz-s" onClick={back} disabled={running}>
          <ArrowLeft size={15} className="nudge-left" /> Library
        </button>
      </div>
      <div className="lib-ori">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span key={pose} initial={{ opacity: 0, scale: 0.85 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.85 }} transition={{ type: "spring", stiffness: 260, damping: 22 }}>
            <Ori pose={pose} size={120} />
          </motion.span>
        </AnimatePresence>
        <div className="bubble">
          <b>{kind === "skill" ? "What should the skill teach?" : "What should I look up and keep?"}</b>
          <span className="muted small">
            I search the web for current practice, read the best sources and write a draft for you to check. I can't touch your files or run anything. Usually a few cents with {modelName(model)}.
          </span>
        </div>
      </div>
      <label htmlFor="lib-req" className="sr">
        Description
      </label>
      <textarea
        id="lib-req"
        className="lib-req"
        value={request}
        onChange={(e) => setRequest(e.target.value)}
        disabled={running}
        placeholder={
          kind === "skill"
            ? "Reviewing Terraform plans before apply: what to look for, what must never be destroyed, how to report it."
            : "Swiss VAT rules for freelancers invoicing clients in the EU, with the current rates."
        }
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && request.trim().length > 7 && !running) go();
        }}
      />
      <div className="lib-actions">
        {running ? (
          <button className="btn b-outline sz-m" onClick={() => api.post(`/api/library/generate/${id.current}/stop`, {})}>
            <Square size={14} /> Stop
          </button>
        ) : (
          <button className="btn b-peach sz-m gbtn" onClick={go} disabled={request.trim().length < 8}>
            <Galaxy />
            <span className="lbl">
              <Sparkles size={16} /> Write it
            </span>
          </button>
        )}
      </div>
      {err && <p className="bad-text small">{err}</p>}
      {steps.length > 0 && (
        <ol className="lib-steps" aria-live="polite">
          {steps.map((s, i) => (
            <li key={i} className={`rise ${i === steps.length - 1 && running ? "now" : ""}`}>
              {i === steps.length - 1 && running ? <Loader2 size={13} className="spin" /> : <Check size={13} />}
              <span>{label(s)}</span>
            </li>
          ))}
        </ol>
      )}
    </>
  );
}
