// An HTML block: a scrap of markup that renders as itself. chee's Swift notes
// app writes these as an `html` block whose `html` attr is the source and
// renders it in its own web view, so this renders it in a sandboxed iframe —
// isolated from the editor's own page the same way.
//
// The pencil asks the editor to edit it (see htmlEditing in features.js): the
// element draws, the document is the editor's business.
import { Leaf } from "wordgard/doc"
import { Dialog, Wordgard } from "wordgard/editor"
import { el } from "./dom.js"

const NAME = "rich-html"

export const HtmlBlock = Leaf.Type.define("HtmlBlock", {
  inline: true,
  validate: "string",
  selectable: true,
  shape: {
    element: NAME,
    attributes: source => ({ source }),
  },
})

export const HTML_PLACEHOLDER = "<p>hello</p>"

export function insertHtmlBlock(wg) {
  wg.dispatch({
    changes: {
      from: wg.state.selection.head,
      insert: [HtmlBlock.of(HTML_PLACEHOLDER)],
      fit: true,
    },
    scrollIntoView: true,
  })
  wg.focus()
}

// The source, in a textarea, replacing the leaf it came from.
function editHtml(wg, element) {
  let found
  try {
    found = wg.nodeFromDOM(element)
  } catch {
    return
  }
  if (!found) return
  const node = wg.state.doc.resolve(found.pos).nodeAfter
  if (!node) return
  const { result } = Dialog.show(wg, {
    class: "rich-dialog rich-html-dialog",
    focus: "textarea",
    content: () =>
      el(
        "form",
        {},
        el("label", {}, "HTML"),
        el("textarea", { name: "html", rows: 8, spellcheck: "false" }, node.param),
        el("button", { type: "submit" }, "Save"),
      ),
  })
  result.then(form => {
    const source = form?.elements?.html?.value
    if (source == null) return
    // The document may have moved under the dialog, so ask again.
    let at
    try {
      at = wg.nodeFromDOM(element)
    } catch {
      return
    }
    if (!at) return
    wg.dispatch({
      changes: { from: at.pos, to: at.pos + 1, insert: [HtmlBlock.of(source)] },
      userEvent: "html.edit",
    })
  })
}

export function htmlEditing() {
  return Wordgard.Plugin.define(wg => {
    const onEdit = event => {
      const element = event.target.closest?.(NAME) ?? event.target
      editHtml(wg, element)
    }
    return {
      connect: () => wg.dom.addEventListener("rich-html-edit", onEdit),
      disconnect: () => wg.dom.removeEventListener("rich-html-edit", onEdit),
      remove: () => wg.dom.removeEventListener("rich-html-edit", onEdit),
    }
  }).extension
}

const STYLE = `
  :host {
    display: block;
    margin: 0.75rem 0;
    user-select: none;
  }
  .rich-html {
    position: relative;
    border: 1px solid var(--rich-border, #ddd);
    border-radius: 8px;
    overflow: hidden;
    background: var(--rich-fill, white);
  }
  iframe { display: block; width: 100%; height: 220px; border: 0; background: white; }
  .rich-html-edit {
    all: unset;
    position: absolute;
    top: 4px;
    right: 4px;
    padding: 2px 6px;
    border-radius: 5px;
    background: var(--rich-fill, white);
    color: var(--rich-muted, #888);
    font: 0.75rem var(--rich-family, system-ui, sans-serif);
    cursor: pointer;
  }
  .rich-html-edit:hover { color: var(--rich-line, black); }
`

class RichHtml extends HTMLElement {
  static observedAttributes = ["source"]

  connectedCallback() {
    this.contentEditable = "false"
    if (!this.shadowRoot) {
      this.attachShadow({ mode: "open" })
      this.shadowRoot.append(el("style", {}, STYLE))
      this.build()
    }
  }

  attributeChangedCallback() {
    if (this.shadowRoot) this.build()
  }

  build() {
    const source = this.getAttribute("source") ?? ""
    const frame = this.shadowRoot.querySelector("iframe")
    if (frame) {
      frame.srcdoc = source
      return
    }
    this.shadowRoot.append(
      el(
        "div",
        { class: "rich-html" },
        el("iframe", { sandbox: "allow-scripts", srcdoc: source }),
        el("button", {
          class: "rich-html-edit",
          title: "Edit HTML",
          onclick: () =>
            this.dispatchEvent(new CustomEvent("rich-html-edit", { bubbles: true, composed: true })),
        }, "✎"),
      ),
    )
  }
}

if (!customElements.get(NAME)) customElements.define(NAME, RichHtml)
