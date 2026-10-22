// Fixed inputs and the outputs Orbit computes for them (docs/remote-vectors.json).
// The phone app's tests must reproduce every value. `--check` fails if they changed.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { alertKeyHost, b64u, deviceIdOf, Opener, pubOf, roomOf, sealAlert, Sealer, sessionKeysHost } from "../server/e2e";

const fill = (v: number) => new Uint8Array(32).map((_, i) => (v + i * 7) & 0xff);
const hPriv = fill(1), dPriv = fill(2), ePriv = fill(3);
const H = pubOf(hPriv), D = pubOf(dPriv), E = pubOf(ePriv);
const n = new Uint8Array(16).map((_, i) => i);
const k = sessionKeysHost(hPriv, D, E, n);
const hello = { t: "hello", name: "Test phone" };
const welcome = { t: "welcome", name: "Test computer", version: "0.5.0" };
const up = new Sealer(k.up), down = new Sealer(k.down);
const helloSealed = up.seal(hello), second = up.seal({ t: "ping" });
const welcomeSealed = down.seal(welcome);
new Opener(k.up).open(helloSealed);
const alertKey = alertKeyHost(hPriv, D);
const alert = { t: "needs", ws: "w_test", title: "Backups", count: 1, at: 1761200000000 };
const alertNonce = new Uint8Array(12).fill(9);
const vectors = {
  note: "Byte strings are base64url without padding. Plaintexts are the exact UTF-8 strings sealed.",
  host_priv: b64u(hPriv), host_pub: b64u(H),
  device_priv: b64u(dPriv), device_pub: b64u(D),
  ephemeral_priv: b64u(ePriv), ephemeral_pub: b64u(E),
  n: b64u(n),
  room: roomOf(H), device_id: deviceIdOf(D),
  k_up: b64u(k.up), k_down: b64u(k.down),
  up_0_plain: JSON.stringify(hello), up_0_sealed: b64u(helloSealed),
  up_1_plain: JSON.stringify({ t: "ping" }), up_1_sealed: b64u(second),
  down_0_plain: JSON.stringify(welcome), down_0_sealed: b64u(welcomeSealed),
  alert_key: b64u(alertKey), alert_plain: JSON.stringify(alert), alert_nonce: b64u(alertNonce), alert_sealed: b64u(sealAlert(alertKey, alert, alertNonce)),
};
const out = join(import.meta.dir, "..", "docs", "remote-vectors.json");
const text = JSON.stringify(vectors, null, 2) + "\n";
if (process.argv.includes("--check")) {
  if (!existsSync(out) || readFileSync(out, "utf8") !== text) {
    console.error("docs/remote-vectors.json changed: the protocol math moved. Run bun scripts/gen-remote-vectors.ts if that is intended.");
    process.exit(1);
  }
  console.log("remote vectors unchanged");
} else {
  writeFileSync(out, text);
  console.log("wrote docs/remote-vectors.json");
}
