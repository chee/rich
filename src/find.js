// Find in note: lush's find bar (ContentView.swift). A capsule field under the
// top bar ("Find in note", n/N), a ‹ › step capsule and Done; the chevron
// opens a "Replace with" row with Replace and All. Matches are marked in the
// text, the current one in lush's yellow. Case is ignored, as lush ignores it.
//
// Keys: Mod-f finds, Mod-Alt-f finds and replaces, Mod-g and Mod-Shift-g step,
// Enter and Shift-Enter step from the field, Escape closes.
import { Decoration, KeyBinding, RangeSet, Wordgard } from "wordgard/editor"
import { Leaf } from "wordgard/doc"
import { GardState, Transaction } from "wordgard/state"
import { el, svg } from "./dom.js"

const setFind = Transaction.Effect.define()

const matchDeco = Decoration.Range.wrapper("span", { attributes: { class: "rich-find-match" }, scope: "all" })
const currentDeco = Decoration.Range.wrapper("span", { attributes: { class: "rich-find-match rich-find-current" }, scope: "all" })

// Every match of `query` in the note, as document ranges. Text is searched a
// textblock at a time, so a match can run across marks but not across lines.
export function findMatches(doc, query) {
  if (!query) return []
  const needle = query.toLocaleLowerCase()
  const matches = []
  let text = ""
  let map = []
  const flush = () => {
    if (!text) return
    const hay = text.toLocaleLowerCase()
    for (let at = hay.indexOf(needle); at >= 0; at = hay.indexOf(needle, at + needle.length)) {
      const from = map[at]
      const to = map[at + needle.length - 1] + 1
      matches.push([from, to])
    }
    text = ""
    map = []
  }
  doc.iterate((node, pos, parent) => {
    if (node.isPlot && node.isTextblock) {
      flush()
      return
    }
    if (node.is?.(Leaf.Text)) {
      const value = node.param
      for (let i = 0; i < value.length; i++) map.push(pos + i)
      text += value
    } else if (node.isLeaf) {
      // an inline leaf breaks a match
      text += "\u0000"
      map.push(pos)
    }
  })
  flush()
  return matches
}

const empty = { open: false, replace: false, query: "", matches: [], current: -1, decorations: RangeSet.empty }

function build(doc, query, current) {
  const matches = findMatches(doc, query)
  const index = matches.length ? Math.max(0, Math.min(current, matches.length - 1)) : -1
  const decorations = RangeSet.create(matches.map(([from, to], i) => [from, to, i === index ? currentDeco : matchDeco]))
  return { matches, current: index, decorations }
}

export const findField = GardState.Field.define({
  create: () => empty,
  update(value, tr) {
    let next = value
    for (const effect of tr.effects) {
      if (!effect.is(setFind)) continue
      next = { ...next, ...effect.value }
      if (!next.open) return empty
      const built = build(tr.state.doc, next.query, next.current ?? 0)
      next = { ...next, ...built }
    }
    if (next === value && value.open && value.query && tr.docChanged) {
      // keep the current match where it was
      const at = value.matches[value.current]
      const mapped = at ? tr.changes.mapPos(at[0], -1) : 0
      const built = build(tr.state.doc, value.query, 0)
      const current = Math.max(0, built.matches.findIndex(([from]) => from >= mapped))
      next = { ...value, ...build(tr.state.doc, value.query, current) }
    }
    return next
  },
  provide: field => Decoration.Range.source.of(state => state.field(field).decorations),
})

function select(wg, index) {
  const find = wg.state.field(findField)
  const match = find.matches[index]
  if (!match) return
  wg.dispatch({
    effects: setFind.of({ current: index }),
    selection: { anchor: match[0], head: match[1] },
    scrollIntoView: true,
  })
}

export function findStep(wg, direction) {
  const find = wg.state.field(findField)
  if (!find?.open || !find.matches.length) return false
  const count = find.matches.length
  select(wg, (find.current + direction + count) % count)
  return true
}

function replaceCurrent(wg, replacement) {
  const find = wg.state.field(findField)
  const match = find.matches[find.current]
  if (!match) return
  wg.dispatch({
    changes: { from: match[0], to: match[1], insert: replacement ? [Leaf.text(replacement)] : [] },
    userEvent: "input.replace",
  })
  const after = wg.state.field(findField)
  if (after.matches.length) select(wg, after.current)
}

function replaceAll(wg, replacement) {
  const find = wg.state.field(findField)
  if (!find.matches.length) return
  wg.dispatch({
    changes: find.matches.map(([from, to]) => ({ from, to, insert: replacement ? [Leaf.text(replacement)] : [] })),
    userEvent: "input.replace.all",
  })
}

const ICONS = {
  search: `<circle cx="7" cy="7" r="4.2"/><path d="M10.2 10.2L13.5 13.5"/>`,
  chevron: `<path d="M6 4l4 4-4 4"/>`,
  prev: `<path d="M10 3.5L5.5 8l4.5 4.5"/>`,
  next: `<path d="M6 3.5L10.5 8 6 12.5"/>`,
  clear: `<circle cx="8" cy="8" r="6"/><path d="M5.8 5.8l4.4 4.4M10.2 5.8l-4.4 4.4"/>`,
}

// The bar itself: one per editor, shown while the find is open.
class FindBar {
  constructor(wg, element) {
    this.wg = wg
    this.element = element
    const keep = event => event.preventDefault()
    this.input = el("input", {
      class: "rich-find-input",
      type: "text",
      placeholder: "Find in note",
      "aria-label": "Find in note",
      spellcheck: "false",
      autocomplete: "off",
    })
    this.count = el("span", { class: "rich-find-count", "aria-live": "polite" })
    this.clear = el("button", { class: "rich-find-clear", type: "button", title: "Clear", "aria-label": "Clear" }, svg(ICONS.clear, 13))
    this.toggle = el("button", { class: "rich-find-toggle", type: "button", title: "Replace", "aria-label": "Replace", "aria-expanded": "false" }, svg(ICONS.chevron, 12))
    this.replaceInput = el("input", {
      class: "rich-find-input rich-replace-input",
      type: "text",
      placeholder: "Replace with",
      "aria-label": "Replace with",
      spellcheck: "false",
      autocomplete: "off",
    })
    const step = direction =>
      el("button", { class: "rich-find-step", type: "button", title: direction < 0 ? "Previous" : "Next", "aria-label": direction < 0 ? "Previous" : "Next", onmousedown: keep, onclick: () => findStep(wg, direction) }, svg(direction < 0 ? ICONS.prev : ICONS.next, 13))
    this.replaceRow = el(
      "div",
      { class: "rich-find-row rich-replace-row", hidden: true },
      el("span", { class: "rich-find-toggle-space" }),
      el("div", { class: "rich-find-field" }, this.replaceInput),
      el("button", { class: "rich-button", type: "button", onclick: () => replaceCurrent(wg, this.replaceInput.value) }, "Replace"),
      el("button", { class: "rich-button", type: "button", onclick: () => replaceAll(wg, this.replaceInput.value) }, "All"),
    )
    this.dom = el(
      "div",
      { class: "rich-find", role: "search" },
      el(
        "div",
        { class: "rich-find-row" },
        this.toggle,
        el("div", { class: "rich-find-field" }, svg(ICONS.search, 13), this.input, this.count, this.clear),
        el("div", { class: "rich-find-steps" }, step(-1), step(1)),
        el("button", { class: "rich-button", type: "button", onclick: () => this.close() }, "Done"),
      ),
      this.replaceRow,
    )
    this.input.addEventListener("input", () => {
      wg.dispatch({ effects: setFind.of({ query: this.input.value, current: 0 }) })
      const find = wg.state.field(findField)
      if (find.matches.length) select(wg, find.current)
    })
    this.input.addEventListener("keydown", event => this.onKey(event))
    // Escape from anywhere in the bar, its buttons included
    this.dom.addEventListener("keydown", event => {
      if (event.key !== "Escape" || event.defaultPrevented) return
      event.preventDefault()
      this.close()
    })
    this.replaceInput.addEventListener("keydown", event => {
      if (event.key === "Enter") {
        event.preventDefault()
        replaceCurrent(wg, this.replaceInput.value)
      } else this.onKey(event)
    })
    this.clear.addEventListener("click", () => {
      this.input.value = ""
      wg.dispatch({ effects: setFind.of({ query: "", current: 0 }) })
      this.input.focus()
    })
    this.toggle.addEventListener("click", () => this.setReplace(this.replaceRow.hidden))
  }

  onKey(event) {
    if (event.key === "Escape") {
      event.preventDefault()
      this.close()
    } else if (event.key === "Enter") {
      event.preventDefault()
      findStep(this.wg, event.shiftKey ? -1 : 1)
    } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "g") {
      event.preventDefault()
      findStep(this.wg, event.shiftKey ? -1 : 1)
    }
  }

  setReplace(on) {
    this.replaceRow.hidden = !on
    this.toggle.setAttribute("aria-expanded", String(on))
    this.toggle.classList.toggle("open", on)
    this.makeRoom()
  }

  // The bar sits under the top bar, as lush's does, so the note moves down
  // to make room for it rather than having its first lines covered.
  makeRoom() {
    const open = this.dom.isConnected
    if (open) this.element.style.setProperty("--rich-find-room", `${this.dom.offsetHeight + 4}px`)
    else this.element.style.removeProperty("--rich-find-room")
  }

  sync(find) {
    if (find.open && !this.dom.isConnected) {
      this.element.append(this.dom)
      this.makeRoom()
    }
    if (!find.open && this.dom.isConnected) {
      this.dom.remove()
      this.makeRoom()
    }
    if (!find.open) return
    this.count.textContent = find.query ? `${find.matches.length ? find.current + 1 : 0}/${find.matches.length}` : ""
    this.clear.hidden = !find.query
  }

  open(replace) {
    const { from, to } = this.wg.state.selection
    let query = this.wg.state.field(findField).query
    if (to > from) {
      const text = this.wg.state.doc.textContent({ from, to })
      if (text && !text.includes("\n")) query = text
    }
    this.input.value = query
    this.wg.dispatch({ effects: setFind.of({ open: true, query, current: 0 }) })
    // now, not at the editor's next update, so the field can take the focus
    this.sync(this.wg.state.field(findField))
    this.setReplace(Boolean(replace))
    this.input.focus()
    this.input.select()
  }

  close() {
    this.wg.dispatch({ effects: setFind.of({ open: false }) })
    this.wg.focus()
  }
}

const bars = new WeakMap()

export function openFind(wg, replace = false) {
  const bar = bars.get(wg)
  if (!bar) return false
  bar.open(replace)
  return true
}

export function findInNote(context) {
  const plugin = Wordgard.Plugin.define(wg => {
    const bar = new FindBar(wg, context.element)
    bars.set(wg, bar)
    return {
      update(update) {
        bar.sync(update.state.field(findField))
      },
      remove() {
        bar.dom.remove()
        bar.makeRoom()
      },
    }
  })
  return [
    findField,
    plugin.extension,
    GardState.prec.high([
      KeyBinding.of({ key: "Mod-f", run: wg => openFind(wg, false) }),
      KeyBinding.of({ key: "Mod-Alt-f", run: wg => openFind(wg, true) }),
      KeyBinding.of({ key: "Mod-g", run: wg => findStep(wg, 1) }),
      KeyBinding.of({ key: "Mod-Shift-g", run: wg => findStep(wg, -1) }),
      KeyBinding.of({
        key: "Escape",
        run: wg => {
          if (!wg.state.field(findField).open) return false
          wg.dispatch({ effects: setFind.of({ open: false }) })
          return true
        },
      }),
    ]),
  ]
}
