// `<lush-embed doc-url="automerge:…">` — an embedded Patchwork document,
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
import { getRegistry, getSupportedToolsForType } from "@inkandswitch/patchwork-plugins"
import { el, svg } from "./dom.js"

const NAME = "lush-embed"

// Styles live with the element, since it renders into a shadow root. The
// custom properties come from the tool's stylesheet by inheritance.
const STYLE = `
  :host {
    display: block;
    margin: 0.75rem 0;
    user-select: none;
  }
  /* The window is a wrapper rather than the host: the editor owns the host's
     attributes and rewrites them, so nothing about how this renders can live
     up there. */
  .lush-embed-window {
    border: 1px solid var(--lush-line, currentColor);
    border-radius: 3px;
    background: var(--lush-fill, white);
    box-shadow: 2px 2px 0 color-mix(in oklch, var(--lush-line, black) 25%, transparent);
    overflow: hidden;
  }
  .lush-embed-bar {
    display: flex;
    align-items: center;
    gap: 6px;
    min-height: 22px;
    padding: 3px 6px;
    border-bottom: 1px solid var(--lush-line, currentColor);
    background-color: var(--lush-fill, white);
    background-image: repeating-linear-gradient(
      var(--lush-border, #ddd) 0px,
      var(--lush-border, #ddd) 1px,
      transparent 1px,
      transparent 3px
    );
    font: 600 0.8125rem var(--lush-family, system-ui, sans-serif);
  }
  .lush-embed-open {
    all: unset;
    flex-shrink: 0;
    width: 12px;
    height: 12px;
    border-radius: 2px;
    background: var(--lush-sunk, #eee);
    box-shadow:
      inset 1px 1px 0 color-mix(in oklch, var(--lush-line, black) 45%, transparent),
      inset -1px -1px 0 var(--lush-fill, white);
    cursor: pointer;
  }
  .lush-embed-open:hover { background: var(--lush-accent, gold); }
  .lush-embed-title {
    flex: 1;
    min-width: 0;
    padding: 0 6px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-align: center;
    background: var(--lush-fill, white);
    color: var(--lush-line, inherit);
  }
  .lush-embed-kind {
    all: unset;
    flex-shrink: 0;
    padding: 1px 5px;
    border-radius: 4px;
    font: 400 0.6875rem var(--lush-family, system-ui, sans-serif);
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--lush-muted, #888);
    background: var(--lush-fill, white);
    cursor: pointer;
  }
  .lush-embed-kind:hover { color: var(--lush-line, black); background: var(--lush-sunk, #eee); }
  .lush-embed-tools {
    padding: 6px;
    border-bottom: 1px solid var(--lush-border, #ddd);
    background: var(--lush-panel, #fafafa);
    font: 0.8125rem var(--lush-family, system-ui, sans-serif);
    color: var(--lush-line, inherit);
  }
  .lush-embed-tools[hidden] { display: none; }
  .lush-embed-tool-search {
    all: unset;
    box-sizing: border-box;
    width: 100%;
    padding: 4px 6px;
    border: 1px solid var(--lush-border, #ddd);
    border-radius: 6px;
    background: var(--lush-fill, white);
    color: var(--lush-line, inherit);
  }
  .lush-embed-tool-list { max-height: 9rem; overflow-y: auto; margin-top: 4px; }
  .lush-embed-tool {
    all: unset;
    display: flex;
    align-items: baseline;
    gap: 6px;
    width: 100%;
    box-sizing: border-box;
    padding: 4px 6px;
    border-radius: 5px;
    cursor: pointer;
  }
  .lush-embed-tool:hover { background: var(--lush-sunk, #eee); }
  .lush-embed-tool.current { background: color-mix(in oklch, var(--lush-accent, gold) 25%, transparent); }
  .lush-embed-tool-id {
    margin-left: auto;
    font-family: var(--lush-mono, monospace);
    font-size: 0.6875rem;
    color: var(--lush-muted, #888);
  }
  .lush-embed-tool-hint { padding: 4px 6px; font-size: 0.75rem; color: var(--lush-muted, #888); }
  .lush-embed-body { display: block; min-height: 2.5rem; max-height: 420px; overflow: hidden; }
  .lush-embed-body patchwork-view { display: block; width: 100%; height: 420px; }
  img, video { display: block; width: 100%; max-height: 420px; object-fit: contain; background: var(--lush-sunk, #eee); }
  audio { display: block; width: 100%; }

  /* Media is itself: no window, no titlebar, nothing to open. */
  .lush-embed-window.media {
    border: 0;
    border-radius: 0;
    background: none;
    box-shadow: none;
  }
  .media .lush-embed-bar { display: none; }
  .media .lush-embed-body { max-height: none; }
  .lush-embed-loading { display: grid; place-items: center; height: 3rem; color: var(--lush-faint, #bbb); }
`

// Media renders as itself. The mime type's top level is the element's name,
// which is the whole mapping.
function mediaKind(mimeType) {
  const kind = String(mimeType ?? "").split("/")[0]
  return kind === "image" || kind === "video" || kind === "audio" ? kind : null
}

async function loadDoc(url) {
  const repo = globalThis.repo
  if (!repo || !url) return null
  try {
    const handle = await repo.find(url)
    return handle.doc() ?? null
  } catch (error) {
    console.warn("lush: could not load embedded document", url, error)
    return null
  }
}

// The tools registered for a datatype, if the host has a registry.
function toolsFor(type) {
  try {
    return (getSupportedToolsForType(type) ?? []).filter(tool => !tool.unlisted)
  } catch {
    return []
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

class LushEmbed extends HTMLElement {
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
    this.title$ = el("span", { class: "lush-embed-title" })
    this.open$ = el("button", {
      class: "lush-embed-open",
      type: "button",
      title: "Open document",
      onclick: event => {
        event.preventDefault()
        event.stopPropagation()
        const url = this.getAttribute("doc-url")
        if (url) openDocument(this, url, this.getAttribute("tool-id") || undefined)
      },
    })
    this.kind$ = el("button", {
      class: "lush-embed-kind",
      type: "button",
      title: "Choose the tool that renders this document",
      onclick: event => {
        event.preventDefault()
        event.stopPropagation()
        this.toggleTools()
      },
    })
    this.body$ = el("div", { class: "lush-embed-body" })
    this.tools$ = el("div", { class: "lush-embed-tools", hidden: true })
    this.window$ = el(
      "div",
      { class: "lush-embed-window" },
      el("div", { class: "lush-embed-bar" }, this.open$, this.title$, this.kind$),
      this.tools$,
      this.body$,
    )
    this.shadowRoot.append(this.window$)
  }

  // A filterable list of the tools that can render this document. Typing a
  // name filters; typing anything and pressing Enter sets that tool id, so a
  // tool the registry doesn't know about can still be used.
  toggleTools() {
    if (!this.tools$.hidden) return this.closeTools()
    const current = this.getAttribute("tool-id") ?? ""
    const tools = toolsFor(this.docType ?? "")
    const list = el("div", { class: "lush-embed-tool-list" })

    const choose = id => {
      this.closeTools()
      // The element doesn't own the document; the editor listens for this.
      this.dispatchEvent(
        new CustomEvent("lush-embed-tool", {
          detail: { toolId: id || null },
          bubbles: true,
          composed: true,
        }),
      )
    }

    const search = el("input", {
      class: "lush-embed-tool-search",
      type: "text",
      placeholder: "Tool id…",
      value: current,
      oninput: () => draw(search.value.trim().toLowerCase()),
      onkeydown: event => {
        if (event.key === "Escape") return this.closeTools()
        if (event.key !== "Enter") return
        event.preventDefault()
        const typed = search.value.trim()
        const shown = list.querySelector(".lush-embed-tool")
        // Enter takes the first match, or the id as typed.
        choose(shown && shown.dataset.tool.startsWith(typed) ? shown.dataset.tool : typed)
      },
    })

    const draw = query => {
      const matching = tools.filter(
        tool =>
          !query ||
          tool.id.toLowerCase().includes(query) ||
          String(tool.name ?? "").toLowerCase().includes(query),
      )
      list.replaceChildren(
        el(
          "button",
          {
            class: current ? "lush-embed-tool" : "lush-embed-tool current",
            type: "button",
            "data-tool": "",
            onclick: () => choose(""),
          },
          "Default tool",
        ),
        ...matching.map(tool =>
          el(
            "button",
            {
              class: tool.id === current ? "lush-embed-tool current" : "lush-embed-tool",
              type: "button",
              "data-tool": tool.id,
              onclick: () => choose(tool.id),
            },
            el("span", {}, tool.name ?? tool.id),
            el("span", { class: "lush-embed-tool-id" }, tool.id),
          ),
        ),
      )
      if (!matching.length && query) {
        list.append(el("div", { class: "lush-embed-tool-hint" }, "↵ to use this id"))
      }
    }

    draw("")
    this.tools$.replaceChildren(search, list)
    this.tools$.hidden = false
    this.onDismiss = event => {
      if (!this.contains(event.target) && !this.shadowRoot.contains(event.target)) this.closeTools()
    }
    document.addEventListener("mousedown", this.onDismiss, true)
    search.focus()
    search.select()
  }

  closeTools() {
    this.tools$.hidden = true
    this.tools$.replaceChildren()
    if (this.onDismiss) document.removeEventListener("mousedown", this.onDismiss, true)
  }

  disconnectedCallback() {
    this.closeTools()
  }

  async render() {
    const url = this.getAttribute("doc-url")
    const tool = this.getAttribute("tool-id") ?? ""
    if (url === this.rendered && tool === this.renderedTool) return
    this.rendered = url
    this.renderedTool = tool
    this.title$.textContent = "…"
    this.kind$.textContent = ""
    this.body$.replaceChildren(
      el("div", { class: "lush-embed-loading" }, svg(`<circle cx="8" cy="8" r="5"/>`)),
    )
    if (!url) return

    const doc = await loadDoc(url)
    if (this.rendered !== url) return
    const type = doc?.["@patchwork"]?.type ?? ""
    const media = type === "file" ? mediaKind(doc?.mimeType) : null

    this.docType = type
    this.title$.textContent = await titleOf(doc, type)
    this.kind$.textContent = this.getAttribute("tool-id") || type || "tool"
    // A picture, a video or a sound is just itself: no window, no tool, no
    // chrome to open. Anything else is a document, and gets the window. Asking
    // for a tool by id is asking for the document, so that wins.
    const inline = this.getAttribute("tool-id") ? null : media
    this.window$.className = inline
      ? `lush-embed-window media ${inline}`
      : "lush-embed-window"
    if (this.rendered !== url) return

    this.body$.replaceChildren(
      inline
        ? el(inline === "image" ? "img" : inline, {
            class: `lush-embed-${inline}`,
            src: automergeUrlToServiceWorkerUrl(url),
            ...(inline === "image" ? {} : { controls: true, preload: "metadata" }),
          })
        : el("patchwork-view", {
            "doc-url": url,
            ...(this.getAttribute("tool-id") ? { "tool-id": this.getAttribute("tool-id") } : {}),
          }),
    )
  }
}

export function defineEmbedElement() {
  if (!customElements.get(NAME)) customElements.define(NAME, LushEmbed)
}
