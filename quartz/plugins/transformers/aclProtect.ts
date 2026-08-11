import type { Root as MdastRoot } from "mdast"
import type { Root as HastRoot } from "hast"
import type { VFile } from "vfile"
import type { PluggableList } from "unified"
import type { QuartzTransformerPlugin } from "../types"

export interface AclProtectOptions {
  /**
   * Explicit shared password for private notes. Prefer the QUARTZ_ACL_PASSWORD
   * env var — a value committed in quartz.config.yaml becomes a tracked secret.
   */
  password?: string
  /** Env var name holding the shared password. Defaults to QUARTZ_ACL_PASSWORD. */
  envVar?: string
}

const PRIVATE_TAG = "@acl/private"
const DEFAULT_ENV_VAR = "QUARTZ_ACL_PASSWORD"

function isPrivateNote(frontmatter: Record<string, unknown>): boolean {
  const rawTags = frontmatter.tags
  const tags = Array.isArray(rawTags)
    ? (rawTags as unknown[]).filter((t): t is string => typeof t === "string")
    : typeof rawTags === "string"
      ? [rawTags]
      : []
  return tags.includes(PRIVATE_TAG) || frontmatter.access === "private"
}

/**
 * AclProtect — build-time ACL gate for private notes.
 *
 * Runs at order 35 in the markdown phase: after frontmatter parsing
 * (obsidian-flavored-markdown, order 30) and before @quartz-community/encrypted-pages
 * (html phase, order 900). For every note whose frontmatter is tagged "@acl/private"
 * (or access: "private"), it injects the single shared build-time password into
 * frontmatter.password (unless an explicit per-note password exists) and sets
 * frontmatter.unlisted = true (unless an explicit boolean exists), so the
 * encrypted-pages plugin encrypts the page and unlists it. After a correct unlock,
 * encrypted-pages' shadow index (static/encryptedContentIndex.json) re-adds the page
 * to graph/explorer/search for the session.
 *
 * Fail-loud: if any private note exists while no password is configured, the build
 * ABORTS (per-file throw -> createFileParser catch -> trace() -> process.exit(1) on
 * the main thread / rejected worker promise) instead of publishing plaintext.
 *
 * The password is resolved ONCE at factory time (config load), so worker threads
 * (which re-run loadQuartzConfig and inherit process.env) see the same value:
 *   opts.password ?? process.env[opts.envVar ?? "QUARTZ_ACL_PASSWORD"]
 */
export const AclProtect: QuartzTransformerPlugin<AclProtectOptions> = (opts) => {
  const envVar = opts?.envVar ?? DEFAULT_ENV_VAR
  const sharedPassword: string | undefined = opts?.password ?? process.env[envVar]

  if (opts?.password !== undefined) {
    console.warn(
      `[AclProtect] password supplied via quartz.config.yaml options. Prefer the ${envVar} env var so the secret is never committed.`,
    )
  }

  return {
    name: "AclProtect",
    markdownPlugins(): PluggableList {
      return [
        () => {
          return (_tree: MdastRoot, file: VFile) => {
            const frontmatter = file.data?.frontmatter as Record<string, unknown> | undefined
            if (!frontmatter) return
            if (!isPrivateNote(frontmatter)) return

            if (typeof sharedPassword !== "string" || sharedPassword.length === 0) {
              const where = String(file.data?.relativePath ?? file.data?.slug ?? file.path)
              throw new Error(
                `[AclProtect] Private note "${where}" has no password. ` +
                  `Set ${envVar} (or options.password) — refusing to publish private content as plaintext.`,
              )
            }

            // Respect explicit per-note overrides; never clobber an existing value.
            if (typeof frontmatter.password !== "string" || frontmatter.password.length === 0) {
              frontmatter.password = sharedPassword
            }
            if (typeof frontmatter.unlisted !== "boolean") {
              frontmatter.unlisted = true
            }

            // The @quartz-community/og-image emitter otherwise generates a per-note
            // <slug>-og-image.webp card rendering the note's title and injects an
            // og:image meta into the private page's <head>. That would leak the title
            // (and existence) to anyone who fetches the guessable slug URL, without a
            // password. Pin the social image to the site default so the emitter skips
            // per-note generation and the card shows a neutral image instead.
            if (
              typeof frontmatter.socialImage !== "string" ||
              frontmatter.socialImage.length === 0
            ) {
              frontmatter.socialImage = "og-image.png"
            }
          }
        },
      ]
    },
    htmlPlugins(): PluggableList {
      return [
        () => {
          return (_tree: HastRoot, file: VFile) => {
            const frontmatter = file.data?.frontmatter as Record<string, unknown> | undefined
            if (!frontmatter || !isPrivateNote(frontmatter)) return

            // Layout components render data derived from the plaintext AFTER the
            // body is replaced by the encrypted-pages div (order 900). The Table
            // of Contents and note-properties panels would otherwise expose the
            // private note's section headings and frontmatter to anonymous
            // visitors. Drop that derived data so those panels render nothing
            // until the visitor unlocks the page. (The ToC / note-properties
            // components return null when file.data.toc / file.data.noteProperties
            // are absent.)
            const data = file.data as Record<string, unknown>
            data.toc = undefined
            data.noteProperties = undefined
          }
        },
      ]
    },
  }
}
