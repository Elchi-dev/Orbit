import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowUp, FileText, Gauge, Globe, Mic, MicOff, Image as ImageIcon, Paperclip, Square, X } from "lucide-react";
import { useStore } from "../../lib/store";
import type { Workspace } from "../../lib/types";
import { api } from "../../lib/api";
import { BUILTINS, expand, runSlash, type SlashItem } from "../../lib/slash";

interface Attachment {
  id: number;
  kind: "image" | "pdf" | "text";
  name: string;
  mediaType?: string;
  data?: string;
  text?: string;
  preview?: string;
}

const EFFORTS = [
  { id: "low", label: "Low", hint: "Fastest, for simple steps" },
  { id: "medium", label: "Medium", hint: "Balanced default" },
  { id: "high", label: "High", hint: "Thinks harder" },
  { id: "xhigh", label: "Extra high", hint: "Hard problems" },
  { id: "max", label: "Max", hint: "Slowest, most thorough" },
];
const BIG_PASTE = 5000;
let attachId = 1;

function readFile(f: File): Promise<Attachment | null> {
  return new Promise((resolve) => {
    const r = new FileReader();
    if (f.type.startsWith("image/")) {
      r.onload = () => {
        const url = String(r.result);
        resolve({ id: attachId++, kind: "image", name: f.name, mediaType: f.type, data: url.split(",")[1], preview: url });
      };
      r.readAsDataURL(f);
    } else if (f.type === "application/pdf") {
      r.onload = () => resolve({ id: attachId++, kind: "pdf", name: f.name, data: String(r.result).split(",")[1] });
      r.readAsDataURL(f);
    } else if (f.size < 2_000_000) {
      r.onload = () => resolve({ id: attachId++, kind: "text", name: f.name, text: String(r.result) });
      r.readAsText(f);
    } else resolve(null);
  });
}

export function Composer({ ws }: { ws: Workspace }) {
  const send = useStore((s) => s.send);
  const defaultEffort = useStore((s) => s.server?.profiles.find((p) => p.id === ws.profile)?.effort || s.server?.config.models.effort || "medium");
  const [text, setText] = useState("");
  const [files, setFiles] = useState<Attachment[]>([]);
  const [effort, setEffort] = useState<string>("");
  const [effortOpen, setEffortOpen] = useState(false);
  const [drag, setDrag] = useState(false);
  const ta = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const running = ws.running;
  // web search is remembered per workspace, in this browser
  const webKey = `orbit.web.${ws.id}`;
  const [web, setWeb] = useState(false);
  useEffect(() => {
    const fallback = !!useStore.getState().server?.profiles.find((p) => p.id === ws.profile)?.web;
    try {
      const v = localStorage.getItem(webKey);
      setWeb(v === null ? fallback : v === "1");
    } catch {
      setWeb(fallback);
    }
  }, [webKey, ws.profile]);
  const setWebOn = (on: boolean) => {
    setWeb(on);
    try {
      localStorage.setItem(webKey, on ? "1" : "0");
    } catch {}
  };
  const toggleWeb = () => setWebOn(!web);

  // dictation through the browser's own speech recognition, where there is one
  const Speech: any = typeof window !== "undefined" ? (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition : null;
  const [listening, setListening] = useState(false);
  const [heard, setHeard] = useState("");
  const rec = useRef<any>(null);
  function dictate() {
    if (listening) {
      rec.current?.stop();
      return;
    }
    const r = new Speech();
    r.continuous = true;
    r.interimResults = true;
    r.lang = navigator.language || "en-US";
    r.onresult = (ev: any) => {
      let interim = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const t = ev.results[i][0].transcript;
        if (ev.results[i].isFinal) setText((x) => (x && !x.endsWith(" ") ? `${x} ` : x) + t.trim());
        else interim += t;
      }
      setHeard(interim);
    };
    r.onend = () => {
      setListening(false);
      setHeard("");
    };
    r.onerror = (ev: any) => {
      if (ev.error !== "no-speech" && ev.error !== "aborted") useStore.getState().toast({ title: "Dictation stopped", body: ev.error === "not-allowed" ? "The browser wasn't allowed to use the microphone." : ev.error, tone: "warn" });
    };
    rec.current = r;
    r.start();
    setListening(true);
  }
  useEffect(() => () => rec.current?.stop(), [ws.id]);

  // slash commands: built-ins, saved prompts (.claude/commands, ~/.orbit/prompts) and skills
  const [custom, setCustom] = useState<SlashItem[]>([]);
  const [pick, setPick] = useState(0);
  useEffect(() => {
    api
      .get<{ commands: { name: string; description: string; body: string }[]; skills: { name: string; description: string }[] }>(`/api/workspaces/${ws.id}/context`)
      .then((c) =>
        setCustom([
          ...c.commands.map((x) => ({ name: x.name, hint: x.description, kind: "prompt" as const, body: x.body })),
          ...c.skills.map((x) => ({ name: x.name, hint: `Skill: ${x.description}`, kind: "skill" as const })),
        ]),
      )
      .catch(() => setCustom([]));
  }, [ws.id]);
  const slash = text.startsWith("/") && !text.includes("\n") ? text.slice(1) : null;
  const [slashName, ...slashRest] = (slash ?? "").split(" ");
  const slashArgs = slashRest.join(" ").trim();
  const typingArgs = slash !== null && slash.includes(" ");
  const all = [...BUILTINS, ...custom.filter((c) => !BUILTINS.some((b) => b.name === c.name))];
  const matches = slash === null ? [] : typingArgs ? all.filter((i) => i.name === slashName) : all.filter((i) => i.name.startsWith(slashName.toLowerCase())).slice(0, 40);
  useEffect(() => setPick(0), [slashName]);

  async function choose(item: SlashItem, args: string) {
    if (item.kind === "prompt") {
      setText(expand(item.body ?? "", args));
      requestAnimationFrame(() => ta.current?.focus());
      return;
    }
    if (item.kind === "skill") {
      setText(`Use the ${item.name} skill${args ? `: ${args}` : "."}`);
      return;
    }
    if (item.args && !args && !typingArgs) {
      setText(`/${item.name} `);
      return;
    }
    setText("");
    await runSlash(item.name, args, { ws, setText, web, setWeb: setWebOn, setEffort });
  }

  useEffect(() => {
    ta.current?.focus();
  }, [ws.id]);

  // text handed over from the editor or an orbit:// style link lands here, never sent on its own
  const incoming = useStore((s) => s.drafts[ws.id]);
  useEffect(() => {
    if (!incoming) return;
    setText((t) => (t.trim() ? `${t}\n\n${incoming}` : incoming));
    useStore.getState().setIncoming(ws.id, null);
    requestAnimationFrame(() => {
      const el = ta.current;
      if (el) {
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
      }
    });
  }, [incoming, ws.id]);
  useEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = Math.min(el.scrollHeight, 260) + "px";
  }, [text]);

  async function addFiles(list: FileList | File[]) {
    const read = (await Promise.all([...list].map(readFile))).filter(Boolean) as Attachment[];
    setFiles((f) => [...f, ...read]);
  }

  function submit() {
    if (running) return;
    if (!text.trim() && !files.length) return;
    send({
      type: "send",
      workspaceId: ws.id,
      text,
      effort: effort || undefined,
      web,
      attachments: files.map(({ kind, name, mediaType, data, text }) => ({ kind, name, mediaType, data, text })),
    });
    setText("");
    setFiles([]);
  }

  const effectiveEffort = effort || defaultEffort;
  const effortLabel = EFFORTS.find((e) => e.id === effectiveEffort)?.label ?? effectiveEffort;

  return (
    <div
      className={`composer-wrap ${drag ? "drag" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
      }}
    >
      <AnimatePresence>
        {files.length > 0 && (
          <motion.div className="attach-tray" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }}>
            {files.map((f) => (
              <motion.span layout key={f.id} className="attach glass" initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}>
                {f.preview ? <img src={f.preview} alt="" /> : f.kind === "pdf" ? <FileText size={16} /> : <FileText size={16} />}
                <span className="attach-name">{f.name}</span>
                <button className="btn b-ghost icon-btn sm" aria-label={`Remove ${f.name}`} onClick={() => setFiles(files.filter((x) => x.id !== f.id))}>
                  <X size={14} />
                </button>
              </motion.span>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {matches.length > 0 && (
          <motion.ul
            className="slash-menu"
            role="listbox"
            aria-label="Commands"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            transition={{ duration: 0.15 }}
          >
            {matches.map((m, i) => (
              <li key={m.kind + m.name} role="option" aria-selected={i === pick}>
                <button
                  type="button"
                  className={`slash-item ${i === pick ? "on" : ""}`}
                  onMouseEnter={() => setPick(i)}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    choose(m, slashArgs);
                  }}
                >
                  <span className="slash-name mono">/{m.name}</span>
                  {m.args && <span className="slash-args mono">{m.args}</span>}
                  <span className="slash-hint">{m.hint}</span>
                  {m.kind !== "action" && <span className="slash-kind">{m.kind === "skill" ? "skill" : "prompt"}</span>}
                </button>
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
      <form
        className="composer glass"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <label htmlFor="composer" className="sr">
          Message Claude
        </label>
        <textarea
          id="composer"
          ref={ta}
          rows={1}
          value={text}
          placeholder={listening ? heard || "Listening…" : running ? "Claude is working. You can type the next message." : "Tell Claude what to do next"}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (matches.length) {
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                setPick((p) => (p + (e.key === "ArrowDown" ? 1 : matches.length - 1)) % matches.length);
                return;
              }
              if (e.key === "Tab") {
                e.preventDefault();
                setText(`/${matches[pick].name} `);
                return;
              }
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                choose(matches[pick], slashArgs);
                return;
              }
              if (e.key === "Escape") {
                e.stopPropagation();
                setText("");
                return;
              }
            }
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
          onPaste={(e) => {
            const items = [...e.clipboardData.files];
            if (items.length) {
              e.preventDefault();
              addFiles(items);
              return;
            }
            const pasted = e.clipboardData.getData("text");
            if (pasted.length > BIG_PASTE) {
              e.preventDefault();
              setFiles((f) => [...f, { id: attachId++, kind: "text", name: `pasted-${f.length + 1}.txt`, text: pasted }]);
            }
          }}
        />
        <div className="composer-tools">
          <input ref={fileInput} type="file" multiple hidden onChange={(e) => e.target.files && addFiles(e.target.files)} />
          <button type="button" className="btn b-ghost icon-btn" aria-label="Attach files" data-tip="Attach images, PDFs or text" onClick={() => fileInput.current?.click()}>
            <Paperclip size={18} />
          </button>
          {Speech && (
            <button
              type="button"
              className={`btn b-ghost icon-btn mic ${listening ? "on" : ""}`}
              aria-pressed={listening}
              aria-label={listening ? "Stop dictating" : "Dictate"}
              data-tip={listening ? "Stop dictating" : "Dictate (your browser's speech recognition, which may send audio to its maker)"}
              onClick={dictate}
            >
              {listening ? <MicOff size={17} /> : <Mic size={17} />}
            </button>
          )}
          <button
            type="button"
            className={`btn b-ghost sz-s web-toggle ${web ? "on" : ""}`}
            aria-pressed={web}
            onClick={() => toggleWeb()}
            data-tip={web ? "Web search is on for this workspace" : "Let Claude search the web (1 cent a search)"}
          >
            <Globe size={16} /> {web ? "Web on" : "Web"}
          </button>
          <div className="effort">
            <button type="button" className={`btn b-ghost sz-s pill ${effort ? "set" : ""}`} aria-label="Thinking effort" aria-expanded={effortOpen} onClick={() => setEffortOpen(!effortOpen)} data-tip="How hard Claude thinks">
              <Gauge size={16} /> {effortLabel}
            </button>
            <AnimatePresence>
              {effortOpen && (
                <motion.div
                  className="effort-pop glass panel"
                  initial={{ opacity: 0, y: 10, scale: 0.96 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 10, scale: 0.96 }}
                  transition={{ type: "spring", stiffness: 320, damping: 26 }}
                >
                  {EFFORTS.map((e) => (
                    <button
                      type="button"
                      key={e.id}
                      className={`effort-opt row-react ${effectiveEffort === e.id ? "on" : ""}`}
                      onClick={() => {
                        setEffort(e.id === defaultEffort ? "" : e.id);
                        setEffortOpen(false);
                      }}
                    >
                      <span className="effort-bars" aria-hidden="true">
                        {EFFORTS.map((_, i) => (
                          <i key={i} className={i <= EFFORTS.indexOf(e) ? "on" : ""} />
                        ))}
                      </span>
                      <span className="effort-text">
                        <b>{e.label}</b>
                        <span>{e.hint}</span>
                      </span>
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          <span className="grow" />
          {running ? (
            <button type="button" className="btn b-outline send-btn" aria-label="Stop" data-tip="Stop (Esc twice kills the shell too)" onClick={() => send({ type: "stop", workspaceId: ws.id })}>
              <Square size={16} fill="currentColor" />
            </button>
          ) : (
            <button type="submit" className="btn b-peach send-btn" aria-label="Send" disabled={!text.trim() && !files.length}>
              <ArrowUp size={20} strokeWidth={2.4} />
            </button>
          )}
        </div>
      </form>
      {drag && (
        <div className="drop-hint">
          <ImageIcon size={20} /> Drop files to attach
        </div>
      )}
    </div>
  );
}
