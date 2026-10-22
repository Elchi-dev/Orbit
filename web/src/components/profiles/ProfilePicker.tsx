import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, ChevronDown } from "lucide-react";
import type { Profile } from "../../lib/types";
import { ProfileIcon, useProfiles } from "./ProfileIcon";

const MODE_WORD: Record<string, string> = { manual: "you approve", auto: "the judge approves", rules: "only rules", full: "decides itself" };

/** A button that shows the current profile and opens the list of all of them. */
export function ProfilePicker({
  value,
  onChange,
  up,
  compact,
}: {
  value: string;
  onChange: (p: Profile) => void;
  /** open above the button instead of below */
  up?: boolean;
  compact?: boolean;
}) {
  const profiles = useProfiles();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = profiles.find((p) => p.id === value) ?? profiles[0];
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", esc);
    };
  }, [open]);
  if (!current) return null;
  return (
    <div className={`profile-picker ${up ? "up" : ""}`} ref={ref}>
      <button
        type="button"
        className={`btn b-ghost sz-s profile-btn ${compact ? "compact" : ""}`}
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-haspopup="listbox"
        data-tip={compact ? `${current.name}: ${current.description}` : undefined}
        data-tip-side="bottom"
      >
        <ProfileIcon icon={current.icon} />
        <span className="profile-name">{current.name}</span>
        <ChevronDown size={13} className={`chev ${open ? "up" : ""}`} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.ul
            className="profile-pop glass panel"
            role="listbox"
            aria-label="Profile"
            initial={{ opacity: 0, y: up ? 6 : -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: up ? 6 : -6 }}
            transition={{ duration: 0.16 }}
          >
            {profiles.map((p) => (
              <li key={p.id} role="option" aria-selected={p.id === current.id}>
                <button
                  type="button"
                  className={`profile-opt ${p.id === current.id ? "on" : ""}`}
                  onClick={() => {
                    onChange(p);
                    setOpen(false);
                  }}
                >
                  <span className="profile-opt-icon">
                    <ProfileIcon icon={p.icon} size={17} />
                  </span>
                  <span className="profile-opt-text">
                    <b>{p.name}</b>
                    <span>{p.description}</span>
                    <span className="profile-opt-meta">
                      {[MODE_WORD[p.mode], p.hands_off && "never asks", p.layout === "terminal" && "terminal view", p.preview && "live preview", p.web && "web search"]
                        .filter(Boolean)
                        .join(", ")}
                    </span>
                  </span>
                  {p.id === current.id && <Check size={15} className="profile-check" />}
                </button>
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}
