import { afterAll, describe, expect, test } from "bun:test";
import type { ServerWebSocket } from "bun";
import { config, loadConfig } from "./config";
import { broadcast } from "./hub";
import { setSecret } from "./secrets";
import { alertDevices, listDevices, pairingLink, reconnect, removeDevice, room, setBridge, startRemote, status } from "./remote";
import { parsePairing, RemoteClient } from "./remote-client";

loadConfig();

// A stand-in for orbit-relay (relay/), following the same endpoints: enough to
// prove Orbit's side; the Go relay has its own tests.
type Sock = ServerWebSocket<{ kind: string; room: string; chan?: string; device?: string; peer?: Sock }>;
const TOKEN = "test-relay-token";
const hosts = new Map<string, Sock>();
const waitingPhones = new Map<string, Sock>();
const waiters = new Map<string, Set<Sock>>();
const relay = Bun.serve({
  port: 0,
  async fetch(req, srv) {
    const u = new URL(req.url);
    const r = u.searchParams.get("room") ?? "";
    const authed = req.headers.get("authorization") === `Bearer ${TOKEN}`;
    if (u.pathname === "/v1/health") return Response.json({ ok: true, version: "test" });
    if (u.pathname === "/v1/notify") {
      if (!authed) return new Response("no", { status: 401 });
      const set = waiters.get(`${r}/${u.searchParams.get("device")}`);
      if (!set?.size) return new Response("none", { status: 404 });
      const body = new Uint8Array(await req.arrayBuffer());
      for (const w of set) w.send(body);
      return new Response(null, { status: 202 });
    }
    const kind = u.pathname.slice(4);
    if ((kind === "host" || kind === "accept") && !authed) return new Response("no", { status: 401 });
    return srv.upgrade(req, { data: { kind, room: r, chan: u.searchParams.get("chan") ?? undefined, device: u.searchParams.get("device") ?? undefined } }) ? undefined : new Response("bad", { status: 400 });
  },
  websocket: {
    open(ws: Sock) {
      const d = ws.data;
      if (d.kind === "host") hosts.set(d.room, ws);
      if (d.kind === "connect") {
        const chan = crypto.randomUUID();
        waitingPhones.set(chan, ws);
        hosts.get(d.room)?.send(JSON.stringify({ type: "open", chan }));
      }
      if (d.kind === "accept") {
        const phone = waitingPhones.get(d.chan!);
        if (!phone) return ws.close(4404);
        waitingPhones.delete(d.chan!);
        phone.data.peer = ws;
        ws.data.peer = phone;
      }
      if (d.kind === "wait") {
        const k = `${d.room}/${d.device}`;
        if (!waiters.has(k)) waiters.set(k, new Set());
        waiters.get(k)!.add(ws);
      }
    },
    message(ws: Sock, m) {
      if (ws.data.kind === "host") return;
      const send = () => ws.data.peer?.send(m);
      // the phone may speak before Orbit has accepted: hold its first message briefly
      if (!ws.data.peer) setTimeout(send, 150);
      else send();
    },
    close(ws: Sock) {
      ws.data.peer?.close();
      for (const s of waiters.values()) s.delete(ws);
    },
  },
});
afterAll(() => relay.stop(true));

const until = async (cond: () => boolean, ms = 3000) => {
  const t = Date.now();
  while (!cond()) {
    if (Date.now() - t > ms) throw new Error("timed out");
    await Bun.sleep(20);
  }
};

describe("remote", () => {
  test("a phone pairs by QR, talks to the API through the relay and gets live events", async () => {
    const seen: string[] = [];
    setBridge({
      api: async (req, url) => {
        seen.push(`${req.method} ${url.pathname}`);
        return Response.json({ ok: true, path: url.pathname, body: req.method === "POST" ? await req.json() : null });
      },
      onMessage: (raw) => seen.push(`msg ${JSON.parse(raw).type}`),
      hello: () => ({ running: 0 }),
    });
    config().remote = { relay_url: `http://localhost:${relay.port}`, name: "Test computer", alert_delay_ms: 50 };
    setSecret("remote.relay_token", TOKEN);
    startRemote();
    await until(() => status().state === "online");

    const link = pairingLink();
    const pairing = parsePairing(link.uri);
    expect(pairing.room).toBe(room());
    const phone = new RemoteClient(pairing);
    const welcome = await phone.connect({ name: "Pixel" });
    expect(welcome).toMatchObject({ t: "welcome", name: "Test computer" });
    expect(listDevices().map((d) => d.name)).toEqual(["Pixel"]);

    const r = await phone.request("POST", "/api/workspaces", { title: "From the phone" });
    expect(r).toMatchObject({ status: 200, body: { path: "/api/workspaces", body: { title: "From the phone" } } });
    expect((await phone.request("GET", "/api/remote")).status).toBe(403);

    const events: any[] = [];
    phone.onEvent = (e) => events.push(e);
    phone.subscribe();
    await until(() => events.some((e) => e.type === "hello"));
    broadcast("workspace", { workspace: { id: "w_1" } });
    await until(() => events.some((e) => e.type === "workspace"));
    phone.send({ t: "msg", m: { type: "approval", id: "a1", decision: "allow" } });
    await until(() => seen.includes("msg approval"));
    phone.close();
  });

  test("the pairing code works once; an unknown phone without one is refused", async () => {
    const pairing = parsePairing(pairingLink().uri);
    const a = new RemoteClient(pairing);
    await a.connect();
    a.close();
    const b = new RemoteClient(pairing);
    await expect(b.connect()).rejects.toThrow(/expired|not paired/);
    const c = new RemoteClient({ ...pairing, code: undefined });
    await expect(c.connect()).rejects.toThrow(/not paired/);
    // a known phone comes back without a code
    const again = new RemoteClient({ ...pairing, code: undefined }, a.device);
    await expect(again.connect()).resolves.toMatchObject({ t: "welcome" });
    again.close();
    removeDevice(a.deviceId);
  });

  test("an approval reaches a waiting phone as a sealed alert, then clears", async () => {
    for (const d of listDevices()) removeDevice(d.id);
    const pairing = parsePairing(pairingLink().uri);
    const phone = new RemoteClient(pairing);
    await phone.connect({ push: { kind: "relay" } });
    phone.close();
    const got: any[] = [];
    const raw: Uint8Array[] = [];
    const w = new WebSocket(`ws://localhost:${relay.port}/v1/wait?room=${pairing.room}&device=${phone.deviceId}`);
    w.binaryType = "arraybuffer";
    w.onmessage = (m) => {
      raw.push(new Uint8Array(m.data as ArrayBuffer));
      got.push(phone.openAlert(new Uint8Array(m.data as ArrayBuffer)));
    };
    await new Promise((r) => (w.onopen = r));
    broadcast("approval_request", { id: "c1", workspaceId: "w_9", workspaceTitle: "Backups" });
    await until(() => got.length === 1);
    expect(got[0]).toMatchObject({ t: "needs", ws: "w_9", title: "Backups", count: 1 });
    expect(Buffer.from(raw[0]).includes(Buffer.from("Backups"))).toBe(false);
    broadcast("approval_resolved", { id: "c1", workspaceId: "w_9" });
    await until(() => got.length === 2);
    expect(got[1].t).toBe("clear");
    w.close();
    const res = await alertDevices({ t: "test", at: Date.now() });
    expect(res.failed[0]).toMatch(/not listening/);
  });

  test("a wrong relay token shows as an error, a right one reconnects", async () => {
    setSecret("remote.relay_token", "wrong");
    reconnect();
    await until(() => status().state === "error");
    setSecret("remote.relay_token", TOKEN);
    reconnect();
    await until(() => status().state === "online");
  });
});
