// End to end encryption between Orbit and a paired phone (docs/REMOTE.md):
// X25519 for keys, HKDF-SHA256 to derive, AES-256-GCM to seal. The relay in
// between only ever sees what these functions produce.

import { createCipheriv, createDecipheriv, createHash, createPrivateKey, createPublicKey, diffieHellman, generateKeyPairSync, hkdfSync, randomBytes, type KeyObject } from "node:crypto";

export const b64u = (b: Uint8Array) => Buffer.from(b).toString("base64url");
export const unb64u = (s: string) => new Uint8Array(Buffer.from(s, "base64url"));

export interface KeyPair {
  /** 32 raw bytes */
  priv: Uint8Array;
  pub: Uint8Array;
}

export function newKeyPair(): KeyPair {
  const k = generateKeyPairSync("x25519");
  const j = k.privateKey.export({ format: "jwk" }) as { d: string; x: string };
  return { priv: unb64u(j.d), pub: unb64u(j.x) };
}

/** The public key for a private one (also clamps nothing: X25519 does that itself). */
export function pubOf(priv: Uint8Array): Uint8Array {
  const k = createPrivateKey({ key: { kty: "OKP", crv: "X25519", d: b64u(priv), x: b64u(new Uint8Array(32)) }, format: "jwk" });
  const j = createPublicKey(k).export({ format: "jwk" }) as { x: string };
  return unb64u(j.x);
}

const privKey = (priv: Uint8Array): KeyObject => createPrivateKey({ key: { kty: "OKP", crv: "X25519", d: b64u(priv), x: b64u(pubOf(priv)) }, format: "jwk" });
const pubKey = (pub: Uint8Array): KeyObject => createPublicKey({ key: { kty: "OKP", crv: "X25519", x: b64u(pub) }, format: "jwk" });

export function x25519(priv: Uint8Array, pub: Uint8Array): Uint8Array {
  if (pub.length !== 32) throw new Error("bad public key");
  const s = new Uint8Array(diffieHellman({ privateKey: privKey(priv), publicKey: pubKey(pub) }));
  if (s.every((b) => b === 0)) throw new Error("bad public key");
  return s;
}

export const hkdf = (ikm: Uint8Array, salt: Uint8Array, info: Uint8Array, len: number) => new Uint8Array(hkdfSync("sha256", ikm, salt, info, len));
const cat = (...parts: Uint8Array[]) => new Uint8Array(Buffer.concat(parts));
const utf8 = (s: string) => new Uint8Array(Buffer.from(s, "utf8"));

/** A room is the relay's name for one Orbit: the first 22 characters of base64url(SHA-256(H)). */
export const roomOf = (hostPub: Uint8Array) => b64u(createHash("sha256").update(hostPub).digest()).slice(0, 22);
/** A device id, the same way from the phone's public key. */
export const deviceIdOf = (devicePub: Uint8Array) => roomOf(devicePub);

export interface SessionKeys {
  up: Uint8Array;
  down: Uint8Array;
}

/**
 * Both sides of the handshake. Orbit passes (hostPriv, D, E); the phone passes
 * its own two private keys through `phoneKeys` instead.
 */
export function sessionKeysHost(hostPriv: Uint8Array, D: Uint8Array, E: Uint8Array, n: Uint8Array): SessionKeys {
  const H = pubOf(hostPriv);
  const s1 = x25519(hostPriv, E);
  const s2 = x25519(hostPriv, D);
  return derive(s1, s2, n, H, D, E);
}
export function sessionKeysPhone(ePriv: Uint8Array, dPriv: Uint8Array, H: Uint8Array, n: Uint8Array): SessionKeys {
  const s1 = x25519(ePriv, H);
  const s2 = x25519(dPriv, H);
  return derive(s1, s2, n, H, pubOf(dPriv), pubOf(ePriv));
}
function derive(s1: Uint8Array, s2: Uint8Array, n: Uint8Array, H: Uint8Array, D: Uint8Array, E: Uint8Array): SessionKeys {
  const okm = hkdf(cat(s1, s2), n, cat(utf8("orbit-e2e-v1"), H, D, E), 64);
  return { up: okm.slice(0, 32), down: okm.slice(32, 64) };
}

function gcmSeal(key: Uint8Array, nonce: Uint8Array, plain: Uint8Array) {
  const c = createCipheriv("aes-256-gcm", key, nonce);
  return cat(new Uint8Array(c.update(plain)), new Uint8Array(c.final()), new Uint8Array(c.getAuthTag()));
}
function gcmOpen(key: Uint8Array, nonce: Uint8Array, sealed: Uint8Array) {
  if (sealed.length < 16) throw new Error("too short");
  const d = createDecipheriv("aes-256-gcm", key, nonce);
  d.setAuthTag(sealed.subarray(sealed.length - 16));
  return cat(new Uint8Array(d.update(sealed.subarray(0, sealed.length - 16))), new Uint8Array(d.final()));
}

const counterNonce = (n: bigint) => {
  const b = new Uint8Array(12);
  new DataView(b.buffer).setBigUint64(4, n);
  return b;
};

/** One direction of a session: seals with a counter nonce, and opens only the next counter. */
export class Sealer {
  private n = 0n;
  constructor(private key: Uint8Array) {}
  seal(msg: unknown): Uint8Array {
    return gcmSeal(this.key, counterNonce(this.n++), utf8(JSON.stringify(msg)));
  }
}
export class Opener {
  private n = 0n;
  constructor(private key: Uint8Array) {}
  open(frame: Uint8Array): any {
    const plain = gcmOpen(this.key, counterNonce(this.n), frame);
    this.n++;
    return JSON.parse(Buffer.from(plain).toString("utf8"));
  }
}

// ---------- alerts ----------
export const alertKeyHost = (hostPriv: Uint8Array, D: Uint8Array) => hkdf(x25519(hostPriv, D), utf8("orbit-alert"), cat(pubOf(hostPriv), D), 32);
export const alertKeyPhone = (dPriv: Uint8Array, H: Uint8Array) => hkdf(x25519(dPriv, H), utf8("orbit-alert"), cat(H, pubOf(dPriv)), 32);

export function sealAlert(key: Uint8Array, msg: unknown, nonce = new Uint8Array(randomBytes(12))): Uint8Array {
  return cat(nonce, gcmSeal(key, nonce, utf8(JSON.stringify(msg))));
}
export function openAlert(key: Uint8Array, frame: Uint8Array): any {
  return JSON.parse(Buffer.from(gcmOpen(key, frame.subarray(0, 12), frame.subarray(12))).toString("utf8"));
}
