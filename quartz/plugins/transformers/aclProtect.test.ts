import test, { describe } from "node:test"
import assert from "node:assert"
import vm from "node:vm"
import { EncryptedPage, encryptAesGcm, decrypt } from "@quartz-community/encrypted-pages"
import { AclProtect } from "./aclProtect"

const PASSWORD = "test-password"
const ITERATIONS = 1000 // keep the test fast; the layout is independent of the count

describe("encrypted-pages unlock procedure", () => {
  test("a body encrypted at build time unlocks back to its original HTML", () => {
    const body = "<h1>Secret</h1>\n<p>top secret content</p>"
    const ciphertext = encryptAesGcm(body, PASSWORD, ITERATIONS)

    assert.equal(decrypt(ciphertext, PASSWORD, ITERATIONS), body)
  })

  test("a wrong password is rejected", () => {
    const ciphertext = encryptAesGcm("<p>secret</p>", PASSWORD, ITERATIONS)
    assert.throws(() => decrypt(ciphertext, "wrong-password", ITERATIONS))
  })

  test("a shadow-index entry (slug + entry JSON) round-trips under the page password", () => {
    const shadowEntry = {
      slug: "10-computescience/ai/rdma笔记",
      entry: {
        slug: "10-computescience/ai/rdma笔记",
        filePath: "10-ComputeScience/AI/RDMA笔记.md",
        title: "RDMA笔记",
        links: [],
        tags: ["@acl/private"],
        content: "",
        description: "",
      },
    }
    const ciphertext = encryptAesGcm(JSON.stringify(shadowEntry), PASSWORD, ITERATIONS)
    assert.deepEqual(JSON.parse(decrypt(ciphertext, PASSWORD, ITERATIONS)), shadowEntry)
  })
})

describe("client-side unlock script", () => {
  const script = (EncryptedPage() as unknown as { afterDOMLoaded: string }).afterDOMLoaded

  // Minimal DOM stub that satisfies exactly what the encrypted-pages client
  // script touches. Node 22 provides WebCrypto, so window.crypto.subtle is real.
  function makeEl(className = ""): any {
    const node: any = {
      tagName: "div",
      className,
      style: {},
      textContent: "",
      value: "",
      disabled: false,
      children: [],
      parentElement: { tagName: "div" },
      replaced: false,
      decryptedText: "",
      childNodes: [],
      listeners: {},
      getAttribute(name: string) {
        return node[name] ?? null
      },
      setAttribute() {},
      addEventListener(type: string, fn: (...args: unknown[]) => unknown) {
        node.listeners[type] = fn
      },
      removeEventListener() {},
      matches(sel: string) {
        const classes = sel.split(".").filter(Boolean)
        return classes.every((c) => String(node.className).split(" ").includes(c))
      },
      querySelector(sel: string) {
        for (const child of node.children) {
          if (child.matches?.(sel)) return child
          const found = child.querySelector?.(sel)
          if (found) return found
        }
        return null
      },
      appendChild(child: any) {
        node.children.push(child)
        return child
      },
      replaceWith(...nodes: any[]) {
        node.replaced = true
        node.decryptedText = nodes.map((n) => n?.__text ?? "").join("")
      },
      focus() {},
    }
    Object.defineProperty(node, "innerHTML", {
      get: () => node.__html,
      set: (v: string) => {
        node.__html = v
        node.childNodes = [{ __text: v }]
      },
    })
    return node
  }

  interface Sandbox {
    sandbox: Record<string, unknown>
    pageEl: any
    input: any
    submit: any
    error: any
    dispatched: CustomEvent[]
    contentIndex: Record<string, unknown>
  }

  function buildSandbox(shadowEntries: { ciphertext: string; iterations: number }[] = []): Sandbox {
    const pageEl = makeEl("encrypted-page popover-hint")
    const input = makeEl("encrypted-page-input")
    const submit = makeEl("encrypted-page-submit")
    const error = makeEl("encrypted-page-error")
    const form = makeEl("encrypted-page-form")
    form.children = [input, submit, error]

    const dispatched: CustomEvent[] = []
    const listeners: Record<string, ((ev: CustomEvent) => void)[]> = {}
    const contentIndex: Record<string, unknown> = {}
    let formCreated = false

    const documentStub = {
      baseURI: "http://localhost:1313/obsidian/some-folder/some-page.html",
      querySelectorAll(sel: string) {
        if (sel === ".encrypted-page") return [pageEl]
        return []
      },
      createElement() {
        if (!formCreated) {
          formCreated = true
          return form
        }
        return makeEl()
      },
      addEventListener(type: string, fn: (ev: CustomEvent) => void) {
        ;(listeners[type] ??= []).push(fn)
      },
      removeEventListener() {},
      dispatchEvent(ev: CustomEvent) {
        dispatched.push(ev)
        for (const fn of listeners[ev.type] ?? []) fn(ev)
        return true
      },
      body: { tagName: "body" },
    }

    const storage = new Map<string, string>()
    const sessionStorage = {
      getItem(k: string) {
        return storage.get(k) ?? null
      },
      setItem(k: string, v: string) {
        storage.set(k, v)
      },
    }

    const sandbox: Record<string, unknown> = {
      window: { crypto: globalThis.crypto },
      document: documentStub,
      sessionStorage,
      fetch: async () => ({
        ok: true,
        json: async () => ({ version: 1, entries: shadowEntries }),
      }),
      fetchData: { content: contentIndex },
      CustomEvent,
      MutationObserver: class {
        constructor(_cb: () => void) {}
        observe() {}
        disconnect() {}
      },
      HTMLElement: class {},
      TextEncoder,
      TextDecoder,
      URL,
      atob,
    }

    return { sandbox, pageEl, input, submit, error, dispatched, contentIndex }
  }

  async function unlockWith(entry: Sandbox, password: string) {
    vm.runInNewContext(script, entry.sandbox)
    ;(entry.sandbox.document as { dispatchEvent: (e: CustomEvent) => boolean }).dispatchEvent(
      new CustomEvent("render"),
    )
    entry.input.value = password
    await entry.submit.listeners.click()
    // The client's E() kicks off f() (shadow-index decrypt + content-index patch)
    // as fire-and-forget async work after the reveal; give the microtask chain a
    // macrotask to settle so the reveal events are observable.
    await new Promise((resolve) => setTimeout(resolve, 20))
  }

  test("correct password reveals the body, caches it, and fires render", async () => {
    const body = "<h1>Secret</h1><p>the private content</p>"
    const ciphertext = encryptAesGcm(body, PASSWORD, ITERATIONS)
    const entry = buildSandbox()
    entry.pageEl["data-encrypted"] = ciphertext
    entry.pageEl["data-iterations"] = String(ITERATIONS)

    await unlockWith(entry, PASSWORD)

    assert.equal(entry.pageEl.decryptedText, body)
    assert.equal(entry.pageEl.replaced, true)
    assert.ok(
      entry.dispatched.some((e) => e.type === "render"),
      "a render event must fire after unlock",
    )
    const cached = JSON.parse(
      (entry.sandbox.sessionStorage as { getItem: (k: string) => string }).getItem(
        "encrypted-pages-passwords",
      ),
    )
    assert.deepEqual(cached, [PASSWORD])
  })

  test("correct password also decrypts the shadow index and patches the content index", async () => {
    const slug = "20-工作/工作规划/做好防御"
    const shadowEntry = {
      slug,
      entry: {
        slug,
        filePath: "20-工作/工作规划/做好防御.md",
        title: "做好防御",
        links: [],
        tags: [],
      },
    }
    const ciphertext = encryptAesGcm(JSON.stringify(shadowEntry), PASSWORD, ITERATIONS)
    const body = "<h1>防御</h1><p>content</p>"

    const entry = buildSandbox([{ ciphertext, iterations: ITERATIONS }])
    entry.pageEl["data-encrypted"] = encryptAesGcm(body, PASSWORD, ITERATIONS)
    entry.pageEl["data-iterations"] = String(ITERATIONS)

    await unlockWith(entry, PASSWORD)

    // The page's body is revealed...
    assert.equal(entry.pageEl.decryptedText, body)
    // ...and the shadow entry was merged into the in-memory content index,
    // which is what makes the note appear in Explorer/search/graph.
    assert.deepEqual(entry.contentIndex[slug], shadowEntry.entry)
    const updated = entry.dispatched.filter((e) => e.type === "content-index-updated")
    assert.equal(updated.length, 1)
    assert.deepEqual((updated[0] as CustomEvent & { detail: { slugs: string[] } }).detail.slugs, [
      slug,
    ])
  })

  test("a wrong password shows an error and reveals nothing", async () => {
    const body = "<h1>Secret</h1>"
    const entry = buildSandbox()
    entry.pageEl["data-encrypted"] = encryptAesGcm(body, PASSWORD, ITERATIONS)
    entry.pageEl["data-iterations"] = String(ITERATIONS)

    await unlockWith(entry, "not-the-password")

    assert.equal(entry.pageEl.replaced, false)
    assert.equal(entry.pageEl.decryptedText, "")
    assert.ok(entry.error.textContent.includes("Incorrect password"))
    assert.ok(
      !entry.dispatched.some((e) => e.type === "content-index-updated"),
      "no content-index-updated event on a failed unlock",
    )
  })
})

describe("AclProtect build-time transformer", () => {
  type MdPlugin = (tree: unknown, file: { data: { frontmatter: Record<string, any> } }) => void

  function runMarkdownPlugin(file: { data: { frontmatter: Record<string, any> } }) {
    const instance = AclProtect({ password: PASSWORD })
    // AclProtect ignores the ctx argument; cast the method to a zero-arg call.
    const [factory] = (instance.markdownPlugins as unknown as () => unknown[])() as [() => MdPlugin]
    const plugin = factory()
    plugin({}, file)
    return file.data.frontmatter
  }

  test("injects the shared password and a neutral social image, but does NOT unlist", () => {
    const fm = runMarkdownPlugin({
      data: { frontmatter: { title: "x", tags: ["@acl/private"], access: "private" } },
    })
    assert.equal(fm.password, PASSWORD)
    assert.equal(fm.socialImage, "og-image.png")
    assert.equal(fm.unlisted, undefined)
  })

  test("respects an explicit per-note password override", () => {
    const fm = runMarkdownPlugin({
      data: { frontmatter: { title: "x", tags: ["@acl/private"], password: "my-own" } },
    })
    assert.equal(fm.password, "my-own")
  })

  test("leaves non-private notes untouched", () => {
    const fm = runMarkdownPlugin({
      data: { frontmatter: { title: "public", tags: ["notes"] } },
    })
    assert.equal(fm.password, undefined)
    assert.equal(fm.socialImage, undefined)
  })

  test("fails loudly when a private note has no password available", () => {
    const previous = process.env.QUARTZ_ACL_PASSWORD
    delete process.env.QUARTZ_ACL_PASSWORD
    try {
      const instance = AclProtect({})
      const [factory] = (instance.markdownPlugins as unknown as () => unknown[])() as [
        () => MdPlugin,
      ]
      const plugin = factory()
      const file = { data: { frontmatter: { title: "x", tags: ["@acl/private"] } } }
      assert.throws(() => plugin({}, file), /QUARTZ_ACL_PASSWORD/)
    } finally {
      if (previous !== undefined) process.env.QUARTZ_ACL_PASSWORD = previous
    }
  })
})
