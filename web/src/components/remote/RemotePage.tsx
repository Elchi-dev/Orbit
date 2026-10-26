import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Bell, Check, Copy, ExternalLink, Loader2, Plug, QrCode, RefreshCw, Send, Server, Smartphone, Trash2, X } from "lucide-react";
import qrcode from "qrcode-generator";
import { api } from "../../lib/api";
import { useStore } from "../../lib/store";
import { Ori, type OriPose } from "../ori/Ori";
import { Galaxy } from "../ui/Galaxy";

interface Device {
  id: string;
  name: string;
  app: string;
  push_kind: string;
  last_seen: number;
  online: boolean;
}
interface Status {
  state: "off" | "connecting" | "online" | "error";
  error: string;
  relay: string;
  room: string;
  name: string;
  hasToken: boolean;
  fcm: boolean;
  devices: Device[];
}

// the app that matches this Orbit; a development build points at the list of releases
const apk = (version?: string) => (version && /^\d+\.\d+\.\d+/.test(version) ? `https://github.com/Elchi-dev/Orbit/releases/download/v${version}/orbit-android.apk` : "https://github.com/Elchi-dev/Orbit/releases");
const INSTALL = (domain: string) => `curl -fsSL https://raw.githubusercontent.com/Elchi-dev/Orbit/main/relay/install.sh | sudo sh -s -- --domain ${domain || "relay.example.com"}`;
const ago = (t: number) => {
  const s = (Date.now() - t) / 1000;
  return s < 90 ? "just now" : s < 5400 ? `${Math.round(s / 60)} min ago` : s < 129600 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} days ago`;
};

function useRemote() {
  const [st, setSt] = useState<Status | null>(null);
  useEffect(() => {
    api.get<Status>("/api/remote").then(setSt);
    const on = (e: Event) => setSt((e as CustomEvent).detail);
    window.addEventListener("orbit:remote", on);
    return () => window.removeEventListener("orbit:remote", on);
  }, []);
  return [st, setSt] as const;
}

function Copyable({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className="rm-code">
      <code>{text}</code>
      <button
        className="btn b-ghost icon-btn sm"
        aria-label={`Copy ${label}`}
        data-tip={done ? "Copied" : "Copy"}
        onClick={() => {
          navigator.clipboard?.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1400);
        }}
      >
        {done ? <Check size={15} /> : <Copy size={15} />}
      </button>
    </div>
  );
}

/** Settings, Remote: the relay, pairing a phone, and alerts. */
export function RemotePage() {
  const [st, setSt] = useRemote();
  const [editing, setEditing] = useState(false);
  if (!st) return <Loader2 className="spin" size={18} />;
  const pose: OriPose = st.state === "online" ? (st.devices.length ? "done" : "hi") : st.state === "error" ? "oops" : st.state === "connecting" ? "thinking" : "searching";
  const setUp = !!st.relay && st.hasToken;

  return (
    <div className="rm">
      <header className="lib-head">
        <div>
          <h2>Your phone</h2>
          <p className="muted">Reach this Orbit from anywhere with the Orbit app. A small relay you run passes sealed messages between the two; it can't read them, and nothing opens on your home network.</p>
        </div>
        <Ori pose={pose} size={68} />
      </header>

      <section className="rm-sec">
        <div className="rm-sec-head">
          <h3>
            <Server size={16} /> Relay
          </h3>
          <span className={`rm-state s-${st.state}`}>
            <i />
            {st.state === "online" ? "Online" : st.state === "connecting" ? "Connecting" : st.state === "error" ? "Can't reach it" : "Not set up"}
          </span>
        </div>
        {st.state === "error" && st.error && <p className="bad-text small">{st.error}</p>}
        {setUp && !editing ? (
          <div className="rm-relay">
            <code>{st.relay}</code>
            <button className="btn b-ghost sz-s" onClick={() => api.post<Status>("/api/remote/reconnect", {}).then(setSt)}>
              <RefreshCw size={14} /> Reconnect
            </button>
            <button className="btn b-ghost sz-s" onClick={() => setEditing(true)}>
              Change
            </button>
          </div>
        ) : (
          <RelaySetup st={st} onDone={(s) => (setSt(s), setEditing(false))} onCancel={setUp ? () => setEditing(false) : undefined} />
        )}
      </section>

      <section className={`rm-sec ${setUp ? "" : "is-locked"}`} aria-disabled={!setUp}>
        <div className="rm-sec-head">
          <h3>
            <Smartphone size={16} /> Phones
          </h3>
          <a className="lnk small" href={apk(useStore.getState().server?.version)} target="_blank" rel="noreferrer">
            Get the Android app <ExternalLink size={12} />
          </a>
        </div>
        <Phones st={st} setSt={setSt} disabled={!setUp || st.state !== "online"} />
      </section>

      <section className={`rm-sec ${st.devices.length ? "" : "is-locked"}`}>
        <div className="rm-sec-head">
          <h3>
            <Bell size={16} /> Alerts
          </h3>
        </div>
        <Alerts st={st} setSt={setSt} />
      </section>
    </div>
  );
}

function RelaySetup({ st, onDone, onCancel }: { st: Status; onDone: (s: Status) => void; onCancel?: () => void }) {
  const [domain, setDomain] = useState(st.relay.replace(/^https?:\/\//, ""));
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [open, setOpen] = useState(st.relay ? 4 : 1);
  const cleanDomain = domain.trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "");

  async function connect() {
    setBusy(true);
    setErr("");
    try {
      onDone(await api.put<Status>("/api/remote", { relay_url: cleanDomain.startsWith("localhost") || cleanDomain.startsWith("127.") ? `http://${cleanDomain}` : `https://${cleanDomain}`, token }));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const steps = [
    {
      title: "A small server",
      body: (
        <p>
          Any Linux server with a public address works: the cheapest VPS of most providers is plenty. Ubuntu or Debian is easiest. It needs ports 80 and 443 free (or put it behind the web server you already run; the relay's README shows how).
        </p>
      ),
    },
    {
      title: "Point a name at it",
      body: (
        <>
          <p>At your domain's DNS, add an A record (and AAAA for IPv6) for a subdomain, pointing at the server's address:</p>
          <label className="set-field">
            <span className="form-label">Relay address</span>
            <div className="field">
              <input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="relay.example.com" spellCheck={false} autoCapitalize="off" />
            </div>
          </label>
        </>
      ),
    },
    {
      title: "Install the relay",
      body: (
        <>
          <p>On the server, as a user who can sudo, run this one line. It installs the relay as a service, gets a certificate, and prints a token at the end.</p>
          <Copyable text={INSTALL(cleanDomain)} label="install command" />
          <p className="muted small">Running it again later updates the relay and keeps the token.</p>
        </>
      ),
    },
    {
      title: "Connect Orbit to it",
      body: (
        <form
          className="rm-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (cleanDomain && token.trim()) connect();
          }}
        >
          <label className="set-field">
            <span className="form-label">Relay address</span>
            <div className="field">
              <input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="relay.example.com" spellCheck={false} autoCapitalize="off" />
            </div>
          </label>
          <label className="set-field">
            <span className="form-label">Relay token</span>
            <div className={`field ${err ? "shake" : ""}`}>
              <input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder={st.hasToken ? "Saved; paste a new one to change it" : "The token the installer printed"} autoComplete="off" />
            </div>
            <span className="muted small">Kept encrypted on this computer. Forgot it? On the server: sudo orbit-relay token</span>
          </label>
          {err && <p className="bad-text small">{err}</p>}
          <div className="lib-actions">
            <button className="btn b-peach sz-m gbtn" disabled={!cleanDomain || (!token.trim() && !st.hasToken) || busy}>
              <Galaxy />
              <span className="lbl">{busy ? <Loader2 size={16} className="spin" /> : <Plug size={16} />} Connect</span>
            </button>
            {onCancel && (
              <button type="button" className="btn b-ghost sz-m" onClick={onCancel}>
                Cancel
              </button>
            )}
          </div>
        </form>
      ),
    },
  ];

  return (
    <ol className="rm-steps">
      {steps.map((s, i) => {
        const n = i + 1;
        const isOpen = open === n;
        return (
          <li key={n} className={`rm-step ${isOpen ? "open" : ""} ${open > n ? "done" : ""}`}>
            <button className="btn rm-step-head" onClick={() => setOpen(n)} aria-expanded={isOpen}>
              <span className="rm-num">{open > n ? <Check size={13} /> : n}</span>
              <b>{s.title}</b>
            </button>
            <AnimatePresence initial={false}>
              {isOpen && (
                <motion.div className="rm-step-body" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ type: "spring", stiffness: 300, damping: 32 }}>
                  <div className="rm-step-inner">
                    {s.body}
                    {n < 4 && (
                      <button className="btn b-outline sz-s rm-next" onClick={() => setOpen(n + 1)}>
                        {n === 3 ? "It printed a token" : "Done"} <Check size={14} />
                      </button>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </li>
        );
      })}
    </ol>
  );
}

function Qr({ text }: { text: string }) {
  const svg = useMemo(() => {
    const q = qrcode(0, "M");
    q.addData(text);
    q.make();
    const n = q.getModuleCount();
    let d = "";
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) d += `M${c + 4},${r + 4}h1v1h-1z`;
    return { n: n + 8, d };
  }, [text]);
  return (
    <svg className="rm-qr" viewBox={`0 0 ${svg.n} ${svg.n}`} role="img" aria-label="Pairing QR code" shapeRendering="crispEdges">
      <rect width={svg.n} height={svg.n} fill="#FFF6E6" />
      <path d={svg.d} fill="#0B0B14" />
    </svg>
  );
}

function Phones({ st, setSt, disabled }: { st: Status; setSt: (s: Status) => void; disabled: boolean }) {
  const toast = useStore((s) => s.toast);
  const [pair, setPair] = useState<{ uri: string; expires: number; before: number } | null>(null);
  const [now, setNow] = useState(Date.now());
  const paired = pair && st.devices.length > pair.before;
  useEffect(() => {
    if (!pair) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [pair]);
  useEffect(() => {
    if (paired) {
      const t = setTimeout(() => setPair(null), 2600);
      return () => clearTimeout(t);
    }
  }, [paired]);
  const left = pair ? Math.max(0, Math.round((pair.expires - now) / 1000)) : 0;

  return (
    <>
      {st.devices.length === 0 && !pair && <p className="muted small">No phone paired yet.</p>}
      <div className="rm-devices">
        {st.devices.map((d, i) => (
          <div key={d.id} className="rm-device rise" style={{ "--i": i } as any}>
            <span className={`rm-dot ${d.online ? "on" : ""}`} aria-label={d.online ? "Connected now" : "Not connected"} />
            <span className="rm-dev-main">
              <b>{d.name}</b>
              <span className="muted small">
                {d.online ? "Connected now" : `Last seen ${ago(d.last_seen)}`}
                {d.app ? `, app ${d.app}` : ""}, alerts {d.push_kind === "fcm" ? "by Firebase" : "through the relay"}
              </span>
            </span>
            <button
              className="btn b-ghost sz-s danger-hover"
              onClick={async () => {
                setSt(await api.del<Status>(`/api/remote/devices/${d.id}`));
                toast({ title: `${d.name} removed`, body: "It can't reach this Orbit any more.", tone: "info" });
              }}
            >
              <Trash2 size={14} /> Remove
            </button>
          </div>
        ))}
      </div>
      <AnimatePresence mode="wait">
        {pair ? (
          <motion.div key="qr" className="rm-pair" initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.97 }} transition={{ type: "spring", stiffness: 280, damping: 26 }}>
            {paired ? (
              <div className="rm-paired">
                <Ori pose="done" size={110} />
                <b>Paired!</b>
                <span className="muted small">{st.devices[0]?.name} can reach this Orbit now.</span>
              </div>
            ) : left > 0 ? (
              <>
                <Qr text={pair.uri} />
                <div className="rm-pair-side">
                  <b>Scan this with the Orbit app</b>
                  <ol className="small">
                    <li>Open Orbit on your phone.</li>
                    <li>Tap Pair and point the camera here.</li>
                    <li>This page says so when it worked.</li>
                  </ol>
                  <span className="muted small">
                    Works once, for {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")} more. Anyone who scans it can pair, so don't share it.
                  </span>
                  <button className="btn b-ghost sz-s" onClick={() => setPair(null)}>
                    <X size={14} /> Cancel
                  </button>
                </div>
              </>
            ) : (
              <div className="rm-paired">
                <span className="muted small">That code expired.</span>
                <button className="btn b-outline sz-s" onClick={() => setPair(null)}>
                  Close
                </button>
              </div>
            )}
          </motion.div>
        ) : (
          <motion.div key="btn" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <button
              className="btn b-peach sz-m"
              disabled={disabled}
              onClick={async () => {
                const p = await api.post<{ uri: string; expires: number }>("/api/remote/pair", {});
                setPair({ ...p, before: st.devices.length });
              }}
            >
              <QrCode size={16} /> Pair a phone
            </button>
            {disabled && <span className="muted small rm-hint">Connect a relay first.</span>}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

function Alerts({ st, setSt }: { st: Status; setSt: (s: Status) => void }) {
  const toast = useStore((s) => s.toast);
  const [json, setJson] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [showFcm, setShowFcm] = useState(false);

  return (
    <>
      <p className="small">
        When Claude needs your approval, a paired phone gets an alert after a few seconds, unless you answered here first. Alerts carry nothing readable: the app fetches the details over the encrypted connection.
      </p>
      <ul className="rm-modes small">
        <li>
          <b>Through the relay</b>: works with every build of the app. The app keeps one small connection to your relay.
        </li>
        <li>
          <b>Firebase</b>: for builds of the app with your Firebase project. No background connection.{" "}
          {st.fcm ? (
            <span className="chip chip-ui">
              <Check size={12} /> key saved
            </span>
          ) : null}
        </li>
      </ul>
      <div className="lib-actions">
        <button
          className="btn b-outline sz-s"
          disabled={!st.devices.length || busy}
          onClick={async () => {
            setBusy(true);
            try {
              const r = await api.post<{ sent: number; failed: string[] }>("/api/remote/test", {});
              toast(r.failed.length ? { title: `Sent ${r.sent}, ${r.failed.length} didn't arrive`, body: r.failed.join("\n"), tone: "warn" } : { title: "Test alert sent", body: "Check your phone.", tone: "good" });
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? <Loader2 size={14} className="spin" /> : <Send size={14} />} Send a test alert
        </button>
        <button className="btn b-ghost sz-s" onClick={() => setShowFcm((s) => !s)} aria-expanded={showFcm}>
          {st.fcm ? "Firebase key" : "Set up Firebase"}
        </button>
      </div>
      <AnimatePresence initial={false}>
        {showFcm && (
          <motion.div className="rm-fcm" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}>
            <ol className="small">
              <li>In the Firebase console, open your project, then Project settings, Service accounts.</li>
              <li>Click Generate new private key. A JSON file downloads.</li>
              <li>Paste its whole content here. It's kept encrypted on this computer and only used to send alerts.</li>
            </ol>
            <textarea className="lib-req" value={json} onChange={(e) => setJson(e.target.value)} placeholder='{"type": "service_account", ...}' spellCheck={false} aria-label="Service account key" />
            {err && <p className="bad-text small">{err}</p>}
            <div className="lib-actions">
              <button
                className="btn b-peach sz-s"
                disabled={!json.trim()}
                onClick={async () => {
                  setErr("");
                  try {
                    const r = await api.put<Status & { project: string }>("/api/remote/fcm", { json });
                    setSt(r);
                    setJson("");
                    setShowFcm(false);
                    toast({ title: "Firebase key saved", body: `Project ${r.project}`, tone: "good" });
                  } catch (e) {
                    setErr((e as Error).message);
                  }
                }}
              >
                <Check size={14} /> Save key
              </button>
              {st.fcm && (
                <button className="btn b-ghost sz-s danger-hover" onClick={async () => setSt(await api.del<Status>("/api/remote/fcm"))}>
                  <Trash2 size={14} /> Remove key
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
