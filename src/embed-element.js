// `<rich-embed doc-url="automerge:…">` — an embedded Patchwork document,
// rendered the way `space` renders one on its canvas: a System-7-ish window
// with a striped titlebar, the document's name, and an open box that navigates
// to it. Image file documents render as an `<img>`; everything else mounts a
// `<patchwork-view>`.
//
// It is a custom element rather than DOM the editor builds, for the same
// reason `<patchwork-view>` is: the node is an atom, so the element owns and
// updates its own insides without wordgard's DOM observer having to know.
import { openDocument } from "@inkandswitch/patchwork-elements"
import { automergeUrlToServiceWorkerUrl } from "@inkandswitch/patchwork-filesystem"
import { getRegistry } from "@inkandswitch/patchwork-plugins"
import { el, svg } from "./dom.js"

const NAME = "rich-embed"

// Styles live with the element, since it renders into a shadow root. The
// custom properties come from the tool's stylesheet by inheritance.
const STYLE = `
  :host {
    display: block;
    margin: 0.75rem 0;
    border: 1px solid var(--rich-line, currentColor);
    border-radius: 3px;
    background: var(--rich-fill, white);
    box-shadow: 2px 2px 0 color-mix(in oklch, var(--rich-line, black) 25%, transparent);
    overflow: hidden;
    user-select: none;
  }
  .rich-embed-bar {
    display: flex;
    align-items: center;
    gap: 6px;
    min-height: 22px;
    padding: 3px 6px;
    border-bottom: 1px solid var(--rich-line, currentColor);
    background-color: var(--rich-fill, white);
    background-image: repeating-linear-gradient(
      var(--rich-border, #ddd) 0px,
      var(--rich-border, #ddd) 1px,
      transparent 1px,
      transparent 3px
    );
    font: 600 0.8125rem var(--rich-family, system-ui, sans-serif);
  }
  .rich-embed-open {
    all: unset;
    flex-shrink: 0;
    width: 12px;
    height: 12px;
    border-radius: 2px;
    background: var(--rich-sunk, #eee);
    box-shadow:
      inset 1px 1px 0 color-mix(in oklch, var(--rich-line, black) 45%, transparent),
      inset -1px -1px 0 var(--rich-fill, white);
    cursor: pointer;
  }
  .rich-embed-open:hover { background: var(--rich-accent, gold); }
  .rich-embed-title {
    flex: 1;
    min-width: 0;
    padding: 0 6px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-align: center;
    background: var(--rich-fill, white);
    color: var(--rich-line, inherit);
  }
  .rich-embed-kind {
    flex-shrink: 0;
    padding-left: 4px;
    font-size: 0.6875rem;
    font-weight: 400;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--rich-muted, #888);
    background: var(--rich-fill, white);
  }
  .rich-embed-body { display: block; min-height: 2.5rem; max-height: 420px; overflow: hidden; }
  .rich-embed-body patchwork-view { display: block; width: 100%; height: 420px; }
  img { display: block; width: 100%; max-height: 420px; object-fit: contain; background: var(--rich-sunk, #eee); }
  .rich-embed-loading { display: grid; place-items: center; height: 3rem; color: var(--rich-faint, #bbb); }
`

async function loadDoc(url) {
  const repo = globalThis.repo
  if (!repo || !url) return null
  try {
    const handle = await repo.find(url)
    return handle.doc() ?? null
  } catch (error) {
    console.warn("rich: could not load embedded document", url, error)
    return null
  }
}

// The document's own title, via its datatype when one is registered.
async function titleOf(doc, type) {
  if (!doc) return "Document"
  try {
    const loaded = await getRegistry("patchwork:datatype")?.load?.(type)
    const title = loaded?.module?.getTitle?.(doc)
    if (title) return String(title)
  } catch {
    // fall through to the document's own fields
  }
  return String(doc.title ?? doc.name ?? type ?? "Document")
}

class RichEmbed extends HTMLElement {
  static observedAttributes = ["doc-url", "tool-id"]

  connectedCallback() {
    this.contentEditable = "false"
    // Shadow DOM, so the editor's own rendering of this atom can't wipe the
    // chrome the element builds for itself. Custom properties still inherit
    // in, so the theme reaches the styles below.
    if (!this.shadowRoot) {
      this.attachShadow({ mode: "open" })
      this.shadowRoot.append(el("style", {}, STYLE))
      this.build()
    }
    this.render()
  }

  attributeChangedCallback() {
    if (this.isConnected) this.render()
  }

  build() {
    this.title$ = el("span", { class: "rich-embed-title" })
    this.open$ = el("button", {
      class: "rich-embed-open",
      type: "button",
      title: "Open document",
      onclick: event => {
        event.preventDefault()
        event.stopPropagation()
        const url = this.getAttribute("doc-url")
        if (url) openDocument(this, url, this.getAttribute("tool-id") || undefined)
      },
    })
    this.kind$ = el("span", { class: "rich-embed-kind" })
    this.body$ = el("div", { class: "rich-embed-body" })
    this.shadowRoot.append(
      el("div", { class: "rich-embed-bar" }, this.open$, this.title$, this.kind$),
      this.body$,
    )
  }

  async render() {
    const url = this.getAttribute("doc-url")
    if (url === this.rendered) return
    this.rendered = url
    this.title$.textContent = "…"
    this.kind$.textContent = ""
    this.body$.replaceChildren(
      el("div", { class: "rich-embed-loading" }, svg(`<circle cx="8" cy="8" r="5"/>`)),
    )
    if (!url) return

    const doc = await loadDoc(url)
    if (this.rendered !== url) return
    const type = doc?.["@patchwork"]?.type ?? ""
    const isImage = type === "file" && String(doc?.mimeType ?? "").startsWith("image/")

    this.title$.textContent = await titleOf(doc, type)
    this.kind$.textContent = type
    this.dataset.kind = isImage ? "image" : type || "document"
    if (this.rendered !== url) return

    this.body$.replaceChildren(
      isImage
        ? el("img", { class: "rich-embed-image", src: automergeUrlToServiceWorkerUrl(url) })
        : el("patchwork-view", {
            "doc-url": url,
            ...(this.getAttribute("tool-id") ? { "tool-id": this.getAttribute("tool-id") } : {}),
          }),
    )
  }
}

export function defineEmbedElement() {
  if (!customElements.get(NAME)) customElements.define(NAME, RichEmbed)
}
