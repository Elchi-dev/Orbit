import type { ServerWebSocket } from "bun";

// Single-user app: every connected tab sees every event.
const clients = new Set<ServerWebSocket<unknown>>();

export function addClient(ws: ServerWebSocket<unknown>) {
  clients.add(ws);
}
export function removeClient(ws: ServerWebSocket<unknown>) {
  clients.delete(ws);
}
export function broadcast(type: string, payload: Record<string, unknown> = {}) {
  const msg = JSON.stringify({ type, ...payload });
  for (const c of clients) {
    try {
      c.send(msg);
    } catch {}
  }
}
export function clientCount() {
  return clients.size;
}
