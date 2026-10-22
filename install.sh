#!/bin/sh
# Orbit installer for Linux and macOS.
#   curl -fsSL https://raw.githubusercontent.com/Elchi-dev/Orbit/main/install.sh | sh
# Options (env): ORBIT_REPO=owner/repo  ORBIT_VERSION=v0.1.0  ORBIT_INSTALL_DIR=~/.local/bin
set -eu

REPO="${ORBIT_REPO:-Elchi-dev/Orbit}"
VERSION="${ORBIT_VERSION:-latest}"
DIR="${ORBIT_INSTALL_DIR:-$HOME/.local/bin}"

say() { printf '  %s\n' "$*"; }
fail() { printf '\n  orbit install failed: %s\n\n' "$*" >&2; exit 1; }

case "$(uname -s)" in
  Linux) os=linux ;;
  Darwin) os=darwin ;;
  *) fail "unsupported system $(uname -s). On Windows run install.ps1 in PowerShell." ;;
esac
case "$(uname -m)" in
  x86_64 | amd64) arch=x64 ;;
  arm64 | aarch64) arch=arm64 ;;
  *) fail "unsupported CPU $(uname -m)" ;;
esac

asset="orbit-$os-$arch"
command -v curl >/dev/null 2>&1 || fail "curl is required"

# GitHub's releases/latest skips pre-releases, and every Orbit release is one while it is alpha,
# so the newest tag comes from the API instead.
if [ "$VERSION" = "latest" ]; then
  VERSION="$(curl -fsSL "https://api.github.com/repos/$REPO/releases?per_page=1" | sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' | head -n 1)"
  [ -n "$VERSION" ] || fail "could not find a release of $REPO"
fi
base="https://github.com/$REPO/releases/download/$VERSION"
mkdir -p "$DIR"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

printf '\n  ◯  Installing Orbit (%s, %s)\n\n' "$asset" "$VERSION"
curl -fL --progress-bar "$base/$asset" -o "$tmp/orbit" || fail "could not download $base/$asset"

# verify the checksum when the release publishes one
if curl -fsSL "$base/SHA256SUMS" -o "$tmp/SHA256SUMS" 2>/dev/null; then
  expected="$(grep " $asset\$" "$tmp/SHA256SUMS" | awk '{print $1}')"
  if [ -n "$expected" ]; then
    if command -v sha256sum >/dev/null 2>&1; then actual="$(sha256sum "$tmp/orbit" | awk '{print $1}')"
    else actual="$(shasum -a 256 "$tmp/orbit" | awk '{print $1}')"; fi
    [ "$expected" = "$actual" ] || fail "checksum mismatch, not installing"
    say "checksum ok"
  fi
fi

chmod +x "$tmp/orbit"
[ "$os" = "darwin" ] && xattr -d com.apple.quarantine "$tmp/orbit" 2>/dev/null || true
mv "$tmp/orbit" "$DIR/orbit"
say "installed to $DIR/orbit"

case ":$PATH:" in
  *":$DIR:"*) ;;
  *)
    say ""
    say "$DIR is not on your PATH. Add this to your shell profile:"
    say "  export PATH=\"$DIR:\$PATH\""
    ;;
esac
printf '\n  Run  orbit  and open http://localhost:7777\n\n'
