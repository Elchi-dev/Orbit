import { Hand, ListChecks, Scale } from "lucide-react";
import type { Mode } from "../../lib/types";

const MODES: { id: Mode; label: string; tip: string; Icon: typeof Hand }[] = [
  { id: "manual", label: "Manual", tip: "You approve every action that isn't read-only or covered by a rule", Icon: Hand },
  { id: "auto", label: "Auto", tip: "A judge model approves safe actions and asks you about the rest", Icon: Scale },
  { id: "rules", label: "Rules", tip: "Only your rules decide; anything else is blocked. For unattended runs", Icon: ListChecks },
];

export function ModeSwitch({ value, onChange, compact }: { value: Mode; onChange: (m: Mode) => void; compact?: boolean }) {
  const idx = Math.max(0, MODES.findIndex((m) => m.id === value));
  return (
    <div className={`mode-switch ${compact ? "compact" : ""}`} role="radiogroup" aria-label="Approval mode">
      <span className="mode-thumb" style={{ transform: `translateX(${idx * 100}%)` }} aria-hidden="true" />
      {MODES.map(({ id, label, tip, Icon }) => (
        <button
          key={id}
          type="button"
          role="radio"
          aria-checked={value === id}
          className={`btn mode-opt ${value === id ? "on" : ""}`}
          onClick={() => onChange(id)}
          data-tip={tip.length > 60 ? label : tip}
          data-tip-side="bottom"
          title={tip}
        >
          <Icon size={15} />
          <span>{label}</span>
        </button>
      ))}
    </div>
  );
}
