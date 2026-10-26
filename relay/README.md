# orbit-relay

A small server that lets the Orbit app on your phone reach Orbit on your
computer from anywhere. Both sides connect out to the relay and the relay
joins them.

- **Blind.** Everything between phone and computer is encrypted end to end
  with keys agreed when you pair by QR code. The relay forwards sealed frames
  byte for byte and cannot read or change them.
- **No state.** Nothing is kept on disk besides the relay token and the TLS
  certificate. Rooms and pipes live in memory only.
- **One token.** Orbit authenticates with the relay token. Phones need no
  token: they prove themselves to Orbit, not to the relay.

The protocol is described in [docs/REMOTE.md](../docs/REMOTE.md).

## Install

You need a Linux server (Ubuntu or Debian, amd64 or arm64) with a public IP
and a DNS `A` record (and `AAAA` for IPv6) for a name like
`relay.example.com` pointing at it. Then:

```sh
curl -fsSL https://raw.githubusercontent.com/Elchi-dev/Orbit/main/relay/install.sh | sudo sh -s -- --domain relay.example.com
```

This downloads the newest release, checks its SHA-256, installs
`/usr/local/bin/orbit-relay`, creates the system user `orbit-relay` and a
hardened systemd service, gets a Let's Encrypt certificate and prints the
relay address and token. In Orbit, open Settings, Remote, paste both, then
pair your phone.

Show the token again at any time: `sudo orbit-relay token`.

## Behind nginx or Caddy

If something already serves ports 80 and 443, let it handle TLS and run the
relay on localhost:

```sh
curl -fsSL https://raw.githubusercontent.com/Elchi-dev/Orbit/main/relay/install.sh | sudo sh -s -- --behind-proxy --port 8787
```

In this mode the relay listens on `127.0.0.1:8787` only and takes the client
address from `X-Forwarded-For` (for its per IP limit). Proxy your relay name
to it with websockets allowed and long timeouts.

Caddy:

```
relay.example.com {
	reverse_proxy 127.0.0.1:8787
}
```

nginx:

```nginx
server {
    listen 443 ssl;
    server_name relay.example.com;
    ssl_certificate     /etc/letsencrypt/live/relay.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/relay.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:8787;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 1h;
        proxy_send_timeout 1h;
        proxy_buffering off;
        client_max_body_size 8k;
    }
}
```

The relay address you paste in Orbit is then `https://relay.example.com`.

## Update

Run the install line again. It replaces the binary, restarts the service
and keeps the token. Running it without `--domain` or `--behind-proxy` keeps
the current setup. A specific release: add `--version v0.5.0`.

## New token

```sh
sudo orbit-relay token --rotate
```

This writes a new token and restarts the service, which disconnects Orbit.
Paste the new token in Orbit, Settings, Remote. Paired phones keep working.

## Uninstall

```sh
sudo orbit-relay uninstall
```

It asks first (skip with `--yes`), then stops and removes the service, the
`orbit-relay` user, the binary, `/etc/orbit-relay` and `/var/lib/orbit-relay`.

## Firewall

- With `--domain`: open TCP 443 (the relay) and TCP 80 (certificate
  issuance and renewal). For ufw: `sudo ufw allow 80,443/tcp`.
- With `--behind-proxy`: open nothing new. The relay listens on localhost and
  your proxy already serves 80 and 443.

Orbit and the phone only connect out, so nothing needs opening at home.

## Limits

64 phone connections per room, 1 MiB per message, 4 KiB per alert, 16 new
pipes per minute per IP address. Refused requests get HTTP 429. A phone pipe
that no Orbit accepts within 15 seconds is closed with code 4404.

## Logs

```sh
journalctl -u orbit-relay -f
```

One line per connection opened and closed, with a shortened room id. Tokens
and message contents are never logged.
