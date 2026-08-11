#!/bin/bash
# One-time setup for HTTPS local development (so protected/encrypted notes can
# be unlocked from any device on the LAN — WebCrypto requires a secure context).
#
#   ./install.sh [<lan-ip>]     # runs once, needs sudo (trusts the local CA)
#   ./dev_setup.sh <vault>      # every dev session
#
# Generates a repo-local mkcert CA + dev certificate into ./certs (gitignored)
# and trusts the CA in the system store, so browsers see a valid HTTPS cert for
# `localhost`, `127.0.0.1` and your LAN IP.

set -euo pipefail
cd "$(dirname "$0")"

REAL_USER="${SUDO_USER:-$(id -un)}"
MKCERT_VERSION="v1.4.4"

# Installing the CA into the system trust store requires root; re-run as sudo so
# every step (binary install, CA trust, cert generation) uses the same context.
if [ "$(id -u)" -ne 0 ]; then
  echo "Re-running with sudo (needs root to trust the CA)..."
  exec sudo "$0" "$@"
fi

# A repo-local CAROOT keeps this setup self-contained and gitignored.
export CAROOT="$(pwd)/certs/ca"
mkdir -p "$CAROOT"

# 1. Install the mkcert binary if missing.
if ! command -v mkcert >/dev/null 2>&1; then
  echo "Downloading mkcert ${MKCERT_VERSION}..."
  ARCH="$(uname -m)"
  case "$ARCH" in
    x86_64|amd64) MKCERT_ARCH="amd64" ;;
    aarch64|arm64) MKCERT_ARCH="arm64" ;;
    *) echo "Unsupported architecture: $ARCH"; exit 1 ;;
  esac
  curl -fLo /usr/local/bin/mkcert \
    "https://github.com/FiloSottile/mkcert/releases/download/${MKCERT_VERSION}/mkcert-${MKCERT_VERSION#v}-linux-${MKCERT_ARCH}"
  chmod +x /usr/local/bin/mkcert
fi

# 2. Trust the local CA in the system store (this is the root-only step).
mkcert -install

# 3. LAN IP to put in the certificate SANs (override with `./install.sh <ip>`).
LAN_IP="${1:-}"
if [ -z "$LAN_IP" ]; then
  LAN_IP="$(hostname -I 2>/dev/null | awk '{for (i = 1; i <= NF; i++) if ($i !~ /^127\./) { print $i; exit }}')"
  LAN_IP="${LAN_IP:-127.0.0.1}"
fi

# 4. Generate the dev certificate, signed by the repo-local CA.
mkcert -key-file certs/dev-key.pem -cert-file certs/dev-cert.pem localhost 127.0.0.1 "$LAN_IP"

# 5. Hand the files back to the invoking user if we ran as root.
if [ "$REAL_USER" != "root" ]; then
  chown -R "$REAL_USER" certs
fi

echo ""
echo "HTTPS dev setup complete."
echo "  CA:      certs/ca            (trusted in the system store)"
echo "  Cert:    certs/dev-cert.pem  (SANs: localhost, 127.0.0.1, ${LAN_IP})"
echo ""
echo "Now run:"
echo "  ./dev_setup.sh <vault-path>"
echo "and open:"
echo "  https://localhost:1314/obsidian/        (this machine)"
echo "  https://${LAN_IP}:1314/obsidian/        (other devices on the LAN)"
