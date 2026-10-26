# Remote: Orbit on your phone, away from home

<p align="center"><img src="images/ori/searching.svg" width="140" alt="Ori looking through a telescope"></p>

Orbit runs on your computer. The Orbit app on your phone reaches it from
anywhere through a **relay**: a small server you run (one line to install) that
passes sealed messages between the two. The relay cannot read them: your phone
and your computer agree on keys when you pair them by QR code, and everything
after that is encrypted end to end. Someone who took over the relay would see
only noise and could not control your computer.

Nothing opens on your home network. Orbit connects out to the relay, the phone
connects to the relay, and the relay joins the two.

This page is for people setting it up and for people writing a client. The
in-app guide (Settings, Your phone) walks through the same steps.

## Setting up a relay

You need a small Linux server with a public IP (any cheap VPS works) and a
domain or subdomain pointing at it.

1. Point a DNS record at the server: an `A` record for `relay.example.com`
   with the server's IPv4 address (and `AAAA` for IPv6 if it has one).
2. On the server, run:
   ```sh
   curl -fsSL https://raw.githubusercontent.com/Elchi-dev/Orbit/main/relay/install.sh | sudo sh -s -- --domain relay.example.com
   ```
   It installs `orbit-relay` as a system service under its own user, gets a
   certificate from Let's Encrypt (ports 80 and 443 must be reachable) and
   prints a **relay token**.
3. In Orbit, Settings, Your phone: paste the relay address and the token. Orbit
   connects and shows the relay as online.
4. Pair your phone: open the Orbit app, tap Pair, scan the QR code Orbit shows.

Already running nginx or Caddy on 443? Use `--behind-proxy --port 8787` and
proxy `relay.example.com` to `127.0.0.1:8787` with websockets allowed.

Update: run the same line again. Remove: `sudo orbit-relay uninstall`.

## Alerts

When Claude needs your approval, the phone gets an alert even when the app is
closed. Two ways, chosen in the app:

- **Through the relay** (works for everyone): the app keeps one small
  connection to the relay and Android shows a quiet "Orbit is connected"
  notification while it does.
- **Firebase** (for builds of the app that include a Firebase project): Orbit
  sends the alert through Firebase Cloud Messaging with the project's service
  account key, which you paste into Settings, Your phone, and which stays
  encrypted on your computer. No background connection.

Either way an alert carries no content: it says that something needs you, and
the app fetches the details over the encrypted connection.

## Protocol

Version 1. Byte strings in JSON are base64url without padding.

### Keys

- Orbit has a long-term X25519 key pair, created on first use and stored
  encrypted in `~/.orbit` (`host key`). Its public key is `H`.
- Each phone has its own X25519 key pair (`device key`), public key `D`, kept
  in the phone's keystore.
- The **room** is `base64url(SHA-256(H))[0..22]`: the relay's name for this
  Orbit. It reveals nothing but lets the relay route.

### Pairing

Orbit shows a QR code with:

```
orbit://pair?v=1&relay=<https URL>&room=<room>&h=<H>&code=<pairing code>&name=<computer name>
```

The pairing code is 16 random bytes, valid for 10 minutes and one use. The
first session a phone opens includes it (below); Orbit then remembers `D` as a
paired device. Pairing again from the same phone replaces the old entry.

### Relay endpoints

All websockets carry binary messages and are forwarded byte for byte.

| Endpoint | Who | What |
| --- | --- | --- |
| `GET /v1/health` | anyone | `{"ok":true,"version":"..."}` |
| `WS /v1/host?room=R` | Orbit, header `Authorization: Bearer <relay token>` | control socket: the relay sends text frames `{"type":"open","chan":"<id>"}` when a phone connects, `{"type":"ping"}` every 25 s (answer `{"type":"pong"}`) |
| `WS /v1/accept?room=R&chan=C` | Orbit, same header | the host side of one phone's pipe; the relay splices it to the waiting phone socket |
| `WS /v1/connect?room=R` | phone | one pipe to Orbit; waits up to 15 s for Orbit to accept, else closes with 4404 |
| `WS /v1/wait?room=R&device=X` | phone | alert socket; `X` is `base64url(SHA-256(D))[0..22]`. The relay forwards alerts as binary frames and pings every 25 s |
| `POST /v1/notify?room=R&device=X` | Orbit, same header | body up to 4 KiB, forwarded to every `wait` socket for that device; `202` if delivered to at least one, `404` if none is connected |

The relay keeps no state on disk besides its token and certificates. One room
has one host at a time: a new host connection with the right token replaces the
old one. Limits: 64 phones per room, 1 MiB per message, 16 pipes opening per
minute per IP.

### Session handshake

Inside a pipe, the phone speaks first. Message 1 (phone to Orbit), JSON as a
UTF-8 text frame:

```json
{"v":1,"d":"<D>","e":"<E>","n":"<16 random bytes>"}
```

`E` is a fresh X25519 public key for this session. Both sides compute:

```
s1 = X25519(e_priv, H)        = X25519(h_priv, E)
s2 = X25519(d_priv, H)        = X25519(h_priv, D)
ikm  = s1 || s2
salt = n
info = "orbit-e2e-v1" || H || D || E
okm  = HKDF-SHA256(ikm, salt, info, 64 bytes)
k_up   = okm[0..32]   (phone to Orbit)
k_down = okm[32..64]  (Orbit to phone)
```

Every later frame is binary: `AES-256-GCM(key, nonce, plaintext)` with the
16-byte tag appended. The nonce is 12 bytes: 4 zero bytes, then a 64-bit
big-endian counter starting at 0, separate per direction. A receiver drops the
pipe on any frame that does not decrypt with the next counter.

Message 2 (phone to Orbit, encrypted, first frame on `k_up`):

```json
{"t":"hello","code":"<pairing code, only when pairing>","name":"Pixel 9","app":"0.5.0","push":{"kind":"relay"}}
```

`push` is `{"kind":"relay"}`, `{"kind":"fcm","token":"..."}` or absent. Orbit
answers on `k_down` with `{"t":"welcome","name":"<computer>","version":"0.5.0"}`
if `D` is paired (or the code is valid), else `{"t":"denied","reason":"..."}`
and closes.

### Requests and events

After `welcome`, the phone uses Orbit's own HTTP API through the pipe:

```json
{"t":"req","id":7,"method":"GET","path":"/api/workspaces","body":null}
{"t":"res","id":7,"status":200,"body":[...]}
```

`body` is JSON (or null). The phone is treated like the signed-in browser. To
receive live events (the same ones the web interface gets over `/ws`):

```json
{"t":"sub"}
{"t":"ev","e":{"type":"approval_request", "...": "..."}}
```

and sends interface messages (send, approval, stop) as
`{"t":"msg","m":{"type":"approval","id":"...","decision":"allow"}}`.

Either side may send `{"t":"ping"}`; the other answers `{"t":"pong"}`.

### Alerts

An alert through the relay is `AES-256-GCM(k_alert, nonce, json)` where
`k_alert = HKDF-SHA256(X25519(h_priv, D), salt = "orbit-alert", info = H || D, 32)`
and the frame is `nonce (12 random bytes) || ciphertext || tag`. The JSON:

```json
{"t":"needs","ws":"<workspace id>","title":"<workspace title>","count":2,"at":1761200000000}
```

`t` is `needs` (an approval is waiting), `done` (a run you started from the
phone finished) or `clear` (nothing is waiting any more). Through Firebase the
same sealed frame is sent as a data message `{"data":{"orbit":"<base64url of the frame>"}}`:
Google carries it but cannot read it, and the app opens it with the same key.
