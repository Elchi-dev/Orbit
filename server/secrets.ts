import { join } from "node:path";
import { existsSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { ORBIT_DIR } from "./config";
import { db } from "./db";

// The API key is encrypted at rest with a per-machine master key (0600 file in ~/.orbit).
// It never reaches the browser and never appears in logs.
const KEY_PATH = join(ORBIT_DIR, "master.key");

function masterKey(): Buffer {
  if (!existsSync(KEY_PATH)) {
    writeFileSync(KEY_PATH, randomBytes(32));
    try {
      chmodSync(KEY_PATH, 0o600);
    } catch {}
  }
  return readFileSync(KEY_PATH);
}

export function setSecret(name: string, value: string) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", masterKey(), iv);
  const data = Buffer.concat([c.update(value, "utf8"), c.final(), c.getAuthTag()]);
  db.run("INSERT OR REPLACE INTO secrets (name, iv, data) VALUES (?,?,?)", [name, iv, data]);
}

export function getSecret(name: string): string | null {
  const row = db.query<{ iv: Uint8Array; data: Uint8Array }, [string]>("SELECT iv, data FROM secrets WHERE name = ?").get(name);
  if (!row) return null;
  try {
    const buf = Buffer.from(row.data);
    const d = createDecipheriv("aes-256-gcm", masterKey(), Buffer.from(row.iv));
    d.setAuthTag(buf.subarray(buf.length - 16));
    return Buffer.concat([d.update(buf.subarray(0, buf.length - 16)), d.final()]).toString("utf8");
  } catch {
    return null;
  }
}

export function deleteSecret(name: string) {
  db.run("DELETE FROM secrets WHERE name = ?", [name]);
}

export function apiKey(): string | null {
  return getSecret("anthropic") ?? process.env.ANTHROPIC_API_KEY ?? null;
}
