import type { ServerWebSocket } from "bun";

// Single-user app: every connected tab sees every event.
const clients = new Set<ServerWebSocket<unknown>>();

export function addClient(ws: ServerWebSocket<unknown>) {
  clients.add(ws);
}
export function removeClient(ws: ServerWebSocket<unknown>) {
  clients.delete(ws);
}
/** Others who want every event too: paired phones, plugins. */
const listeners = new Set<(type: string, msg: string) => void>();
export function listen(fn: (type: string, msg: string) => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export function broadcast(type: string, payload: Record<string, unknown> = {}) {
  const msg = JSON.stringify({ type, ...payload });
  for (const l of listeners) {
    try {
      l(type, msg);
    } catch {}
  }
  for (const c of clients) {
    try {
      c.send(msg);
    } catch {}
  }
}
export function clientCount() {
  return clients.size;
}
