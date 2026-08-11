#!/usr/bin/env node
// Minimal HTTPS reverse proxy for the Quartz local dev server.
//
// Quartz's `npx quartz build --serve` only speaks HTTP, but the encrypted-pages
// unlock needs WebCrypto, which browsers only expose in a secure context
// (HTTPS or localhost). This proxies the HTTP dev server behind a TLS endpoint
// using the repo-local mkcert certificate so the site can be opened (and
// unlocked) from any device on the LAN.
//
// Usage: node scripts/https-proxy.mjs <httpsPort> <targetPort> <certFile> <keyFile>

import http from "node:http"
import https from "node:https"
import fs from "node:fs"

const [httpsPort, targetPort, certFile, keyFile] = process.argv.slice(2)

if (!httpsPort || !targetPort || !certFile || !keyFile) {
  console.error(
    "usage: node scripts/https-proxy.mjs <httpsPort> <targetPort> <certFile> <keyFile>",
  )
  process.exit(1)
}

const tlsOptions = {
  cert: fs.readFileSync(certFile),
  key: fs.readFileSync(keyFile),
}

function proxy(req, res) {
  const forward = http.request(
    {
      host: "127.0.0.1",
      port: Number(targetPort),
      path: req.url,
      method: req.method,
      headers: req.headers,
    },
    (upstream) => {
      res.writeHead(upstream.statusCode ?? 500, upstream.headers)
      upstream.pipe(res)
    },
  )
  forward.on("error", (err) => {
    res.writeHead(502, { "Content-Type": "text/plain" })
    res.end(`HTTPS proxy error: ${err.message}`)
  })
  req.pipe(forward)
}

https.createServer(tlsOptions, proxy).listen(Number(httpsPort), "0.0.0.0", () => {
  console.log(
    `HTTPS dev proxy listening on https://localhost:${httpsPort} (and https://<lan-ip>:${httpsPort}) -> http://127.0.0.1:${targetPort}`,
  )
})
