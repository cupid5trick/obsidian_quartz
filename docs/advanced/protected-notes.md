---
title: Protected notes (ACL)
---

> [!warning]
> This fork publishes encrypted notes for content tagged `@acl/private` (or with frontmatter `access: private`). This page documents how the mechanism works and how to operate it. Never commit the shared password.

## What it does

`quartz/plugins/transformers/aclProtect.ts` is a local Quartz v5 transformer registered at `order: 35` in `quartz.config.yaml` — after frontmatter parsing (`obsidian-flavored-markdown`, order 30) and before `@quartz-community/encrypted-pages` (order 900). For every note whose frontmatter is tagged `@acl/private` (or has `access: private`), it injects the single shared build-time password into `frontmatter.password` (unless an explicit per-note password exists).

The `@quartz-community/encrypted-pages` plugin (with `unlistWhenEncrypted: false`) then replaces the page body with an AES-GCM-encrypted `div.encrypted-page[data-encrypted][data-iterations]`, so the content is only visible after entering the password.

### Notes stay LISTED

`unlistWhenEncrypted: false` means encrypted notes keep their normal `unlisted` value (false), so they remain visible **everywhere as titled entries** — folder pages, the left-pane Explorer, search, graph, and `contentIndex.json`. Their **titles and slugs are public**; only the body requires the password on click. This is a deliberate trade-off:

- **Folder pages work normally**, including folders that contain _only_ encrypted notes — they are emitted with the notes listed, instead of 404-ing because all children were unlisted.
- There is no hide-before-unlock: anyone browsing can see that `20-工作/工作规划/做好防御` exists. To hide existence entirely, `stealth` mode would be required (not enabled here).

The `EncryptedPage` component must be mounted for the client script to load (password form, decryption, and the `render` event). This is configured as a `layout` entry on the plugin:

```yaml
- source: "@quartz-community/encrypted-pages"
  enabled: true
  options:
    iterations: 600000
    passwordField: password
    unlistWhenEncrypted: false
    outputPath: static/encryptedContentIndex.json
  order: 900
  layout:
    position: beforeBody
    priority: 1
```

Without that `layout:` block the component has no default position, never mounts, and the page shows a ciphertext div with no way to unlock.

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
- 13 non-draft private notes are the encrypted + listed set (e.g. `10-ComputeScience/AI/RDMA笔记.md`, `20-工作/FinTech/资产配置.md`).

## Verification

```sh
node --version            # must be >= 22.18.0 (type stripping for the runtime .ts import)
npm run prebuild           # regenerates .quartz/plugins/index.ts (required for tsc)
npm run check             # tsc --noEmit + prettier
env -u QUARTZ_ACL_PASSWORD npx quartz build   # must FAIL (exit != 0) when private notes exist
QUARTZ_ACL_PASSWORD=test-secret npx quartz build
# encrypted HTML count == 13:
grep -rl 'data-encrypted' public --include='*.html' | wc -l
# every encrypted note is listed in contentIndex.json (titles public):
python3 -c "import json; ci=json.load(open('public/static/contentIndex.json')); print('20-工作/工作规划/做好防御' in ci)"
# an only-encrypted folder still emits a folder page listing its notes:
test -f public/20-工作/工作规划/index.html
# password never leaked into any artifact:
grep -r 'test-secret' public/   # 0 matches
```

## Footguns

- A per-note explicit `password:` is respected and unlocks that page independently of the shared password.
- A per-note explicit `unlisted: false`/`true` is respected: `false` keeps it listed, `true` hides it from listings (and then it is also excluded from folder pages — an only-`true` folder would 404, as the folder-page emitter skips folders with no listed children).
- Public notes that link to a private note expose the private slug as a graph node (no content).
- Node < 22.18 silently skips loading the local `.ts` plugin and would publish plaintext again. Keep `.node-version` at >= v22.18.0.
