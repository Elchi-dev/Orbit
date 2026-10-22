import { BookOpen, Code2, FlaskConical, Monitor, Plane, Shield, Sparkles, SquareTerminal, Telescope, Users, type LucideIcon } from "lucide-react";
import type { Profile } from "../../lib/types";
import { useStore } from "../../lib/store";

export const PROFILE_ICONS: Record<string, LucideIcon> = {
  users: Users,
  terminal: SquareTerminal,
  plane: Plane,
  monitor: Monitor,
  telescope: Telescope,
  sparkles: Sparkles,
  code: Code2,
  flask: FlaskConical,
  book: BookOpen,
  shield: Shield,
};

export function ProfileIcon({ icon, size = 16 }: { icon: string; size?: number }) {
  const I = PROFILE_ICONS[icon] ?? Users;
  return <I size={size} aria-hidden="true" />;
}

export function useProfiles(): Profile[] {
  return useStore((s) => s.server?.profiles ?? []);
}

export function useProfile(id?: string): Profile | undefined {
  const all = useProfiles();
  return all.find((p) => p.id === id) ?? all[0];
}
