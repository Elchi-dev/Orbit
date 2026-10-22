// The phone's side of docs/REMOTE.md in TypeScript: the reference other clients
// follow, and what the tests use to talk to Orbit through a relay.

import { randomBytes } from "node:crypto";
import { alertKeyPhone, b64u, deviceIdOf, newKeyPair, Opener, openAlert, pubOf, Sealer, sessionKeysPhone, unb64u, type KeyPair } from "./e2e";

export interface Pairing {
  relay: string;
  room: string;
  h: string;
  code?: string;
  name?: string;
}

export function parsePairing(uri: string): Pairing {
  const u = new URL(uri.replace(/^orbit:\/\//, "https://orbit/"));
  const q = u.searchParams;
  if (q.get("v") !== "1") throw new Error("Unsupported pairing version");
  return { relay: q.get("relay")!, room: q.get("room")!, h: q.get("h")!, code: q.get("code") ?? undefined, name: q.get("name") ?? undefined };
}

export class RemoteClient {
  private ws: WebSocket | null = null;
  private up: Sealer | null = null;
  private down: Opener | null = null;
  private nextId = 1;
  private pending = new Map<number, (r: { status: number; body: any }) => void>();
  onEvent: (e: any) => void = () => {};

  constructor(
    public pairing: Pairing,
    public device: KeyPair = newKeyPair(),
  ) {}

  get deviceId() {
    return deviceIdOf(this.device.pub);
  }

  /** Opens a pipe, does the handshake and resolves with Orbit's welcome. */
  connect(opts: { name?: string; push?: unknown; usePairingCode?: boolean } = {}): Promise<any> {
    const { relay, room, h } = this.pairing;
    const ws = new WebSocket(`${relay.replace(/^http/, "ws")}/v1/connect?room=${room}`);
    ws.binaryType = "arraybuffer";
    this.ws = ws;
    return new Promise((resolve, reject) => {
      ws.onopen = () => {
        const e = newKeyPair();
        const n = new Uint8Array(randomBytes(16));
        const k = sessionKeysPhone(e.priv, this.device.priv, unb64u(h), n);
        this.up = new Sealer(k.up);
        this.down = new Opener(k.down);
        ws.send(JSON.stringify({ v: 1, d: b64u(this.device.pub), e: b64u(e.pub), n: b64u(n) }));
        this.send({ t: "hello", name: opts.name ?? "Test phone", app: "test", push: opts.push ?? { kind: "relay" }, ...(opts.usePairingCode !== false && this.pairing.code ? { code: this.pairing.code } : {}) });
      };
      ws.onmessage = (m) => {
        if (typeof m.data === "string") return;
        const msg = this.down!.open(new Uint8Array(m.data as ArrayBuffer));
        if (msg.t === "welcome") return resolve(msg);
        if (msg.t === "denied") return reject(new Error(msg.reason));
        if (msg.t === "res") {
          this.pending.get(msg.id)?.(msg);
          this.pending.delete(msg.id);
        }
        if (msg.t === "ev") this.onEvent(msg.e);
      };
      ws.onclose = (e) => reject(new Error(`closed ${e.code} ${e.reason}`));
      ws.onerror = () => {};
    });
  }

  send(msg: unknown) {
    this.ws!.send(this.up!.seal(msg) as Uint8Array<ArrayBuffer>);
  }

  request(method: string, path: string, body: unknown = null): Promise<{ status: number; body: any }> {
    const id = this.nextId++;
    return new Promise((resolve) => {
      this.pending.set(id, resolve);
      this.send({ t: "req", id, method, path, body });
    });
  }

  subscribe() {
    this.send({ t: "sub" });
  }

  close() {
    this.ws?.close();
  }

  /** Opens an alert frame from the relay or Firebase. */
  openAlert(frame: Uint8Array) {
    return openAlert(alertKeyPhone(this.device.priv, unb64u(this.pairing.h)), frame);
  }

  static publicKeyOf(priv: Uint8Array) {
    return pubOf(priv);
  }
}
