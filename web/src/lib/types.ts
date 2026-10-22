export type Mode = "manual" | "auto" | "rules";

export interface PlanetStyle {
  color: string;
  surface: "gas" | "rocky" | "ice" | "ocean" | "lava";
  rings?: boolean;
}

export interface Workspace {
  id: string;
  title: string;
  cwd: string;
  model: string | null;
  mode: Mode;
  style: PlanetStyle;
  system_prompt: string;
  judge_notes: string;
  summary: string;
  titled: number;
  archived: number;
  incognito: number;
  created_at: number;
  updated_at: number;
  stats: { tokens: number; cost: number; last_ctx: number };
  running: boolean;
  pending: number;
  messageCount: number;
}

export interface Block {
  type: string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  input?: any;
  tool_use_id?: string;
  content?: any;
  is_error?: boolean;
  source?: any;
}

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: Block[];
  created_at: number;
}

export interface ToolCall {
  id: string;
  workspace_id: string;
  name: string;
  input: string;
  subject: string;
  status: "pending" | "judging" | "running" | "done" | "error" | "denied" | "cancelled";
  output: string | null;
  is_error: number;
  decided_by: "builtin" | "readonly" | "rule" | "judge" | "user" | "mode" | null;
  reason: string | null;
  judge_ms: number | null;
  duration_ms: number | null;
  created_at: number;
}

export interface Pin {
  id: number;
  text: string;
  created_at: number;
}

export interface Snapshot {
  id: number;
  path: string;
  existed: number;
  restored: number;
  created_at: number;
}

export interface Detail {
  messages: Message[];
  calls: Record<string, ToolCall>;
  pins: Pin[];
  snapshots: Snapshot[];
  last: { model: string; input: number; output: number; cache_read: number; cache_write: number; ttft_ms: number; tps: number; cost: number } | null;
  judge: { cost: number; n: number };
}

export interface Approval {
  id: string;
  workspaceId: string;
  workspaceTitle?: string;
  name: string;
  input: any;
  subject: string;
  suggestion?: string;
  judge?: { verdict: string; reason: string; ms?: number } | null;
}

export interface StreamBlock {
  type: string;
  text: string;
  name?: string;
  id?: string;
}

export interface Rule {
  id: number | null;
  scope: string;
  pattern: string;
  verdict: "allow" | "deny" | "ask";
  kind: "glob" | "regex";
  source: "db" | "config";
}

export interface Config {
  server: { port: number; host: string; open_browser: boolean };
  models: { pilot: string; judge: string; scribe: string; effort: string; max_tokens: number; thinking_display: string };
  permissions: {
    default_mode: Mode;
    skip_readonly: boolean;
    judge_context_messages: number;
    judge_timeout_ms: number;
    judge_notes: string;
    rules: { pattern: string; verdict: string; kind?: string }[];
  };
  ui_tools: Record<"set_title" | "set_planet" | "notify" | "pin" | "show" | "widget" | "auto_title", boolean>;
  ui: { motion: "full" | "calm" | "off"; sound: boolean; house_style: boolean };
  budget: { daily_usd: number; workspace_usd: number };
  safety: { undo_journal: boolean; undo_max_bytes: number; command_timeout_s: number };
  workspaces: { home: string };
  profile: { about: string; instructions: string };
  pricing: Record<string, { input: number; output: number; cache_write: number; cache_read: number; context: number }>;
}

export interface UsageEvent {
  model: string;
  usage: { input: number; output: number; cache_read: number; cache_write: number };
  cost: number;
  ttft_ms: number | null;
  tps: number | null;
  context_used: number;
  context_max: number;
  rate?: { tokens_remaining?: number; tokens_limit?: number };
}

export interface ServerState {
  version: string;
  mock: boolean;
  hasKey: boolean;
  configPath: string;
  dataDir: string;
  platform: string;
  home: string;
  config: Config;
  today: { cost: number; tokens: number };
  month: { cost: number; tokens: number };
  rate: { tokens_remaining?: number; tokens_limit?: number; requests_remaining?: number };
  running: string[];
  approvals: Approval[];
}
