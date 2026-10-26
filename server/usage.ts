import { priceFor } from "./config";
import { db, now } from "./db";
import type { Usage } from "./anthropic";

/** USD per web search (10 per 1,000), checked October 2026 */
export const WEB_SEARCH_USD = 0.01;

export function costOf(model: string, u: Usage) {
  const p = priceFor(model);
  const tokens = (u.input * p.input + u.output * p.output + u.cache_read * p.cache_read + u.cache_write * p.cache_write) / 1_000_000;
  return tokens + (u.web_searches ?? 0) * WEB_SEARCH_USD;
}

export function recordUsage(
  wsId: string | null,
  messageId: string | null,
  kind: "pilot" | "judge" | "scribe" | "library" | "plugin",
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
