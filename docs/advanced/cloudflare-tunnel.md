---
title: Cloudflare quick tunnel for local HTTPS
---

> The encrypted-pages unlock uses WebCrypto (`window.crypto.subtle`), which
> browsers only expose in a **secure context** (HTTPS, or `localhost`). The
> Quartz dev server is plain HTTP, so opening it over a LAN IP like
> `http://192.168.50.55:1313` leaves every password failing. Use HTTPS locally
> to unlock from other devices.

## Two ways to get a secure context locally

|        | mkcert (implemented)                       | Cloudflare quick tunnel (this page)            |
| ------ | ------------------------------------------ | ---------------------------------------------- |
| Setup  | `./install.sh` once, then `./dev_setup.sh` | download `cloudflared`, one command            |
| URL    | `https://<lan-ip>:1314/obsidian/`          | `https://<random>.trycloudflare.com/obsidian/` |
| Scope  | LAN only, offline                          | Anywhere (even cellular)                       |
| Cert   | mkcert CA trusted on your devices          | Real Cloudflare cert, no trust setup           |
| Caveat | LAN IP must be in the cert SAN             | Random URL each run; the endpoint is public    |

The mkcert route is wired into `install.sh` / `dev_setup.sh` and is the
recommended default. Use a Cloudflare quick tunnel when you want to reach the
dev site from anywhere without installing the CA on each device.

## Cloudflare quick tunnel

### 1. Install `cloudflared`

```sh
# Linux (amd64) — adjust for your arch
mkdir -p ~/bin
curl -L -o ~/bin/cloudflared https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64
chmod +x ~/bin/cloudflared
export PATH="$HOME/bin:$PATH"
```

For other platforms see <https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/>.

### 2. Start the Quartz dev server

```sh
cd obsidian_quartz
QUARTZ_ACL_PASSWORD=<your-password> npx quartz build --serve --port 1313 --baseDir obsidian
```

(The dev server must stay running; the tunnel forwards to it.)

### 3. Open a tunnel to it

```sh
cloudflared tunnel --url http://localhost:1313
```

`cloudflared` prints a URL like:

```
https://word-mouse-tower-8.trycloudflare.com
```

Because this site is served under the `/obsidian` base path, the dev site is:

```
https://word-mouse-tower-8.trycloudflare.com/obsidian/
```

Open that URL on any device (including phone on cellular). It is HTTPS with a
valid Cloudflare cert, so `crypto.subtle` is available and the password unlock
works.

### 4. Caveats

- **Random URL each run.** Every `cloudflared tunnel --url` invocation gets a
  new random hostname. For a stable URL, set up a **named tunnel** and a DNS
  CNAME record (see below).
- **Public endpoint.** Anyone who learns the URL can reach your dev server. The
  note bodies are encrypted, but the site (including titles of listed notes) is
  visible — don't run a long-lived tunnel against a machine you don't control.
- **Hot reload.** The WS hot-reload client connects to `ws://localhost:3001`
  directly, so auto-refresh won't work through the tunnel on a remote device;
  refresh manually. This is a pre-existing limitation of the dev server, not
  the tunnel.

## Stable URL (named tunnel)

For a persistent hostname:

```sh
# one-time
cloudflared tunnel login
cloudflared tunnel create docs-dev
cloudflared tunnel route dns docs-dev docs-dev.example.com

# run
cloudflared tunnel run docs-dev --url http://localhost:1313
```

See <https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/>.

## Verification

```sh
# from the machine running the tunnel
curl -s https://<your-tunnel>.trycloudflare.com/obsidian/resm_zh | grep -c data-encrypted
# 1  (the encrypted body is served over HTTPS)
```

Then open the same URL in a browser and unlock with `QUARTZ_ACL_PASSWORD`.
