// Orbit on a phone, away from home (docs/REMOTE.md). Orbit keeps one socket to
// the relay; each phone that connects gets its own pipe, an encrypted session,
// and the same API and events the browser has. Alerts go through the relay or
// Firebase, sealed so that neither can read them.

import { hostname } from "node:os";
import { randomBytes } from "node:crypto";
import { config, saveConfig } from "./config";
import { db, now } from "./db";
import { broadcast, listen } from "./hub";
import { getSecret, setSecret, deleteSecret } from "./secrets";
import { alertKeyHost, b64u, deviceIdOf, newKeyPair, Opener, pubOf, roomOf, sealAlert, Sealer, sessionKeysHost, unb64u } from "./e2e";
import { sendFcm, fcmConfigured } from "./fcm";

declare const ORBIT_VERSION: string;
const VERSION = typeof ORBIT_VERSION === "string" ? ORBIT_VERSION : "dev";

export interface Device {
  id: string;
  name: string;
  pub: string;
  app: string;
  push_kind: string;
  push_token: string;
  created_at: number;
  last_seen: number;
}

// ---------- the host key ----------
export function hostPriv(): Uint8Array {
  let k = getSecret("remote.host_key");
  if (!k) {
    k = b64u(newKeyPair().priv);
    setSecret("remote.host_key", k);
  }
  return unb64u(k);
}
export const hostPub = () => pubOf(hostPriv());
export const room = () => roomOf(hostPub());
export const computerName = () => config().remote?.name || hostname().replace(/\.local$/, "") || "Orbit";

// ---------- devices and pairing ----------
export const listDevices = () => db.query<Device, []>("SELECT * FROM devices ORDER BY last_seen DESC").all();
const getDevice = (id: string) => db.query<Device, [string]>("SELECT * FROM devices WHERE id = ?").get(id);
export function removeDevice(id: string) {
  db.run("DELETE FROM devices WHERE id = ?", [id]);
  for (const s of sessions) if (s.deviceId === id) s.close("removed");
  broadcast("remote", { status: status() });
}

const codes = new Map<string, number>();
/** A one-use pairing link, valid for ten minutes. */
export function pairingLink() {
  const relay = relayUrl();
  if (!relay) throw new Error("Set up a relay first.");
  const code = b64u(new Uint8Array(randomBytes(16)));
  for (const [c, exp] of codes) if (exp < now()) codes.delete(c);
  codes.set(code, now() + 10 * 60_000);
  const q = new URLSearchParams({ v: "1", relay, room: room(), h: b64u(hostPub()), code, name: computerName() });
  return { uri: `orbit://pair?${q}`, expires: now() + 10 * 60_000 };
}

// ---------- settings ----------
export const relayUrl = () => (config().remote?.relay_url ?? "").replace(/\/+$/, "");
const relayToken = () => getSecret("remote.relay_token");

export async function setRelay(url: string, token?: string) {
  const clean = url.trim().replace(/\/+$/, "");
  if (clean && !/^https:\/\/[^/\s]+$/.test(clean) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(clean)) throw new Error("The relay address looks like https://relay.example.com");
  if (clean) {
    const ok = await fetch(`${clean}/v1/health`, { signal: AbortSignal.timeout(8000) })
      .then((r) => r.json())
      .then((j: any) => j?.ok === true)
      .catch(() => false);
    if (!ok) throw new Error(`No relay answers at ${clean}. Is it running, and does the address point at the server?`);
  }
  saveConfig({ ...config(), remote: { ...config().remote, relay_url: clean } });
  if (token) setSecret("remote.relay_token", token.trim());
  if (!clean) deleteSecret("remote.relay_token");
  reconnect();
}

// ---------- the relay connection ----------
type State = "off" | "connecting" | "online" | "error";
let state: State = "off";
let lastError = "";
let control: WebSocket | null = null;
let retry: ReturnType<typeof setTimeout> | null = null;
let backoff = 1000;

export function status() {
  return {
    state,
    error: lastError,
    relay: relayUrl(),
    room: room(),
    name: computerName(),
    hasToken: !!relayToken(),
    fcm: fcmConfigured(),
    devices: listDevices().map((d) => ({ ...d, online: [...sessions].some((s) => s.deviceId === d.id) })),
  };
}
function setState(s: State, err = "") {
  state = s;
  lastError = err;
  broadcast("remote", { status: status() });
}

const wsUrl = (path: string) => relayUrl().replace(/^http/, "ws") + path;

export function reconnect() {
  if (retry) clearTimeout(retry);
  retry = null;
  try {
    control?.close();
  } catch {}
  control = null;
  backoff = 1000;
  connect();
}

function connect() {
  const token = relayToken();
  if (!relayUrl() || !token) return setState("off");
  setState("connecting");
  const ws = new WebSocket(wsUrl(`/v1/host?room=${room()}`), { headers: { authorization: `Bearer ${token}` } } as any);
  control = ws;
  ws.onopen = () => {
    backoff = 1000;
    setState("online");
  };
  ws.onmessage = (m) => {
    if (typeof m.data !== "string") return;
    let msg: any;
    try {
      msg = JSON.parse(m.data);
    } catch {
      return;
    }
    if (msg.type === "ping") ws.send(JSON.stringify({ type: "pong" }));
    if (msg.type === "open" && typeof msg.chan === "string") accept(msg.chan);
  };
  ws.onclose = (e) => {
    if (control !== ws) return;
    control = null;
    const why = e.code === 4401 || e.code === 1008 ? "The relay refused the token." : e.reason || "Lost the relay.";
    setState("error", why);
    retry = setTimeout(connect, backoff);
    backoff = Math.min(backoff * 2, 60_000);
  };
  ws.onerror = () => {};
}

// ---------- sessions ----------
export interface Bridge {
  api: (req: Request, url: URL) => Promise<Response>;
  onMessage: (raw: string) => void;
  hello: () => unknown;
}
let bridge: Bridge | null = null;
export function setBridge(b: Bridge) {
  bridge = b;
}

class Session {
  deviceId = "";
  private up: Opener | null = null;
  private down: Sealer | null = null;
  private unsub: (() => void) | null = null;
  constructor(private ws: WebSocket) {}

  send(msg: unknown) {
    if (this.down && this.ws.readyState === WebSocket.OPEN) this.ws.send(this.down.seal(msg) as Uint8Array<ArrayBuffer>);
  }
  close(reason: string) {
    this.unsub?.();
    try {
      this.ws.close(1000, reason);
    } catch {}
  }

  async onFrame(data: string | ArrayBuffer) {
    if (!this.up) {
      // message 1: the phone's keys, in the clear
      if (typeof data !== "string") return this.close("expected hello");
      const m = JSON.parse(data);
      if (m.v !== 1) return this.close("unsupported version");
      const D = unb64u(String(m.d)), E = unb64u(String(m.e)), n = unb64u(String(m.n));
      if (D.length !== 32 || E.length !== 32 || n.length !== 16) return this.close("bad hello");
      const k = sessionKeysHost(hostPriv(), D, E, n);
      this.up = new Opener(k.up);
      this.down = new Sealer(k.down);
      this.deviceId = deviceIdOf(D);
      (this as any).pub = b64u(D);
      return;
    }
    if (typeof data === "string") return this.close("expected a sealed frame");
    let msg: any;
    try {
      msg = this.up.open(new Uint8Array(data));
    } catch {
      return this.close("could not open a frame");
    }
    if (msg.t === "hello") return this.hello(msg);
    if (!getDevice(this.deviceId)) return this.close("not paired");
    if (msg.t === "ping") return this.send({ t: "pong" });
    if (msg.t === "req") return this.request(msg);
    if (msg.t === "sub") {
      this.unsub?.();
      this.send({ t: "ev", e: { type: "hello", state: bridge?.hello() } });
      this.unsub = listen((_type, raw) => this.send({ t: "ev", e: JSON.parse(raw) }));
      return;
    }
    if (msg.t === "msg" && msg.m && typeof msg.m === "object") return bridge?.onMessage(JSON.stringify(msg.m));
  }

  private hello(msg: any) {
    const known = getDevice(this.deviceId);
    const code = typeof msg.code === "string" ? msg.code : "";
    const exp = code ? codes.get(code) : undefined;
    if (!known && !(exp && exp > now())) {
      this.send({ t: "denied", reason: code ? "That pairing code has expired. Show a new one in Orbit." : "This phone is not paired with this computer." });
      return this.close("denied");
    }
    if (code) codes.delete(code);
    const name = String(msg.name ?? "Phone").slice(0, 60);
    const push = msg.push && typeof msg.push === "object" ? msg.push : null;
    const kind = push?.kind === "fcm" && typeof push.token === "string" ? "fcm" : push?.kind === "relay" ? "relay" : known?.push_kind ?? "relay";
    const token = kind === "fcm" ? String(push?.token ?? known?.push_token ?? "") : "";
    db.run(
      "INSERT INTO devices (id, name, pub, app, push_kind, push_token, created_at, last_seen) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, app = excluded.app, push_kind = excluded.push_kind, push_token = excluded.push_token, last_seen = excluded.last_seen",
      [this.deviceId, name, (this as any).pub, String(msg.app ?? "").slice(0, 20), kind, token, now(), now()],
    );
    this.send({ t: "welcome", name: computerName(), version: VERSION });
    broadcast("remote", { status: status() });
    if (!known) broadcast("notify", { title: "Phone paired", body: `${name} can now reach this Orbit.` });
  }

  private async request(msg: any) {
    const id = msg.id;
    if (!bridge) return this.send({ t: "res", id, status: 503, body: { error: "Starting" } });
    const path = String(msg.path ?? "");
    if (!path.startsWith("/api/") || path.startsWith("/api/remote")) return this.send({ t: "res", id, status: 403, body: { error: "Not from a phone" } });
    const method = String(msg.method ?? "GET").toUpperCase();
    const url = new URL(`http://orbit.local${path}`);
    const req = new Request(url, { method, body: method === "GET" || method === "HEAD" || msg.body == null ? undefined : JSON.stringify(msg.body), headers: { "content-type": "application/json" } });
    try {
      const res = await bridge.api(req, url);
      const text = await res.text();
      let body: unknown = text;
      try {
        body = JSON.parse(text);
      } catch {}
      this.send({ t: "res", id, status: res.status, body });
    } catch (e) {
      this.send({ t: "res", id, status: 500, body: { error: (e as Error).message } });
    }
  }
}
const sessions = new Set<Session>();

function accept(chan: string) {
  const token = relayToken();
  if (!token) return;
  const ws = new WebSocket(wsUrl(`/v1/accept?room=${room()}&chan=${encodeURIComponent(chan)}`), { headers: { authorization: `Bearer ${token}` } } as any);
  ws.binaryType = "arraybuffer";
  const s = new Session(ws);
  sessions.add(s);
  ws.onmessage = (m) =>
    s.onFrame(m.data as any).catch(() => {
      s.close("error");
    });
  ws.onclose = () => {
    s.close("closed");
    sessions.delete(s);
    if (s.deviceId) {
      db.run("UPDATE devices SET last_seen = ? WHERE id = ?", [now(), s.deviceId]);
      broadcast("remote", { status: status() });
    }
  };
}

// ---------- alerts ----------
export type Alert = { t: "needs" | "done" | "clear" | "test"; ws?: string; title?: string; count?: number; at: number };

export async function alertDevices(alert: Alert): Promise<{ sent: number; failed: string[] }> {
  const out = { sent: 0, failed: [] as string[] };
  for (const d of listDevices()) {
    const frame = sealAlert(alertKeyHost(hostPriv(), unb64u(d.pub)), alert);
    try {
      if (d.push_kind === "fcm" && d.push_token && fcmConfigured()) await sendFcm(d.push_token, b64u(frame));
      else await notifyRelay(d.id, frame);
      out.sent++;
    } catch (e) {
      out.failed.push(`${d.name}: ${(e as Error).message}`);
    }
  }
  return out;
}

async function notifyRelay(device: string, frame: Uint8Array) {
  const token = relayToken();
  if (!relayUrl() || !token) throw new Error("no relay set up");
  const r = await fetch(`${relayUrl()}/v1/notify?room=${room()}&device=${device}`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/octet-stream" }, body: frame as Uint8Array<ArrayBuffer>, signal: AbortSignal.timeout(8000) });
  if (r.status === 404) throw new Error("not listening right now");
  if (!r.ok) throw new Error(`relay said ${r.status}`);
}

// approvals waiting → alert; all answered → clear. Phones that are open in the app already see it live.
const waiting = new Map<string, { ws: string; title: string }>();
let alertTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleAlert(t: Alert["t"], ws?: string, title?: string) {
  if (alertTimer) clearTimeout(alertTimer);
  // a short pause: a rule or the user at the computer often answers first
  alertTimer = setTimeout(() => {
    alertTimer = null;
    if (!listDevices().length) return;
    if (t === "needs" && !waiting.size) return;
    alertDevices({ t, ws, title, count: waiting.size, at: now() }).catch(() => {});
  }, t === "needs" ? config().remote?.alert_delay_ms ?? 4000 : 500);
}

export function startRemote() {
  listen((type, raw) => {
    if (type !== "approval_request" && type !== "approval_resolved") return;
    const e = JSON.parse(raw);
    if (type === "approval_request") {
      waiting.set(e.id, { ws: e.parentId ?? e.workspaceId, title: e.parentTitle ?? e.workspaceTitle ?? "" });
      scheduleAlert("needs", e.parentId ?? e.workspaceId, e.parentTitle ?? e.workspaceTitle);
    } else if (waiting.delete(e.id) && !waiting.size) scheduleAlert("clear");
  });
  connect();
}
