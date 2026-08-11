#!/bin/bash
# Local Quartz dev server. Run once per dev session:
#   ./install.sh            # one-time: mkcert + HTTPS certs (needs sudo)
#   ./dev_setup.sh <vault>  # every session: symlink vault, npm i, HTTPS serve
#
# Serves the site at /obsidian (matching the deployed baseUrl). If the mkcert
# certs exist (from install.sh), an HTTPS proxy is started so encrypted notes
# can be unlocked from any device on the LAN (WebCrypto needs a secure context).
set -euo pipefail
cd "$(dirname "$0")"

repo=${1:-}
if [ -z "$repo" ]; then
  echo "usage: $0 <vault-path>"
  exit 1
fi

rm -f content && ln -s "$(realpath "$repo")" content

# Source build-time secrets (e.g. QUARTZ_ACL_PASSWORD) from a gitignored acl.env if present
if [ -f "./acl.env" ]; then
  set -a
  . ./acl.env
  set +a
fi

npm i

PORT="${PORT:-1313}"
HTTPS_PORT="${HTTPS_PORT:-1314}"
CERT_DIR="certs"

# Quartz's dev server is HTTP only; run it in the background.
npx quartz build --serve --port "$PORT" --baseDir obsidian > serve.log 2>&1 &
QUARTZ_PID=$!
trap 'kill "$QUARTZ_PID" 2>/dev/null || true' EXIT

if [ -f "$CERT_DIR/dev-cert.pem" ] && [ -f "$CERT_DIR/dev-key.pem" ]; then
  echo ""
  echo "HTTPS dev server (run ./install.sh once if these fail to load):"
  echo "  https://localhost:${HTTPS_PORT}/obsidian/"
  echo "  https://<lan-ip>:${HTTPS_PORT}/obsidian/   (other devices on the LAN)"
  echo ""
  # Foreground so Ctrl+C stops the proxy; the trap then stops Quartz.
  node scripts/https-proxy.mjs "$HTTPS_PORT" "$PORT" \
    "$CERT_DIR/dev-cert.pem" "$CERT_DIR/dev-key.pem"
else
  echo "No HTTPS certs in $CERT_DIR/ — serving HTTP only (unlock works on this machine via localhost)."
  echo "  http://localhost:${PORT}/obsidian/"
  echo "  Run ./install.sh once to enable HTTPS for LAN access."
  wait "$QUARTZ_PID"
fi
