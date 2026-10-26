#!/bin/sh
# Installs or updates orbit-relay as a systemd service on Ubuntu or Debian.
#
#   curl -fsSL https://raw.githubusercontent.com/Elchi-dev/Orbit/main/relay/install.sh | sudo sh -s -- --domain relay.example.com
#   curl -fsSL https://raw.githubusercontent.com/Elchi-dev/Orbit/main/relay/install.sh | sudo sh -s -- --behind-proxy --port 8787
#
# Options:
#   --domain NAME      serve TLS on :443 with a Let's Encrypt certificate (needs ports 80 and 443)
#   --behind-proxy     serve plain HTTP on 127.0.0.1 for nginx or Caddy in front
#   --port N           port for --behind-proxy (default 8787)
#   --email ADDRESS    optional contact address for Let's Encrypt
#   --version TAG      install this release instead of the newest one, like v0.5.0
#
# Running it again updates the binary and restarts the service. The token is
# kept. Without --domain or --behind-proxy an update keeps the current setup.
set -eu

REPO="Elchi-dev/Orbit"
BIN="/usr/local/bin/orbit-relay"
USER_NAME="orbit-relay"
CONF_DIR="/etc/orbit-relay"
TOKEN_FILE="$CONF_DIR/token"
STATE_DIR="/var/lib/orbit-relay"
UNIT="/etc/systemd/system/orbit-relay.service"

say() { printf '  %s\n' "$*"; }
fail() {
  printf '\n  orbit-relay install failed: %s\n\n' "$*" >&2
  exit 1
}

domain=""
behind=""
port="8787"
email=""
version=""
while [ $# -gt 0 ]; do
  case "$1" in
    --domain) [ $# -ge 2 ] || fail "--domain needs a value"; domain="$2"; shift 2 ;;
    --domain=*) domain="${1#*=}"; shift ;;
    --behind-proxy) behind=1; shift ;;
    --port) [ $# -ge 2 ] || fail "--port needs a value"; port="$2"; shift 2 ;;
    --port=*) port="${1#*=}"; shift ;;
    --email) [ $# -ge 2 ] || fail "--email needs a value"; email="$2"; shift 2 ;;
    --email=*) email="${1#*=}"; shift ;;
    --version) [ $# -ge 2 ] || fail "--version needs a value"; version="$2"; shift 2 ;;
    --version=*) version="${1#*=}"; shift ;;
    -h | --help)
      echo "usage: install.sh --domain NAME [--email ADDRESS] | --behind-proxy [--port N]  [--version TAG]"
      exit 0
      ;;
    *) fail "unknown option $1" ;;
  esac
done

[ "$(id -u)" -eq 0 ] || fail "run as root, for example with: curl ... | sudo sh -s -- --domain relay.example.com"
[ "$(uname -s)" = "Linux" ] || fail "orbit-relay runs on Linux"
command -v systemctl >/dev/null 2>&1 || fail "systemd is required"
command -v curl >/dev/null 2>&1 || fail "curl is required (apt install curl)"
command -v sha256sum >/dev/null 2>&1 || fail "sha256sum is required (apt install coreutils)"

if [ -n "$domain" ] && [ -n "$behind" ]; then
  fail "use either --domain or --behind-proxy, not both"
fi
if [ -n "$domain" ]; then
  case "$domain" in
    *[!A-Za-z0-9.-]* | .* | *. | "") fail "not a domain name: $domain" ;;
  esac
fi
case "$port" in
  "" | *[!0-9]*) fail "not a port: $port" ;;
esac
if [ "$port" -lt 1 ] || [ "$port" -gt 65535 ]; then
  fail "not a port: $port"
fi
if [ -n "$email" ]; then
  case "$email" in
    *@*) ;;
    *) fail "not an email address: $email" ;;
  esac
  case "$email" in
    *[!A-Za-z0-9.@_+-]*) fail "not an email address: $email" ;;
  esac
fi

if [ -n "$domain" ]; then
  exec_args="serve --domain $domain"
  [ -n "$email" ] && exec_args="$exec_args --email $email"
elif [ -n "$behind" ]; then
  exec_args="serve --behind-proxy --port $port"
elif [ -f "$UNIT" ]; then
  exec_args=""
else
  fail "give --domain relay.example.com, or --behind-proxy --port 8787"
fi

case "$(uname -m)" in
  x86_64 | amd64) arch=amd64 ;;
  aarch64 | arm64) arch=arm64 ;;
  *) fail "unsupported CPU $(uname -m), only amd64 and arm64 are built" ;;
esac
asset="orbit-relay-linux-$arch"

# Orbit's releases are marked as pre-releases while it is in alpha, and
# GitHub's releases/latest skips those, so the newest tag comes from the API.
if [ -z "$version" ]; then
  version="$(curl -fsSL "https://api.github.com/repos/$REPO/releases?per_page=1" | sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' | head -n 1)"
  [ -n "$version" ] || fail "could not find a release of $REPO"
fi
base="https://github.com/$REPO/releases/download/$version"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT INT TERM

printf '\n  Installing orbit-relay %s (%s)\n\n' "$version" "$asset"
curl -fsSL "$base/$asset" -o "$tmp/$asset" || fail "could not download $base/$asset"
curl -fsSL "$base/SHA256SUMS" -o "$tmp/SHA256SUMS" || fail "could not download $base/SHA256SUMS"
expected="$(awk -v f="$asset" '$2 == f || $2 == "*" f { print $1 }' "$tmp/SHA256SUMS" | head -n 1)"
[ -n "$expected" ] || fail "$asset is not listed in SHA256SUMS"
actual="$(sha256sum "$tmp/$asset" | awk '{ print $1 }')"
[ "$expected" = "$actual" ] || fail "checksum mismatch for $asset, not installing"
say "checksum ok"

install -m 0755 "$tmp/$asset" "$BIN.new"
mv -f "$BIN.new" "$BIN"
say "installed $BIN ($("$BIN" version))"

if ! id -u "$USER_NAME" >/dev/null 2>&1; then
  useradd --system --no-create-home --home-dir "$STATE_DIR" --shell /usr/sbin/nologin "$USER_NAME"
  say "created the system user $USER_NAME"
fi
install -d -m 0750 -o root -g "$USER_NAME" "$CONF_DIR"
install -d -m 0750 -o "$USER_NAME" -g "$USER_NAME" "$STATE_DIR"
install -d -m 0700 -o "$USER_NAME" -g "$USER_NAME" "$STATE_DIR/certs"

if [ -s "$TOKEN_FILE" ]; then
  say "kept the existing relay token"
else
  "$BIN" token --rotate --token-file "$TOKEN_FILE" >/dev/null
  say "created a relay token"
fi
chown root:"$USER_NAME" "$TOKEN_FILE"
chmod 0640 "$TOKEN_FILE"

if [ -n "$exec_args" ]; then
  cat >"$UNIT.new" <<EOF
[Unit]
Description=Orbit relay
Documentation=https://github.com/Elchi-dev/Orbit/blob/main/docs/REMOTE.md
After=network-online.target
Wants=network-online.target

[Service]
User=$USER_NAME
Group=$USER_NAME
ExecStart=$BIN $exec_args --token-file $TOKEN_FILE
Restart=always
RestartSec=2
LimitNOFILE=65536

AmbientCapabilities=CAP_NET_BIND_SERVICE
CapabilityBoundingSet=CAP_NET_BIND_SERVICE
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
ReadWritePaths=$STATE_DIR
PrivateTmp=yes
PrivateDevices=yes
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectKernelLogs=yes
ProtectControlGroups=yes
ProtectClock=yes
ProtectHostname=yes
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
RestrictNamespaces=yes
RestrictRealtime=yes
RestrictSUIDSGID=yes
LockPersonality=yes
MemoryDenyWriteExecute=yes
SystemCallArchitectures=native
SystemCallFilter=@system-service
UMask=0077

[Install]
WantedBy=multi-user.target
EOF
  mv -f "$UNIT.new" "$UNIT"
  say "wrote $UNIT"
fi

systemctl daemon-reload
systemctl enable --quiet orbit-relay
systemctl restart orbit-relay
say "service started"

# Read the setup back from the unit, so an update without options reports it too.
current="$(sed -n 's/^ExecStart=//p' "$UNIT")"
case "$current" in
  *--domain*)
    domain="$(printf '%s\n' "$current" | sed -n 's/.*--domain \([^ ]*\).*/\1/p')"
    health_cmd="curl -fsS --max-time 10 --resolve $domain:443:127.0.0.1 https://$domain/v1/health"
    url="https://$domain"
    ;;
  *)
    port="$(printf '%s\n' "$current" | sed -n 's/.*--port \([0-9]*\).*/\1/p')"
    health_cmd="curl -fsS --max-time 5 http://127.0.0.1:${port:-8787}/v1/health"
    url=""
    ;;
esac

printf '  waiting for the relay'
healthy=""
i=0
while [ $i -lt 45 ]; do
  if $health_cmd >/dev/null 2>&1; then
    healthy=1
    break
  fi
  printf '.'
  sleep 2
  i=$((i + 1))
done
printf '\n'

token="$(cat "$TOKEN_FILE")"
printf '\n'
if [ -n "$healthy" ]; then
  say "orbit-relay $version is running."
else
  say "orbit-relay did not answer on /v1/health yet."
  if [ -n "$url" ]; then
    say "Check that $domain points at this server and ports 80 and 443 are open,"
    say "then look at: journalctl -u orbit-relay -n 50"
  else
    say "Look at: journalctl -u orbit-relay -n 50"
  fi
fi
printf '\n'
if [ -n "$url" ]; then
  say "Relay address:  $url"
else
  say "Relay address:  https://<your domain>  (the name your proxy serves,"
  say "                proxied to 127.0.0.1:${port:-8787} with websockets allowed)"
fi
say "Relay token:    $token"
printf '\n'
say "In Orbit, open Settings, Remote. Paste the relay address and the token,"
say "then pair your phone by scanning the QR code with the Orbit app."
printf '\n'
say "Keep the token private. Show it again: sudo orbit-relay token"
say "New token: sudo orbit-relay token --rotate   Remove: sudo orbit-relay uninstall"
printf '\n'
