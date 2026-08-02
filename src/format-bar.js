// A floating bar over the selection, in place of a permanent toolbar.
import { Dialog, Wordgard } from "wordgard/editor"
import {
  Command,
  setTextblockType,
  toggleMark,
  toggleEmphasis,
  toggleStrong,
  wrapBlock,
} from "wordgard/command"
import { Blockquote, Code, Emphasis, Heading, Link, Paragraph, Strong } from "wordgard/types"
import { HIGHLIGHTS, highlightAt, highlightChanges } from "./highlight.js"
import { CellSelection } from "wordgard/table"
import { TABLE_ACTIONS } from "./tables.js"
import { el } from "./dom.js"

function marksAt(state) {
  const { from, to } = state.selection
  return state.doc.resolve(from).marks(from === to ? undefined : state.doc.resolve(to))
}

function headingLevel(state) {
  const block = state.sel.head.textblockParent
  return block?.node.tag.type === Heading ? block.node.tag.param : null
}

function linkAt(state) {
  return marksAt(state).find(mark => mark.type === Link) ?? null
}

const ACTIONS = [
  {
    id: "strong",
    label: "B",
    title: "Bold",
    active: state => Strong.isInSet(marksAt(state)),
    run: wg => Command.dispatch(wg, toggleStrong),
  },
  {
    id: "emphasis",
    label: "i",
    title: "Italic",
    active: state => Emphasis.isInSet(marksAt(state)),
    run: wg => Command.dispatch(wg, toggleEmphasis),
  },
  {
    id: "code",
    label: "‹›",
    title: "Code",
    active: state => Code.isInSet(marksAt(state)),
    run: wg => Command.dispatch(wg, toggleMark, Code),
  },
  {
    id: "link",
    label: "↗",
    title: "Link",
    active: state => Boolean(linkAt(state)),
    run: editLink,
  },
  { separator: true },
  {
    id: "h1",
    label: "H1",
    title: "Heading 1",
    active: state => headingLevel(state) === 1,
    run: wg => toggleHeading(wg, 1),
  },
  {
    id: "h2",
    label: "H2",
    title: "Heading 2",
    active: state => headingLevel(state) === 2,
    run: wg => toggleHeading(wg, 2),
  },
  {
    id: "quote",
    label: "❝",
    title: "Quote",
    active: state => Boolean(state.sel.head.matchingParent(plot => plot.tag === Blockquote)),
    run: wg => Command.dispatch(wg, wrapBlock, Blockquote),
  },
  // Selecting cells (with the table grips, or by dragging across them) swaps
  // the character formatting for the table's own verbs.
  { separator: true, when: cellSelection },
  ...TABLE_ACTIONS.map(action => ({ ...action, when: cellSelection })),
]

function cellSelection(state) {
  return state.selection instanceof CellSelection
}

// How far the bar keeps off the selection and off the edges it is clamped to.
const GAP = 8

// A lower bound that wins, so a bar wider than the space it has left still
// starts on screen rather than being pushed off the other side.
const clamp = (value, low, high) => Math.max(low, Math.min(value, high))

function toggleHeading(wg, level) {
  const tag = headingLevel(wg.state) === level ? Paragraph : Heading.of(level)
  Command.dispatch(wg, setTextblockType, tag)
}

function editLink(wg) {
  const existing = linkAt(wg.state)
  if (existing) return Command.dispatch(wg, toggleMark, existing)
  const { result } = Dialog.show(wg, {
    class: "rich-dialog",
    label: "Link to",
    input: { name: "href", type: "url", placeholder: "https://…" },
    submitLabel: "Link",
  })
  result.then(form => {
    const href = form?.elements?.href?.value?.trim()
    if (href) Command.dispatch(wg, toggleMark, Link.of(href))
    wg.focus()
  })
}

function highlightButtons(wg) {
  const apply = name => () => {
    const { from, to } = wg.state.selection
    if (from === to) return
    wg.dispatch({ changes: highlightChanges(wg.state.doc, name, from, to), userEvent: "format.highlight" })
    wg.focus()
  }
  const swatch = name =>
    el(
      "button",
      {
        class: `rich-highlight-swatch rich-highlight-${name}`,
        type: "button",
        title: name ? `Highlight ${name}` : "No highlight",
        "data-highlight": name ?? "none",
        onmousedown: event => {
          event.preventDefault()
          apply(name)()
        },
      },
      "A",
    )
  return [...HIGHLIGHTS.map(swatch), swatch(null)]
}

class FormatBar {
  constructor(wg) {
    this.wg = wg
    this.buttons = []
    // Which parts of the bar apply to the current selection. Cell selections
    // get the table verbs instead of the character formatting, so every part
    // carries the predicate that decides whether it is shown.
    this.parts = []
    this.bar = el("div", { class: "rich-format-bar" })
    const part = (element, when) => {
      this.parts.push({ element, when: when ?? (state => !cellSelection(state)) })
      this.bar.append(element)
    }
    for (const action of ACTIONS) {
      if (action.separator) {
        part(el("span", { class: "rich-format-separator" }), action.when)
        continue
      }
      const button = el(
        "button",
        {
          class: "rich-format-button",
          type: "button",
          title: action.title,
          onmousedown: event => {
            event.preventDefault()
            action.run(wg)
          },
        },
        action.label,
      )
      this.buttons.push({ action, button })
      part(button, action.when)
    }
    part(el("span", { class: "rich-format-separator" }))
    for (const swatch of highlightButtons(wg)) part(swatch)
  }

  connect(wg) {
    this.onScroll = () => this.sync(wg)
    wg.dom.append(this.bar)
    wg.scrollDOM.addEventListener("scroll", this.onScroll)
    this.sync(wg)
  }

  disconnect(wg) {
    wg.scrollDOM.removeEventListener("scroll", this.onScroll)
    this.bar.remove()
  }

  remove(wg) {
    this.disconnect(wg)
  }

  update() {
    this.wg.scheduleDOMRead(wg => this.sync(wg))
  }

  sync(wg) {
    const { state } = wg
    if (state.selection.empty || !wg.hasFocus) {
      this.bar.classList.remove("visible")
      return
    }
    for (const { element, when } of this.parts) {
      element.classList.toggle("hidden", !when(state))
    }
    for (const { action, button } of this.buttons) {
      button.classList.toggle("active", Boolean(action.active?.(state)))
    }
    const highlight = highlightAt(state)
    for (const swatch of this.bar.querySelectorAll(".rich-highlight-swatch")) {
      swatch.classList.toggle("active", swatch.dataset.highlight === (highlight ?? "none"))
    }
    const host = wg.dom.getBoundingClientRect()
    const start = wg.coordsAtPos(state.selection.from, 1)
    const end = wg.coordsAtPos(state.selection.to, -1)
    const centre = (Math.min(start.left, end.left) + Math.max(start.right, end.right)) / 2
    this.bar.classList.add("visible")
    wg.scheduleDOMWrite(() => {
      const width = this.bar.offsetWidth
      const height = this.bar.offsetHeight
      // Centred on the selection and above it, but kept inside whatever of the
      // editor is actually on screen: the tool can sit against a sidebar, or
      // run off the window, and a bar half out of view is no use.
      const left = clamp(
        centre - width / 2,
        Math.max(host.left, 0) + GAP,
        Math.min(host.right, window.innerWidth) - width - GAP,
      )
      const top = Math.min(start.top, end.top) - height - GAP
      const ceiling = Math.max(host.top, 0) + GAP
      const below = Math.max(start.bottom, end.bottom) + GAP
      const y = top >= ceiling ? top : Math.min(below, window.innerHeight - height - GAP)
      this.bar.style.left = `${left - host.left}px`
      this.bar.style.top = `${clamp(y, ceiling, window.innerHeight - height - GAP) - host.top}px`
    })
  }
}

export function formatBar() {
  return Wordgard.Plugin.fromClass(FormatBar).extension
}
