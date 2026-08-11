---
title: Protected notes (ACL)
---

> [!warning]
> This fork publishes encrypted notes for content tagged `@acl/private` (or with frontmatter `access: private`). This page documents how the mechanism works and how to operate it. Never commit the shared password.

## What it does

`quartz/plugins/transformers/aclProtect.ts` is a local Quartz v5 transformer registered at `order: 35` in `quartz.config.yaml` — after frontmatter parsing (`obsidian-flavored-markdown`, order 30) and before `@quartz-community/encrypted-pages` (order 900). For every note whose frontmatter is tagged `@acl/private` (or has `access: private`), it injects the single shared build-time password into `frontmatter.password` (unless an explicit per-note password exists) and sets `frontmatter.unlisted = true` (unless an explicit boolean exists).

The `@quartz-community/encrypted-pages` plugin (with `unlistWhenEncrypted: true`) then:

- replaces the page body with an AES-GCM-encrypted `div.encrypted-page[data-encrypted][data-iterations]`, so anonymous visitors see only a password prompt;
- marks the page `unlisted`, excluding it from `contentIndex.json`, `sitemap.xml`, `tags.html`, folder pages and RSS;
- writes one entry per unlisted encrypted page into `static/encryptedContentIndex.json` (each entry itself encrypted with the shared password; no plaintext slug/title leaks).

After a correct unlock, the client-side script decrypts the shadow entry and dispatches a `content-index-updated` event, dynamically re-adding the page to graph/explorer/search for the session.

## The password

The shared password is read ONCE at build time from `QUARTZ_ACL_PASSWORD` (overridable per-build via the plugin `options.password`, which logs a warning — do not commit a real value in `quartz.config.yaml`).

- Local dev: put `QUARTZ_ACL_PASSWORD=<value>` in a gitignored `./acl.env` (sourced by `dev_setup.sh`) or export it in your shell.
- Netlify (the real deploy target for this fork; all `.github/workflows/*` are gated to `jackyzha0/quartz` and do NOT run on the fork): Site settings → Environment variables → add `QUARTZ_ACL_PASSWORD` (encrypted). Netlify injects it into the `npx quartz build` step.

## Fail-closed rule

If any processed note is private and `QUARTZ_ACL_PASSWORD` is unset/empty, the build ABORTS (per-file throw → `trace()` → `process.exit(1)`), rather than publishing plaintext. This is deliberate: a missing password must never result in a public plaintext page.

Note: the 106 private notes that also carry `draft: true` are still processed by the transformer (filters run after transformers), so ANY build of this vault requires the env var — even if only drafts are private. Do not "simplify" detection to skip drafts; that would reopen the plaintext leak.

## Marking a note private

Add to the note frontmatter (no other config needed):

```yaml
---
tags:
  - "@acl/private"
---
```

or `access: private`. The note is auto-detected and protected at the next build.

## Current census (at time of writing)

- 119 notes carry a private marker and are not excluded by `ignorePatterns`.
- 106 of those also have `draft: true` and are removed by the `remove-draft` filter before emit.
- 13 non-draft private notes are the encrypted + unlisted set (e.g. `10-ComputeScience/AI/RDMA笔记.md`, `20-工作/FinTech/资产配置.md`).

## Verification

```sh
node --version            # must be >= 22.18.0 (type stripping for the runtime .ts import)
npm run prebuild           # regenerates .quartz/plugins/index.ts (required for tsc)
npm run check             # tsc --noEmit + prettier
env -u QUARTZ_ACL_PASSWORD npx quartz build   # must FAIL (exit != 0) when private notes exist
QUARTZ_ACL_PASSWORD=test-secret npx quartz build
# encrypted HTML count == 13:
grep -rl 'data-encrypted' public --include='*.html' | wc -l
# password never leaked into any artifact:
grep -r 'test-secret' public/   # 0 matches
```

## Footguns

- A per-note explicit `password:` is respected and unlocks that page independently of the shared password.
- A per-note explicit `unlisted: false` makes the page encrypted-but-listed (slug/title visible in nav/index; body still encrypted; absent from the shadow index).
- Public notes that link to a private note still expose the private slug as a graph node (no content). Inherent to unlisted mode; use `stealth` mode only if that is unacceptable.
- Node < 22.18 silently skips loading the local `.ts` plugin and would publish plaintext again. Keep `.node-version` at >= v22.18.0.
