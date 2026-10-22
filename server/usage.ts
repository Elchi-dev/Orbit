import { priceFor } from "./config";
import { db, now } from "./db";
import type { Usage } from "./anthropic";

export function costOf(model: string, u: Usage) {
  const p = priceFor(model);
  return (u.input * p.input + u.output * p.output + u.cache_read * p.cache_read + u.cache_write * p.cache_write) / 1_000_000;
}

export function recordUsage(
  wsId: string | null,
  messageId: string | null,
  kind: "pilot" | "judge" | "scribe",
  model: string,
  u: Usage,
  ttft_ms: number | null = null,
  tps: number | null = null,
) {
  const cost = costOf(model, u);
  db.run(
    "INSERT INTO usage (workspace_id, message_id, kind, model, input, output, cache_read, cache_write, ttft_ms, tps, cost, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
    [wsId, messageId, kind, model, u.input, u.output, u.cache_read, u.cache_write, ttft_ms, tps, cost, now()],
  );
  return cost;
}
