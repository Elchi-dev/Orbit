import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowUp, FileText, Gauge, Image as ImageIcon, Paperclip, Square, X } from "lucide-react";
import { useStore } from "../../lib/store";
import type { Workspace } from "../../lib/types";

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
  const defaultEffort = useStore((s) => s.server?.config.models.effort ?? "medium");
  const [text, setText] = useState("");
  const [files, setFiles] = useState<Attachment[]>([]);
  const [effort, setEffort] = useState<string>("");
  const [effortOpen, setEffortOpen] = useState(false);
  const [drag, setDrag] = useState(false);
  const ta = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const running = ws.running;

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
          placeholder={running ? "Claude is working. You can type the next message." : "Tell Claude what to do next"}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
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
