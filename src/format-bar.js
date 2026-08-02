// A floating bar over the selection, in place of a permanent toolbar.
import { Wordgard } from "wordgard/editor"
import { Command, toggleMark, toggleEmphasis, toggleStrong } from "wordgard/command"
import { Code, Emphasis, Link, Strong } from "wordgard/types"
import { HIGHLIGHTS, highlightAt, highlightChanges } from "./highlight.js"
import { CellSelection } from "wordgard/table"
import { inTable, tableMenu } from "./tables.js"
import { el, svg } from "./dom.js"
import { icon } from "./icons.js"

function marksAt(state) {
  const { from, to } = state.selection
  return state.doc.resolve(from).marks(from === to ? undefined : state.doc.resolve(to))
}

// The marks at a position come from the text before it, so a selection sitting
// exactly on a link has none at either end. Read what is actually inside it.
function linkAt(state) {
  const { from, to } = state.selection
  if (from === to) return Link.isInSet(marksAt(state)) ?? null
  let found = null
  state.doc.iterate(from, to, node => {
    found ??= Link.isInSet(node.marks) ?? null
  })
  return found
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
]

function cellSelection(state) {
  return state.selection instanceof CellSelection
}

// How far the bar keeps off the selection and off the edges it is clamped to.
const GAP = 8

// A lower bound that wins, so a bar wider than the space it has left still
// starts on screen rather than being pushed off the other side.
const clamp = (value, low, high) => Math.max(low, Math.min(value, high))

// The link editor hangs off the link button rather than opening a dialog: a
// panel at the edge of the editor is a long way from the words being linked.
function linkControl(wg) {
  const button = el(
    "button",
    {
      class: "lush-format-button",
      type: "button",
      title: "Link",
      onmousedown: event => {
        event.preventDefault()
        control.querySelector(".lush-link-editor") ? close() : open()
      },
    },
    "↗",
  )

  const control = el("span", { class: "lush-link-control" }, button)

  let close = () => {}

  function open() {
    const existing = linkAt(wg.state)
    // Focusing the input collapses the editor's selection, so the range the
    // link is for has to be remembered and put back before applying it.
    const { from, to } = wg.state.selection
    const input = el("input", {
      class: "lush-link-input",
      type: "url",
      placeholder: "https://…",
      value: existing?.value ?? "",
    })
    const restore = () => wg.dispatch({ selection: { anchor: from, head: to } })
    const commit = () => {
      const href = input.value.trim()
      restore()
      // Setting a link over one that is already there has to remove the old
      // mark first: a parameterised mark is removed by value, not by type.
      if (existing) Command.dispatch(wg, toggleMark, existing)
      if (href) Command.dispatch(wg, toggleMark, Link.of(href))
      close()
      wg.focus()
    }
    const form = el(
      "form",
      {
        class: "lush-link-editor",
        onsubmit: event => {
          event.preventDefault()
          commit()
        },
      },
      input,
      el("button", { class: "lush-link-submit", type: "submit" }, existing ? "Update" : "Link"),
      existing
        ? el(
            "button",
            {
              class: "lush-link-remove",
              type: "button",
              title: "Remove link",
              onmousedown: event => {
                event.preventDefault()
                restore()
                Command.dispatch(wg, toggleMark, existing)
                close()
                wg.focus()
              },
            },
            "✕",
          )
        : null,
    )
    const onOutside = event => {
      if (!control.contains(event.target)) close()
    }
    const onKey = event => {
      if (event.key !== "Escape") return
      event.preventDefault()
      close()
      wg.focus()
    }
    close = () => {
      form.remove()
      document.removeEventListener("mousedown", onOutside, true)
      document.removeEventListener("keydown", onKey, true)
      close = () => {}
    }
    control.append(form)
    document.addEventListener("mousedown", onOutside, true)
    document.addEventListener("keydown", onKey, true)
    input.focus()
    input.select()
  }

  return {
    control,
    hide: () => close(),
    sync: state => button.classList.toggle("active", Boolean(linkAt(state))),
  }
}

// One marker button that highlights in the current colour (and un-highlights
// when the selection already wears it), and a dot beside it that opens the
// colour list. Five swatches in the bar was five decisions for one action.
function highlightControl(wg) {
  let colour = HIGHLIGHTS[0]

  const apply = name => {
    const { from, to } = wg.state.selection
    if (from === to) return
    wg.dispatch({
      changes: highlightChanges(wg.state.doc, name, from, to),
      userEvent: "format.highlight",
    })
    wg.focus()
  }

  const marker = el(
    "button",
    {
      class: "lush-format-button lush-highlight-marker",
      type: "button",
      title: "Highlight",
      onmousedown: event => {
        event.preventDefault()
        apply(highlightAt(wg.state) === colour ? null : colour)
      },
    },
    svg(`<path d="M3 13h3l6.5-6.5a1.8 1.8 0 00-2.5-2.5L3.5 10.5z"/><path d="M2.5 13.5h5"/>`),
  )

  const dot = el("button", {
    class: `lush-highlight-dot lush-highlight-${colour}`,
    type: "button",
    title: "Highlight colour",
    "data-highlight": colour,
    onmousedown: event => {
      event.preventDefault()
      openChooser()
    },
  })

  const setColour = name => {
    colour = name
    dot.className = `lush-highlight-dot lush-highlight-${name}`
    dot.dataset.highlight = name
  }

  const control = el("span", { class: "lush-highlight-control" }, marker, dot)

  function openChooser() {
    control.querySelector(".lush-highlight-chooser")?.remove()
    const close = () => {
      chooser.remove()
      document.removeEventListener("mousedown", onOutside, true)
      document.removeEventListener("keydown", onKey, true)
    }
    const onOutside = event => {
      if (!chooser.contains(event.target) && event.target !== dot) close()
    }
    const onKey = event => {
      if (event.key !== "Escape") return
      event.preventDefault()
      close()
      wg.focus()
    }
    const swatch = name =>
      el("button", {
        class: `lush-highlight-swatch lush-highlight-${name ?? "none"}`,
        type: "button",
        title: name ? `Highlight ${name}` : "No highlight",
        "data-highlight": name ?? "none",
        onmousedown: event => {
          event.preventDefault()
          if (name) setColour(name)
          apply(name)
          close()
        },
      })
    const chooser = el(
      "div",
      { class: "lush-highlight-chooser" },
      ...HIGHLIGHTS.map(swatch),
      swatch(null),
    )
    control.append(chooser)
    document.addEventListener("mousedown", onOutside, true)
    document.addEventListener("keydown", onKey, true)
  }

  return { control, marker, sync: state => marker.classList.toggle("active", Boolean(highlightAt(state))) }
}

// The row at the top of the bar: what this block is, dropping down everything
// it could be instead. The list is `context.blockTypes()`, the same one the
// slash menu and the block handle read, so a contributed type appears here too.
function blockTypeControl(wg, context) {
  const glyph = el("span", { class: "lush-slash-icon" })
  const label = el("span", { class: "lush-format-block-name" }, "Body")
  const button = el(
    "button",
    {
      class: "lush-format-block",
      type: "button",
      onmousedown: event => {
        event.preventDefault()
        control.querySelector(".lush-format-block-menu") ? close() : open()
      },
    },
    glyph,
    label,
    el("span", { class: "lush-format-chevron" }, "›"),
  )

  const control = el("div", { class: "lush-format-block-control" }, button)

  let close = () => {}

  function open() {
    const menu = el(
      "div",
      { class: "lush-format-block-menu" },
      context.blockTypes().map(block =>
        el(
          "button",
          {
            class: "lush-format-block-item",
            type: "button",
            onmousedown: event => {
              event.preventDefault()
              block.apply(wg, context)
              close()
              wg.focus()
            },
          },
          el("span", { class: "lush-slash-icon" }, icon(block)),
          el("span", { class: "lush-slash-name" }, block.name),
          block.active?.(wg.state) ? el("span", { class: "lush-format-tick" }, "✓") : null,
        ),
      ),
    )
    const onOutside = event => {
      if (!control.contains(event.target)) close()
    }
    const onKey = event => {
      if (event.key !== "Escape") return
      event.preventDefault()
      close()
      wg.focus()
    }
    close = () => {
      menu.remove()
      document.removeEventListener("mousedown", onOutside, true)
      document.removeEventListener("keydown", onKey, true)
      close = () => {}
    }
    control.append(menu)
    document.addEventListener("mousedown", onOutside, true)
    document.addEventListener("keydown", onKey, true)
  }

  return {
    control,
    hide: () => close(),
    sync: state => {
      const blocks = context.blockTypes()
      // Innermost wins: a list item is also a paragraph, and the list is the
      // more useful answer.
      const active = blocks.filter(block => block.active?.(state)).pop() ?? blocks[0]
      label.textContent = active?.name ?? "Body"
      glyph.replaceChildren(active ? icon(active) : "")
    },
  }
}

class FormatBar {
  constructor(wg, context) {
    this.wg = wg
    this.buttons = []
    // Which parts of the bar apply to the current selection. Cell selections
    // get the table verbs instead of the character formatting, so every part
    // carries the predicate that decides whether it is shown.
    this.parts = []
    // Two rows: what this block is, then how the selected characters look.
    // Cells hold inline content, so the block row has nothing to offer there.
    this.blockType = blockTypeControl(wg, context)
    const row = el("div", { class: "lush-format-row" })
    this.bar = el("div", { class: "lush-format-bar" }, this.blockType.control, row)
    this.parts.push({ element: this.blockType.control, when: state => !inTable(state) })
    const part = (element, when) => {
      this.parts.push({ element, when: when ?? (state => !cellSelection(state)) })
      row.append(element)
    }
    for (const action of ACTIONS) {
      if (action.separator) {
        part(el("span", { class: "lush-format-separator" }), action.when)
        continue
      }
      const button = el(
        "button",
        {
          class: "lush-format-button",
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
    this.link = linkControl(wg)
    part(this.link.control)
    part(el("span", { class: "lush-format-separator" }))
    this.highlight = highlightControl(wg)
    part(this.highlight.control)
    this.table = tableMenu(wg)
    part(el("span", { class: "lush-format-separator" }), inTable)
    part(this.table.control, inTable)
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
    // Typing in the link field takes focus out of the editor, which would
    // otherwise be read as "nothing is selected any more" and close the bar
    // out from under the thing being typed into.
    const typing = this.bar.contains(document.activeElement)
    if (!typing && (state.selection.empty || !wg.hasFocus)) {
      this.bar.classList.remove("visible")
      this.table.hide()
      this.blockType.hide()
      this.link.hide()
      return
    }
    if (!inTable(state)) this.table.hide()
    else this.blockType.hide()
    for (const { element, when } of this.parts) {
      element.classList.toggle("hidden", !when(state))
    }
    for (const { action, button } of this.buttons) {
      button.classList.toggle("active", Boolean(action.active?.(state)))
    }
    this.highlight.sync(state)
    this.blockType.sync(state)
    this.link.sync(state)
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

export function formatBar(context) {
  return Wordgard.Plugin.define(wg => new FormatBar(wg, context)).extension
}
