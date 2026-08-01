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
]

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

class FormatBar {
  constructor(wg) {
    this.wg = wg
    this.buttons = []
    this.bar = el("div", { class: "rich-format-bar" })
    for (const action of ACTIONS) {
      if (action.separator) {
        this.bar.append(el("span", { class: "rich-format-separator" }))
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
      this.bar.append(button)
    }
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
    for (const { action, button } of this.buttons) {
      button.classList.toggle("active", Boolean(action.active(state)))
    }
    const host = wg.dom.getBoundingClientRect()
    const start = wg.coordsAtPos(state.selection.from, 1)
    const end = wg.coordsAtPos(state.selection.to, -1)
    const centre = (Math.min(start.left, end.left) + Math.max(start.right, end.right)) / 2
    this.bar.classList.add("visible")
    wg.scheduleDOMWrite(() => {
      this.bar.style.top = `${Math.min(start.top, end.top) - host.top - this.bar.offsetHeight - 8}px`
      this.bar.style.left = `${centre - host.left - this.bar.offsetWidth / 2}px`
    })
  }
}

export function formatBar() {
  return Wordgard.Plugin.fromClass(FormatBar).extension
}
