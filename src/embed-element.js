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
import { getRegistry, getSupportedToolsForType } from "@inkandswitch/patchwork-plugins"
import { el, svg } from "./dom.js"

const NAME = "rich-embed"

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
  .rich-embed-window {
    border: 1px solid var(--rich-line, currentColor);
    border-radius: 3px;
    background: var(--rich-fill, white);
    box-shadow: 2px 2px 0 color-mix(in oklch, var(--rich-line, black) 25%, transparent);
    overflow: hidden;
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
    all: unset;
    flex-shrink: 0;
    padding: 1px 5px;
    border-radius: 4px;
    font: 400 0.6875rem var(--rich-family, system-ui, sans-serif);
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--rich-muted, #888);
    background: var(--rich-fill, white);
    cursor: pointer;
  }
  .rich-embed-kind:hover { color: var(--rich-line, black); background: var(--rich-sunk, #eee); }
  .rich-embed-tools {
    padding: 6px;
    border-bottom: 1px solid var(--rich-border, #ddd);
    background: var(--rich-panel, #fafafa);
    font: 0.8125rem var(--rich-family, system-ui, sans-serif);
    color: var(--rich-line, inherit);
  }
  .rich-embed-tools[hidden] { display: none; }
  .rich-embed-tool-search {
    all: unset;
    box-sizing: border-box;
    width: 100%;
    padding: 4px 6px;
    border: 1px solid var(--rich-border, #ddd);
    border-radius: 6px;
    background: var(--rich-fill, white);
    color: var(--rich-line, inherit);
  }
  .rich-embed-tool-list { max-height: 9rem; overflow-y: auto; margin-top: 4px; }
  .rich-embed-tool {
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
  .rich-embed-tool:hover { background: var(--rich-sunk, #eee); }
  .rich-embed-tool.current { background: color-mix(in oklch, var(--rich-accent, gold) 25%, transparent); }
  .rich-embed-tool-id {
    margin-left: auto;
    font-family: var(--rich-mono, monospace);
    font-size: 0.6875rem;
    color: var(--rich-muted, #888);
  }
  .rich-embed-tool-hint { padding: 4px 6px; font-size: 0.75rem; color: var(--rich-muted, #888); }
  .rich-embed-body { display: block; min-height: 2.5rem; max-height: 420px; overflow: hidden; }
  .rich-embed-body patchwork-view { display: block; width: 100%; height: 420px; }
  /* The picture is the box: its own size, capped at the column width. */
  img, video { display: block; max-width: 100%; height: auto; }
  audio { display: block; width: 100%; }

  /* Media is itself: no window, no titlebar, nothing to open. */
  .rich-embed-window.media {
    width: fit-content;
    max-width: 100%;
    border: 0;
    border-radius: 0;
    background: none;
    box-shadow: none;
  }
  .media .rich-embed-bar { display: none; }
  .media .rich-embed-body { max-height: none; }
  .rich-embed-loading { display: grid; place-items: center; height: 3rem; color: var(--rich-faint, #bbb); }
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
    console.warn("rich: could not load embedded document", url, error)
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
    this.kind$ = el("button", {
      class: "rich-embed-kind",
      type: "button",
      title: "Choose the tool that renders this document",
      onclick: event => {
        event.preventDefault()
        event.stopPropagation()
        this.toggleTools()
      },
    })
    this.body$ = el("div", { class: "rich-embed-body" })
    this.tools$ = el("div", { class: "rich-embed-tools", hidden: true })
    this.window$ = el(
      "div",
      { class: "rich-embed-window" },
      el("div", { class: "rich-embed-bar" }, this.open$, this.title$, this.kind$),
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
    const list = el("div", { class: "rich-embed-tool-list" })

    const choose = id => {
      this.closeTools()
      // The element doesn't own the document; the editor listens for this.
      this.dispatchEvent(
        new CustomEvent("rich-embed-tool", {
          detail: { toolId: id || null },
          bubbles: true,
          composed: true,
        }),
      )
    }

    const search = el("input", {
      class: "rich-embed-tool-search",
      type: "text",
      placeholder: "Tool id…",
      value: current,
      oninput: () => draw(search.value.trim().toLowerCase()),
      onkeydown: event => {
        if (event.key === "Escape") return this.closeTools()
        if (event.key !== "Enter") return
        event.preventDefault()
        const typed = search.value.trim()
        const shown = list.querySelector(".rich-embed-tool")
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
            class: current ? "rich-embed-tool" : "rich-embed-tool current",
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
              class: tool.id === current ? "rich-embed-tool current" : "rich-embed-tool",
              type: "button",
              "data-tool": tool.id,
              onclick: () => choose(tool.id),
            },
            el("span", {}, tool.name ?? tool.id),
            el("span", { class: "rich-embed-tool-id" }, tool.id),
          ),
        ),
      )
      if (!matching.length && query) {
        list.append(el("div", { class: "rich-embed-tool-hint" }, "↵ to use this id"))
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
      el("div", { class: "rich-embed-loading" }, svg(`<circle cx="8" cy="8" r="5"/>`)),
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
      ? `rich-embed-window media ${inline}`
      : "rich-embed-window"
    if (this.rendered !== url) return

    this.body$.replaceChildren(
      inline
        ? el(inline === "image" ? "img" : inline, {
            class: `rich-embed-${inline}`,
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

// Registering as the module loads, rather than from the tool's render, keeps
// the element's definition out of the render path entirely: any <rich-embed>
// already in the page upgrades itself when this runs.
if (!customElements.get(NAME)) customElements.define(NAME, RichEmbed)
