import { useEffect, useMemo, useState } from "react";
import { RefreshCw, Search } from "lucide-react";
import { api } from "../lib/api";
import type { Config, Integrations as Data } from "../lib/types";

/** Settings page: the editor Orbit opens files in, and the 100 programs it knows. */
export function IntegrationsPage({
  draft,
  set,
  setCtx,
  setSkills,
}: {
  draft: Config;
  set: (v: Partial<Config["integrations"]>) => void;
  setCtx: (v: Partial<Config["context"]>) => void;
  setSkills: (v: Partial<Config["skills"]>) => void;
}) {
  const [data, setData] = useState<Data | null>(null);
  const [versions, setVersions] = useState<Record<string, string>>({});
  const [q, setQ] = useState("");
  const [onlyFound, setOnlyFound] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = async (rescan = false) => {
    setBusy(true);
    try {
      setData(await api.get<Data>(`/api/integrations${rescan ? "?rescan=1" : ""}`));
      api.get<Record<string, string>>("/api/integrations/versions").then(setVersions).catch(() => {});
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    load();
  }, []);

  const groups = useMemo(() => {
    if (!data) return [];
    const needle = q.trim().toLowerCase();
    const list = data.apps.filter((a) => (!onlyFound || a.path) && (!needle || a.name.toLowerCase().includes(needle) || a.bin.includes(needle)));
    const by = new Map<string, typeof list>();
    for (const a of list) by.set(a.cat, [...(by.get(a.cat) ?? []), a]);
    return [...by];
  }, [data, q, onlyFound]);

  const found = data?.apps.filter((a) => a.path).length ?? 0;
  const auto = data?.editors.find((e) => e.id === data.resolvedEditor && draft.integrations.editor === "auto");

  return (
    <>
      <h2>Integrations</h2>
      <p className="muted">
        Orbit knows 100 developer programs. For the ones on this machine it tells Claude they are there and how to run them without a prompt, lets
        their read-only commands through, and never turns their destructive commands into a broad rule.
      </p>

      <label className="set-field">
        <span className="form-label">Open files in</span>
        <div className="field">
          <select value={draft.integrations.editor} onChange={(e) => set({ editor: e.target.value })}>
            <option value="auto">{auto ? `Automatic (${auto.name})` : "Automatic"}</option>
            {data?.editors.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
                {e.found ? "" : " (not found)"}
              </option>
            ))}
            <option value="none">Don't open files</option>
          </select>
        </div>
        <span className="muted small">Paths in the conversation and the Files panel open there, at the right line.</span>
      </label>

      <div className="toggle-row row-react">
        <span>
          <b>Tell Claude what's installed</b>
          <span className="muted small">Adds a short list to every request, so Claude doesn't spend turns checking.</span>
        </span>
        <button
          className="switch"
          role="switch"
          aria-checked={draft.integrations.briefing}
          aria-label="Tell Claude what's installed"
          onClick={() => set({ briefing: !draft.integrations.briefing })}
        />
      </div>

      <div className="toggle-row row-react">
        <span>
          <b>Follow the project's own instructions</b>
          <span className="muted small">AGENTS.md, CLAUDE.md, Cursor, Windsurf and Copilot rules in the workspace folder go with every request.</span>
        </span>
        <button className="switch" role="switch" aria-checked={draft.context.project_files} aria-label="Follow project instructions" onClick={() => setCtx({ project_files: !draft.context.project_files })} />
      </div>
      <div className="toggle-row row-react">
        <span>
          <b>Skills</b>
          <span className="muted small">SKILL.md folders in .claude/skills, ~/.orbit/skills and ~/.claude/skills. Claude sees their names and loads one when it fits.</span>
        </span>
        <button className="switch" role="switch" aria-checked={draft.skills.enabled} aria-label="Skills" onClick={() => setSkills({ enabled: !draft.skills.enabled })} />
      </div>

      <div className="int-bar">
        <div className="field int-search">
          <Search size={15} className="field-icon" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a program" aria-label="Find a program" />
        </div>
        <div className="seg" role="radiogroup" aria-label="Which programs">
          <button className={`btn seg-opt ${onlyFound ? "on" : ""}`} role="radio" aria-checked={onlyFound} onClick={() => setOnlyFound(true)}>
            Installed <span className="num muted">{found}</span>
          </button>
          <button className={`btn seg-opt ${!onlyFound ? "on" : ""}`} role="radio" aria-checked={!onlyFound} onClick={() => setOnlyFound(false)}>
            All 100
          </button>
        </div>
        <button className="btn b-ghost icon-btn" onClick={() => load(true)} aria-label="Look again" data-tip="Look again">
          <RefreshCw size={16} className={busy ? "spin" : ""} />
        </button>
      </div>

      {groups.length === 0 && <p className="muted">{data ? "Nothing matches." : "Looking…"}</p>}
      {groups.map(([cat, apps]) => (
        <section key={cat} className="int-group">
          <h3>{cat}</h3>
          <ul className="int-list">
            {apps.map((a) => (
              <li key={a.id} className={`int-row ${a.path ? "" : "missing"}`} title={a.path ?? `Looked for ${a.bin} on your PATH`}>
                <span className={`int-dot ${a.path ? "on" : ""}`} aria-hidden="true" />
                <span className="int-name">{a.name}</span>
                <span className="int-what muted small">
                  {[a.editor && "opens files", a.readonly && `${a.readonly} read-only`, a.guard && `${a.guard} guarded`].filter(Boolean).join(", ")}
                </span>
                <span className="int-ver num muted small">{a.path ? versions[a.id] || "" : "not found"}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}
