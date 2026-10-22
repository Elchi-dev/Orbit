import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowUp, Check, ChevronRight, Folder, FolderSearch } from "lucide-react";
import { api } from "../lib/api";

interface Listing {
  path: string;
  parent: string;
  entries: string[];
  error?: string;
}

export function FolderPicker({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const [open, setOpen] = useState(false);
  const [listing, setListing] = useState<Listing | null>(null);

  const go = (path: string) => api.get<Listing>(`/api/fs?path=${encodeURIComponent(path)}`).then(setListing).catch(() => {});
  useEffect(() => {
    if (open) go(value || "~");
  }, [open]);

  return (
    <div className="folder-picker">
      <div className="field">
        <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label="Workspace folder" spellCheck={false} />
        <button type="button" className="btn b-ghost icon-btn sm" onClick={() => setOpen(!open)} aria-label="Browse folders" data-tip="Browse">
          <FolderSearch size={16} />
        </button>
      </div>
      <AnimatePresence>
        {open && listing && (
          <motion.div
            className="fp-pop glass panel"
            initial={{ opacity: 0, y: 8, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.97 }}
            transition={{ type: "spring", stiffness: 320, damping: 26 }}
          >
            <div className="fp-head">
              <button type="button" className="btn b-ghost icon-btn sm" onClick={() => go(listing.parent)} aria-label="Up one folder" data-tip="Up">
                <ArrowUp size={16} />
              </button>
              <span className="mono fp-path">{listing.path}</span>
              <button
                type="button"
                className="btn b-lav sz-s pill"
                onClick={() => {
                  onChange(listing.path);
                  setOpen(false);
                }}
              >
                <Check size={15} /> Use this
              </button>
            </div>
            <div className="fp-list">
              {listing.error && <p className="muted small">{listing.error}</p>}
              {listing.entries.map((e) => (
                <button type="button" key={e} className="fp-item row-react" onClick={() => go(`${listing.path}/${e}`)}>
                  <Folder size={15} /> <span>{e}</span> <ChevronRight size={14} className="fp-chev" />
                </button>
              ))}
              {!listing.error && listing.entries.length === 0 && <p className="muted small">No folders inside.</p>}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
