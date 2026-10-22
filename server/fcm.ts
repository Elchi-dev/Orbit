// Firebase Cloud Messaging, sent straight from Orbit with the project's service
// account key (kept encrypted in the secrets store). Only sealed alerts go out.

import { createSign } from "node:crypto";
import { getSecret, setSecret, deleteSecret } from "./secrets";

interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
}

function account(): ServiceAccount | null {
  const raw = getSecret("remote.fcm");
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
export const fcmConfigured = () => !!account();
export const fcmProject = () => account()?.project_id ?? null;

/** Checks the pasted JSON is a service account key before keeping it. */
export function setFcmAccount(json: string) {
  let a: any;
  try {
    a = JSON.parse(json);
  } catch {
    throw new Error("That isn't JSON. Paste the whole file you downloaded.");
  }
  if (a?.type !== "service_account" || !a.project_id || !a.client_email || !String(a.private_key ?? "").includes("PRIVATE KEY"))
    throw new Error("That isn't a service account key. In Firebase: Project settings, Service accounts, Generate new private key.");
  setSecret("remote.fcm", JSON.stringify({ project_id: a.project_id, client_email: a.client_email, private_key: a.private_key }));
  token = null;
  return a.project_id as string;
}
export function clearFcm() {
  deleteSecret("remote.fcm");
  token = null;
}

let token: { value: string; until: number } | null = null;
const b64u = (s: string | Buffer) => Buffer.from(s).toString("base64url");

async function accessToken(a: ServiceAccount) {
  if (token && token.until > Date.now() + 60_000) return token.value;
  const now = Math.floor(Date.now() / 1000);
  const head = b64u(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64u(JSON.stringify({ iss: a.client_email, scope: "https://www.googleapis.com/auth/firebase.messaging", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 }));
  const sig = createSign("RSA-SHA256").update(`${head}.${claims}`).sign(a.private_key).toString("base64url");
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${head}.${claims}.${sig}` }),
    signal: AbortSignal.timeout(10000),
  });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error(`Google refused the key: ${j.error_description ?? j.error ?? r.status}`);
  token = { value: j.access_token, until: Date.now() + (Number(j.expires_in) || 3600) * 1000 };
  return token.value;
}

/** Sends one sealed alert as a data message; the app opens and shows it itself. */
export async function sendFcm(deviceToken: string, sealed: string) {
  const a = account();
  if (!a) throw new Error("Firebase is not set up");
  const r = await fetch(`https://fcm.googleapis.com/v1/projects/${a.project_id}/messages:send`, {
    method: "POST",
    headers: { authorization: `Bearer ${await accessToken(a)}`, "content-type": "application/json" },
    body: JSON.stringify({ message: { token: deviceToken, data: { orbit: sealed }, android: { priority: "high", ttl: "600s" } } }),
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) {
    const j: any = await r.json().catch(() => ({}));
    throw new Error(j?.error?.message ?? `Firebase said ${r.status}`);
  }
}
