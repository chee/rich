// Lush's top bar: a translucent strip floating over the note, the text fading
// away beneath it as you scroll. In the middle a pill with "Aa" (the format
// popover) and a paperclip (things to put in the note); on the right a pill
// with "•••" (the note) and an info button.
//
// The popover is lush's FormatPopover, row for row: the marks, the fonts, the
// highlights, the block styles each drawn in its own style, and the indent
// pill — every one of them writing exactly what lush writes.
import * as am from "@automerge/automerge"
import { Dialog, Wordgard } from "wordgard/editor"
import { Leaf } from "wordgard/doc"
import { Command, selectedTextblocks, toggleMark } from "wordgard/command"
import {
  Code,
  CodeBlock,
  CodeBlockLanguage,
  Emphasis,
  Link,
  Paragraph,
  Strikethrough,
  Strong,
  Subscript,
  Superscript,
  Table,
  TableRow,
  BlockCell,
  BlockHeaderCell,
  Underline,
} from "wordgard/types"
import { CellSelection } from "wordgard/table"
import { el, svg } from "./dom.js"
import { Column, Columns, Embed, EmbedTool, FONTS, Font, Indent } from "./adapter.js"
import { HIGHLIGHTS, Highlight, highlightAt, highlightChanges } from "./highlight.js"
import { baselineAt, toggleBaseline } from "./baseline.js"
import { blockTypes, currentStyle, toBody } from "./block-types.js"
import { liftListItem, sinkListItem, listItemAt } from "./lists.js"
import { Logline, loglineNow, stamp, timeZone } from "./logline.js"
import { insertHtmlBlock } from "./html-block.js"
import { insertBlocks } from "./insert.js"
import { createFileDoc, pickFiles } from "./files.js"
import { TABLE_ACTIONS, inTable } from "./tables.js"
import { listPlugins, loadPlugin } from "./registry.js"
import { getSupportedToolsForType } from "@inkandswitch/patchwork-plugins"
import { openFind } from "./find.js"
import { deleteCheckedItems, hasChecked, moveCheckedToBottom } from "./todo-list.js"

export const ICONS = {
  paperclip: `<path d="M13.5 7.5l-5.6 5.6a3.2 3.2 0 01-4.5-4.5l6-6a2.1 2.1 0 013 3l-5.9 5.9a1 1 0 01-1.5-1.5L10.3 4.7"/>`,
  more: `<circle cx="3.5" cy="8" r="1.1" fill="currentColor" stroke="none"/><circle cx="8" cy="8" r="1.1" fill="currentColor" stroke="none"/><circle cx="12.5" cy="8" r="1.1" fill="currentColor" stroke="none"/>`,
  info: `<circle cx="8" cy="8" r="6.2"/><path d="M8 7.2v4"/><circle cx="8" cy="4.9" r=".8" fill="currentColor" stroke="none"/>`,
  link: `<path d="M6.5 9.5l3-3M7 4.5l1-1a2.5 2.5 0 013.5 3.5l-1 1M9 11.5l-1 1a2.5 2.5 0 01-3.5-3.5l1-1"/>`,
  highlighter: `<path d="M3 13h3l6.5-6.5a1.8 1.8 0 00-2.5-2.5L3.5 10.5z"/><path d="M2.5 13.5h5"/>`,
  none: `<circle cx="8" cy="8" r="5.5"/><path d="M4.2 11.8l7.6-7.6"/>`,
  outdent: `<path d="M2 3h12M7 6.5h7M7 9.5h7M2 13h12M5 6L2.5 8 5 10"/>`,
  indent: `<path d="M2 3h12M7 6.5h7M7 9.5h7M2 13h12M2.5 6L5 8l-2.5 2"/>`,
  check: `<path d="M3 8.5l3 3 7-7"/>`,
  photo: `<rect x="2" y="3" width="12" height="10" rx="1.5"/><circle cx="6" cy="6.5" r="1"/><path d="M3 11.5l3-3 2.5 2.5 2-1.5L13 12"/>`,
  mic: `<rect x="6" y="2" width="4" height="8" rx="2"/><path d="M3.5 8a4.5 4.5 0 009 0M8 12.5V14"/>`,
  micFill: `<rect x="6" y="1.8" width="4" height="8.4" rx="2" fill="currentColor"/><path d="M3.5 8a4.5 4.5 0 009 0M8 12.5V14.2M5.8 14.2h4.4"/>`,
  shippingbox: `<path d="M8 1.8l5.6 2.8v6.8L8 14.2l-5.6-2.8V4.6z"/><path d="M2.4 4.6L8 7.4l5.6-2.8M8 7.4v6.8M5.2 3.2l5.6 2.8"/>`,
  find: `<circle cx="7" cy="7" r="4.2"/><path d="M10.2 10.2L13.5 13.5"/>`,
  replace: `<circle cx="6.5" cy="6.5" r="3.6"/><path d="M9.2 9.2l2 2"/><path d="M10.5 13.5h4M12.5 11.5v4" transform="translate(-1 -1.5)"/>`,
  export: `<path d="M9 2H4.5A1.5 1.5 0 003 3.5v9A1.5 1.5 0 004.5 14h7a1.5 1.5 0 001.5-1.5V6z"/><path d="M8 11.5V7M6 9l2-2 2 2"/>`,
  checkBottom: `<rect x="2.5" y="9.5" width="4" height="4" rx="1.2"/><path d="M3.5 11.5l.8.8 1.5-1.6M9 11.5h4.5M9 4h4.5M2.5 4h4"/>`,
  eyeSlash: `<path d="M2 8s2.2-4 6-4 6 4 6 4-2.2 4-6 4-6-4-6-4z"/><circle cx="8" cy="8" r="1.8"/><path d="M3 13L13 3"/>`,
  eye: `<path d="M2 8s2.2-4 6-4 6 4 6 4-2.2 4-6 4-6-4-6-4z"/><circle cx="8" cy="8" r="1.8"/>`,
  trash: `<path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5a1 1 0 001 1h3.8a1 1 0 001-1l.6-8.5"/>`,
  close: `<circle cx="8" cy="8" r="6"/><path d="M5.8 5.8l4.4 4.4M10.2 5.8l-4.4 4.4"/>`,
  waveform: `<path d="M2 8h1M4.5 5.5v5M7 3v10M9.5 5v6M12 6.5v3M14 8h0"/>`,
  file: `<path d="M9 2H4.5A1.5 1.5 0 003 3.5v9A1.5 1.5 0 004.5 14h7a1.5 1.5 0 001.5-1.5V6z"/><path d="M9 2v4h4"/>`,
  clock: `<circle cx="8" cy="8" r="6"/><path d="M8 4.5V8l2.5 1.5"/>`,
  clockEdit: `<circle cx="7" cy="8" r="5"/><path d="M7 5.5V8l1.8 1"/><path d="M12 10.5l2-2M11 13.5h3"/>`,
  table: `<rect x="2" y="3" width="12" height="10" rx="1"/><path d="M2 6.5h12M2 10h12M6.5 6.5V13M10 6.5V13"/>`,
  columns: `<rect x="2" y="3" width="5" height="10" rx="1"/><rect x="9" y="3" width="5" height="10" rx="1"/>`,
  html: `<path d="M6 4L2 8l4 4M10 4l4 4-4 4"/>`,
  doc: `<rect x="3" y="2" width="10" height="12" rx="1.5"/><path d="M5.5 5.5h5M5.5 8h5M5.5 10.5h3"/>`,
  duplicate: `<rect x="5" y="5" width="9" height="9" rx="1.5"/><path d="M11 5V3.5A1.5 1.5 0 009.5 2h-6A1.5 1.5 0 002 3.5v6A1.5 1.5 0 003.5 11H5"/>`,
  copyLink: `<path d="M6.5 9.5l3-3M7 4.5l1-1a2.5 2.5 0 013.5 3.5l-1 1M9 11.5l-1 1a2.5 2.5 0 01-3.5-3.5l1-1"/>`,
  plugins: `<path d="M6 2v3M10 2v3M4 5h8v4a4 4 0 01-8 0z"/><path d="M8 13v2"/>`,
}

const LANGUAGES = [
  ["plain", "Plain Text"],
  ["swift", "Swift"],
  ["javascript", "JavaScript"],
  ["typescript", "TypeScript"],
  ["python", "Python"],
  ["html", "HTML"],
  ["css", "CSS"],
  ["json", "JSON"],
  ["markdown", "Markdown"],
  ["bash", "Shell"],
  ["sql", "SQL"],
  ["rust", "Rust"],
]

// ---------------------------------------------------------------------------
// What the selection wears
// ---------------------------------------------------------------------------

const marksAt = state => {
  const { from, to } = state.selection
  return state.sel.activeMarks ?? state.doc.resolve(from).marks(from === to ? undefined : state.doc.resolve(to))
}

// A selection sitting exactly on a run has none of its marks at either end,
// so read what is inside it.
function markIn(state, type) {
  const { from, to } = state.selection
  if (from === to) return type.isInSet(marksAt(state)) ?? null
  let found = null
  state.doc.iterate(from, to, node => {
    found ??= type.isInSet(node.marks) ?? null
  })
  return found
}

const active = (state, mark) => Boolean(markIn(state, mark.type ?? mark))

// Set a valued mark (a font) over the selection, or clear it. With no
// selection, the next typing wears it.
function setValued(wg, type, value) {
  const state = wg.state
  const { from, to } = state.selection
  if (from === to) {
    const current = type.isInSet(marksAt(state))
    if (current) Command.dispatch(wg, toggleMark, current)
    if (value) Command.dispatch(wg, toggleMark, type.of(value))
    return
  }
  const changes = []
  const seen = new Set()
  state.doc.iterate(from, to, node => {
    const mark = type.isInSet(node.marks)
    if (!mark || seen.has(mark.value)) return
    seen.add(mark.value)
    changes.push({ from, to, remove: mark })
  })
  if (value) changes.push({ from, to, add: type.of(value) })
  if (changes.length) wg.dispatch({ changes, userEvent: "format" })
}

function setHighlight(wg, name) {
  const { from, to } = wg.state.selection
  if (from === to) return setValued(wg, Highlight, name)
  wg.dispatch({ changes: highlightChanges(wg.state.doc, name, from, to), userEvent: "format.highlight" })
}

// ---------------------------------------------------------------------------
// Indenting: lists nest, everything else takes lush's `indent` attr.
// ---------------------------------------------------------------------------

export function indentBlock(wg, direction) {
  const state = wg.state
  if (listItemAt(state)) {
    const spec = direction > 0 ? sinkListItem(state) : liftListItem(state)
    if (spec) {
      wg.dispatch(spec)
      return true
    }
    // A top-level item outdents out of its list, as in lush.
    if (direction < 0) {
      toBody(wg)
      return true
    }
    return false
  }
  const changes = []
  for (const block of selectedTextblocks(state)) {
    const type = block.node.type
    if (![Paragraph.type, CodeBlock.type].includes(type) && type.name !== "Heading") continue
    const current = Indent.isInSet(block.node.tag.marks)
    const level = Math.max(0, (current?.value ?? 0) + direction)
    if (level === (current?.value ?? 0)) continue
    if (current) changes.push({ from: block.before, remove: current })
    if (level > 0) changes.push({ from: block.before, add: Indent.of(level) })
  }
  if (!changes.length) return false
  wg.dispatch({ changes, userEvent: "format.indent" })
  return true
}

// ---------------------------------------------------------------------------
// Popovers
// ---------------------------------------------------------------------------

class Popover {
  constructor(bar, anchor, className) {
    this.bar = bar
    this.anchor = anchor
    this.arrow = el("div", { class: "rich-popover-arrow" })
    this.body = el("div", { class: "rich-popover-body" })
    this.element = el("div", { class: `rich-popover ${className}` }, this.arrow, this.body)
    this.onOutside = event => {
      if (!this.element.contains(event.target) && !this.anchor.contains(event.target)) this.close()
    }
    this.onKey = event => {
      if (event.key !== "Escape") return
      event.preventDefault()
      this.close()
      this.bar.wg.focus()
    }
  }

  open() {
    this.bar.layer.append(this.element)
    this.anchor.classList.add("open")
    document.addEventListener("mousedown", this.onOutside, true)
    document.addEventListener("keydown", this.onKey, true)
    this.place()
  }

  place() {
    // At phone width, a popover with a title is lush's bottom island
    // instead: a card along the bottom, with its title and a close button.
    const island = Boolean(this.title) && this.bar.narrow()
    this.element.classList.toggle("rich-island", island)
    if (island) {
      if (!this.header) {
        this.header = el(
          "div",
          { class: "rich-island-header" },
          el("h3", {}, this.title),
          makeButton("rich-island-close", "Close", svg(ICONS.close, 18), () => {
            this.close()
            this.bar.wg.focus()
          }),
        )
      }
      if (this.header.parentNode !== this.element) this.element.insertBefore(this.header, this.body)
      // along the bottom of the whole note, not of the bar
      if (this.element.parentNode !== this.bar.context.element) this.bar.context.element.append(this.element)
      this.element.style.left = ""
      this.element.style.top = ""
      return
    }
    this.header?.remove()
    if (this.element.parentNode !== this.bar.layer) this.bar.layer.append(this.element)
    const host = this.bar.layer.getBoundingClientRect()
    const button = this.anchor.getBoundingClientRect()
    const width = this.element.offsetWidth
    const centre = button.left + button.width / 2 - host.left
    const left = Math.max(8, Math.min(centre - width / 2, host.width - width - 8))
    this.element.style.left = `${left}px`
    this.element.style.top = `${button.bottom - host.top + 10}px`
    this.arrow.style.left = `${centre - left}px`
  }

  close() {
    this.element.remove()
    this.anchor.classList.remove("open")
    document.removeEventListener("mousedown", this.onOutside, true)
    document.removeEventListener("keydown", this.onKey, true)
    if (this.bar.popover === this) this.bar.popover = null
    this.onClose?.()
  }
}

const makeButton = (className, title, content, onpress) =>
  el(
    "button",
    {
      class: className,
      type: "button",
      title,
      "aria-label": title,
      onmousedown: event => {
        // keep the editor's selection
        event.preventDefault()
      },
      onclick: event => {
        event.preventDefault()
        onpress(event)
      },
    },
    content,
  )

const menuItem = (label, glyph, run, { disabled = false, danger = false, shortcut = null } = {}) =>
  el(
    "button",
    {
      class: `rich-menu-item${danger ? " danger" : ""}`,
      type: "button",
      disabled,
      onmousedown: event => event.preventDefault(),
      onclick: event => {
        event.preventDefault()
        run()
      },
    },
    el("span", { class: "rich-menu-glyph" }, glyph ? svg(ICONS[glyph] ?? glyph, 14) : null),
    el("span", { class: "rich-menu-label" }, label),
    shortcut ? el("span", { class: "rich-menu-shortcut", "aria-hidden": "true" }, shortcut) : null,
  )

const divider = () => el("div", { class: "rich-popover-divider", role: "separator" })

// ---------------------------------------------------------------------------
// The Aa popover
// ---------------------------------------------------------------------------

const STYLE_GROUPS = [
  ["h1", "h2", "h3", "text", "code"],
  ["bullet", "ordered", "todo"],
  ["quote"],
]

const STYLE_MARKERS = { bullet: "•", ordered: "1.", todo: "☐", quote: "|" }

function formatPopover(bar) {
  const { wg } = bar
  const popover = new Popover(bar, bar.aa, "rich-format-popover")
  popover.title = "Format"

  const markButton = (title, content, isActive, run) => {
    const node = makeButton("rich-mark-button", title, content, () => {
      run()
      render()
    })
    node.classList.toggle("active", isActive)
    node.setAttribute("aria-pressed", String(isActive))
    return node
  }

  function render() {
    const state = wg.state
    const rows = []

    rows.push(
      el(
        "div",
        { class: "rich-pill rich-marks-row" },
        markButton("Bold", el("b", {}, "B"), active(state, Strong), () => Command.dispatch(wg, toggleMark, Strong)),
        markButton("Italic", el("i", {}, "I"), active(state, Emphasis), () => Command.dispatch(wg, toggleMark, Emphasis)),
        markButton("Underline", el("u", {}, "U"), active(state, Underline), () =>
          Command.dispatch(wg, toggleMark, Underline),
        ),
        markButton("Strikethrough", el("s", {}, "S"), active(state, Strikethrough), () =>
          Command.dispatch(wg, toggleMark, Strikethrough),
        ),
        markButton("Link", svg(ICONS.link, 14), Boolean(markIn(state, Link)), () => {
          popover.close()
          linkDialog(bar)
        }),
        el("span", { class: "rich-pill-divider" }),
        markButton("Superscript", el("span", { class: "rich-baseline-glyph" }, "A", el("sup", {}, "1")), baselineAt(state, Superscript), () =>
          toggleBaseline(wg, Superscript),
        ),
        markButton("Subscript", el("span", { class: "rich-baseline-glyph" }, "A", el("sub", {}, "1")), baselineAt(state, Subscript), () =>
          toggleBaseline(wg, Subscript),
        ),
      ),
    )

    const font = markIn(state, Font)?.value ?? null
    const fontButton = (label, family, isActive, run, title = label) => {
      const node = makeButton(`rich-font-button rich-font-sample-${family}`, title, label, () => {
        run()
        render()
      })
      node.classList.toggle("active", isActive)
      node.setAttribute("aria-pressed", String(isActive))
      return node
    }
    rows.push(
      el(
        "div",
        { class: "rich-font-row" },
        ...FONTS.map(name =>
          fontButton(name === "serif" ? "Serif" : "Hand", name, font === name, () =>
            setValued(wg, Font, font === name ? null : name),
          ),
        ),
        // "Inline Code", so it and the Code block style read apart
        fontButton("Code", "mono", active(state, Code), () => Command.dispatch(wg, toggleMark, Code), "Inline Code"),
      ),
    )

    const highlight = highlightAt(state)
    rows.push(
      el(
        "div",
        { class: "rich-highlight-row" },
        el("span", { class: `rich-highlighter${highlight ? " active" : ""}` }, svg(ICONS.highlighter, 14)),
        ...HIGHLIGHTS.map(name => {
          const node = makeButton(`rich-swatch rich-highlight-${name}`, `${name[0].toUpperCase()}${name.slice(1)} Highlight`, null, () => {
            setHighlight(wg, highlight === name ? null : name)
            render()
          })
          node.dataset.highlight = name
          node.classList.toggle("active", highlight === name)
          return node
        }),
        makeButton("rich-swatch-none", "No Highlight", svg(ICONS.none, 15), () => {
          setHighlight(wg, null)
          render()
        }),
      ),
    )

    rows.push(divider())

    const byId = Object.fromEntries(blockTypes.map(block => [block.id, block]))
    const current = currentStyle(state)
    STYLE_GROUPS.forEach((group, index) => {
      if (index > 0) rows.push(divider())
      for (const id of group) {
        const block = byId[id]
        const node = makeButton(`rich-style-row rich-style-${id}`, block.name, [
          el("span", { class: "rich-style-check" }, id === current ? svg(ICONS.check, 11) : null),
          STYLE_MARKERS[id] ? el("span", { class: "rich-style-marker" }, STYLE_MARKERS[id]) : null,
          el("span", { class: "rich-style-label" }, block.name),
        ], () => {
          block.apply(wg)
          render()
        })
        node.classList.toggle("active", id === current)
        node.setAttribute("aria-checked", String(id === current))
        node.setAttribute("role", "menuitemradio")
        rows.push(node)
      }
    })

    rows.push(divider())
    rows.push(
      el(
        "div",
        { class: "rich-indent-row" },
        el(
          "div",
          { class: "rich-pill" },
          makeButton("rich-mark-button", "Decrease Indent", svg(ICONS.outdent, 14), () => {
            indentBlock(wg, -1)
            render()
          }),
          makeButton("rich-mark-button", "Increase Indent", svg(ICONS.indent, 14), () => {
            indentBlock(wg, 1)
            render()
          }),
        ),
      ),
    )

    const code = state.sel.head.textblockParent
    if (code && code.node.type === CodeBlock.type) {
      const language = CodeBlockLanguage.isInSet(code.node.tag.marks)?.value ?? "plain"
      const select = el(
        "select",
        {
          class: "rich-language-select",
          onchange: () => {
            const block = wg.state.sel.head.textblockParent
            if (!block) return
            const old = CodeBlockLanguage.isInSet(block.node.tag.marks)
            const changes = []
            if (old) changes.push({ from: block.before, remove: old })
            if (select.value !== "plain") changes.push({ from: block.before, add: CodeBlockLanguage.of(select.value) })
            if (changes.length) wg.dispatch({ changes, userEvent: "format.language" })
            wg.focus()
          },
        },
        ...LANGUAGES.map(([id, name]) => el("option", { value: id, selected: id === language }, name)),
        LANGUAGES.some(([id]) => id === language) ? null : el("option", { value: language, selected: true }, language),
      )
      rows.push(divider(), el("label", { class: "rich-language-row" }, el("span", {}, "Language"), select))
    }

    popover.body.replaceChildren(...rows)
    popover.element.classList.toggle("rich-in-code", Boolean(code && code.node.type === CodeBlock.type))
  }

  popover.render = render
  render()
  return popover
}

// ---------------------------------------------------------------------------
// The link editor: lush's Link sheet (MediaViews.swift), 380pt wide, a URL
// field that takes Enter, and Remove · Cancel · Apply.
// ---------------------------------------------------------------------------

// What lush makes of what was typed: a URL with a scheme or a mailto: is kept,
// an address becomes mailto:, anything else gets https:// in front.
export function normalizeLink(text) {
  const value = text.trim()
  if (!value) return ""
  if (value.includes("://") || /^mailto:/i.test(value)) return value
  if (value.includes("@") && !value.includes("/")) return `mailto:${value}`
  return `https://${value}`
}

// The link over the selection, and the range it covers: with the caret in a
// link and nothing selected, the whole link.
function linkRange(state) {
  let { from, to } = state.selection
  const existing = markIn(state, Link)
  if (existing && from === to) {
    const block = state.sel.head.textblockParent
    if (block) {
      let start = null
      let end = null
      state.doc.iterate(block.before, block.after, (node, pos) => {
        if (!node.is(Leaf.Text)) return
        const inLink = Link.isInSet(node.marks)?.value === existing.value
        if (inLink && pos <= from && pos + node.length >= from && start == null) {
          start = pos
          end = pos + node.length
        } else if (inLink && start != null && pos === end) end = pos + node.length
      })
      if (start != null) [from, to] = [start, end]
    }
  }
  return { from, to, existing }
}

export function linkDialog(bar) {
  const { wg, context } = bar
  context.element.querySelector(".rich-link-dialog")?.remove()
  const { from, to, existing } = linkRange(wg.state)
  const input = el("input", {
    class: "rich-link-input",
    type: "text",
    inputmode: "url",
    autocomplete: "off",
    spellcheck: "false",
    placeholder: "https://",
    "aria-label": "URL",
    value: existing?.value ?? "",
  })
  const finish = href => {
    close()
    wg.dispatch({ selection: { anchor: from, head: to } })
    if (href != null && from !== to) {
      const changes = []
      const seen = new Set()
      wg.state.doc.iterate(from, to, node => {
        const mark = Link.isInSet(node.marks)
        if (!mark || seen.has(mark.value)) return
        seen.add(mark.value)
        changes.push({ from, to, remove: mark })
      })
      if (href) changes.push({ from, to, add: Link.of(href) })
      if (changes.length) wg.dispatch({ changes, userEvent: "format.link" })
    } else if (href != null) {
      // nothing selected: the next typing wears the link
      if (existing) Command.dispatch(wg, toggleMark, existing)
      if (href) Command.dispatch(wg, toggleMark, Link.of(href))
    }
    wg.focus()
  }
  const apply = el("button", { class: "rich-button prominent", type: "submit", disabled: !input.value.trim() }, "Apply")
  const card = el(
    "form",
    {
      class: "rich-link-card",
      // no browser validation: "example.com" and "me@x.org" are fine here
      novalidate: true,
      onsubmit: event => {
        event.preventDefault()
        const href = normalizeLink(input.value)
        if (href) finish(href)
      },
    },
    el("h3", { class: "rich-sheet-title" }, "Link"),
    input,
    el(
      "div",
      { class: "rich-sheet-buttons" },
      el("button", { class: "rich-button", type: "button", disabled: !existing, onclick: () => finish("") }, "Remove"),
      el("span", { class: "rich-sheet-spacer" }),
      el("button", { class: "rich-button", type: "button", onclick: () => finish(null) }, "Cancel"),
      apply,
    ),
  )
  input.addEventListener("input", () => {
    apply.disabled = !input.value.trim()
  })
  const sheet = el(
    "div",
    {
      class: "rich-sheet rich-link-dialog",
      role: "dialog",
      "aria-modal": "true",
      "aria-label": "Link",
      onmousedown: event => {
        if (event.target === sheet) {
          event.preventDefault()
          finish(null)
        }
      },
    },
    card,
  )
  const onKey = event => {
    if (event.key !== "Escape") return
    event.preventDefault()
    event.stopPropagation()
    finish(null)
  }
  function close() {
    document.removeEventListener("keydown", onKey, true)
    sheet.remove()
  }
  document.addEventListener("keydown", onKey, true)
  context.element.append(sheet)
  input.focus()
  input.select()
  return sheet
}

// ---------------------------------------------------------------------------
// The paperclip menu
// ---------------------------------------------------------------------------

async function attachFiles(wg, accept) {
  const files = await pickFiles(accept)
  const urls = []
  for (const file of files) {
    try {
      urls.push(await createFileDoc(file))
    } catch (error) {
      console.error("rich: could not store file", error)
    }
  }
  if (urls.length) insertBlocks(wg, urls.map(url => Embed.of(url)))
}

// Recording a sound: a file doc of the recording, embedded like any file.
function recordAudio(bar) {
  const { wg } = bar
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") return
  const status = el("span", { class: "rich-recording-time" }, "0:00")
  const stop = el("button", { class: "rich-recording-stop", type: "button" }, "Stop")
  const panel = el("div", { class: "rich-recording" }, el("span", { class: "rich-recording-dot" }), status, stop)
  bar.layer.append(panel)
  let recorder = null
  let timer = null
  const started = Date.now()
  const finish = () => {
    clearInterval(timer)
    panel.remove()
  }
  stop.onclick = () => (recorder ? recorder.stop() : finish())
  navigator.mediaDevices
    .getUserMedia({ audio: true })
    .then(stream => {
      const chunks = []
      recorder = new MediaRecorder(stream)
      recorder.ondataavailable = event => chunks.push(event.data)
      recorder.onstop = async () => {
        stream.getTracks().forEach(track => track.stop())
        finish()
        const type = recorder.mimeType || "audio/webm"
        const extension = type.includes("mp4") ? "m4a" : type.split("/")[1]?.split(";")[0] || "webm"
        const file = new File(chunks, `Recording ${stamp().slice(0, 16).replace("T", " ")}.${extension}`, { type })
        try {
          insertBlocks(wg, [Embed.of(await createFileDoc(file))])
        } catch (error) {
          console.error("rich: could not store recording", error)
        }
      }
      recorder.start()
      timer = setInterval(() => {
        const seconds = Math.floor((Date.now() - started) / 1000)
        status.textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
      }, 500)
    })
    .catch(finish)
}

const SpeechRecognition = () => globalThis.SpeechRecognition ?? globalThis.webkitSpeechRecognition

// Live transcription types what it hears at the caret, as plain text. The
// words not yet final are only shown, never saved.
function liveTranscription(bar) {
  const { wg } = bar
  const Recognition = SpeechRecognition()
  if (!Recognition) return
  if (bar.transcribing) {
    bar.transcribing.stop()
    return
  }
  const recognition = new Recognition()
  recognition.continuous = true
  recognition.interimResults = true
  const interim = el("div", { class: "rich-transcribing" }, el("span", { class: "rich-recording-dot" }), el("span", { class: "rich-transcribing-text" }, "Listening…"))
  bar.layer.append(interim)
  recognition.onresult = event => {
    let pending = ""
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i]
      if (result.isFinal) {
        const text = result[0].transcript
        const head = wg.state.selection.head
        wg.dispatch({ changes: { from: head, insert: [Leaf.text(text)] }, userEvent: "input.dictation" })
      } else pending += result[0].transcript
    }
    interim.lastChild.textContent = pending || "Listening…"
  }
  recognition.onend = () => {
    interim.remove()
    bar.transcribing = null
  }
  interim.onclick = () => recognition.stop()
  bar.transcribing = recognition
  recognition.start()
}

// Logline…: the facts of a logline as a form, extras as key/value rows.
function loglineForm(bar, existing) {
  const { wg } = bar
  let facts = {}
  const found = existing ?? selectedLogline(wg.state)
  if (found) {
    try {
      facts = JSON.parse(found.node.param || "{}")
    } catch {}
  } else {
    facts = { ts: stamp(), tz: timeZone() }
  }
  const known = ["ts", "created", "tz", "location", "lat", "lon", "weather"]
  const field = (name, label, type = "text") =>
    el(
      "label",
      { class: "rich-form-field" },
      el("span", {}, label),
      el("input", { name, type, value: facts[name] ?? "", step: type === "number" ? "any" : null }),
    )
  const extras = el("div", { class: "rich-form-extras" })
  const extraRow = (key = "", value = "") =>
    el(
      "div",
      { class: "rich-form-extra" },
      el("input", { class: "rich-extra-key", placeholder: "key", value: key }),
      el("input", { class: "rich-extra-value", placeholder: "value", value: String(value) }),
      el("button", { type: "button", class: "rich-extra-remove", title: "Remove", onclick: event => event.target.closest(".rich-form-extra").remove() }, "×"),
    )
  for (const [key, value] of Object.entries(facts)) {
    if (!known.includes(key) && key !== "pending") extras.append(extraRow(key, value))
  }
  const stampKey = facts.created != null && facts.ts == null ? "created" : "ts"
  const { result } = Dialog.show(wg, {
    class: "rich-dialog rich-logline-dialog",
    focus: "input",
    content: () =>
      el(
        "form",
        {},
        el("h3", {}, "Logline"),
        field(stampKey, stampKey === "created" ? "Created" : "Time"),
        field("tz", "Time zone"),
        field("location", "Location"),
        field("lat", "Latitude", "number"),
        field("lon", "Longitude", "number"),
        field("weather", "Weather"),
        extras,
        el("button", { type: "button", class: "rich-form-add", onclick: () => extras.append(extraRow()) }, "Add Field"),
        el("button", { type: "submit" }, found ? "Save" : "Insert"),
      ),
  })
  result.then(form => {
    if (!form?.elements) return
    const next = {}
    for (const name of [stampKey, "tz", "location", "weather"]) {
      const value = form.elements[name]?.value?.trim()
      if (value) next[name] = value
    }
    for (const name of ["lat", "lon"]) {
      const value = form.elements[name]?.value
      if (value !== "" && value != null && !Number.isNaN(Number(value))) next[name] = Number(value)
    }
    for (const row of form.querySelectorAll(".rich-form-extra")) {
      const key = row.querySelector(".rich-extra-key").value.trim()
      const value = row.querySelector(".rich-extra-value").value
      if (key && !(key in next)) next[key] = value
    }
    const leaf = Logline.of(JSON.stringify(next))
    if (found) {
      wg.dispatch({ changes: { from: found.pos, to: found.pos + 1, insert: [leaf] }, userEvent: "input.logline" })
      wg.focus()
    } else insertBlocks(wg, [leaf])
  })
}

function selectedLogline(state) {
  const { from, to } = state.selection
  if (to - from !== 1) return null
  const node = state.doc.resolve(from).nodeAfter
  return node && node.type === Logline ? { node, pos: from } : null
}

// Patchwork Doc…: lush's "New Patchwork Document" sheet. Pick a datatype and
// a fresh document of it is made (`repo.create`, then the datatype's own
// `init`) and embedded where the caret is. An existing document's URL can be
// embedded from the same sheet.
async function createPatchworkDoc(type) {
  const repo = globalThis.repo
  if (!repo) throw new Error("rich: no repo to create a document in")
  const loaded = await loadPlugin("patchwork:datatype", type.id)
  const datatype = loaded?.module ?? type.module ?? loaded
  const handle = repo.create()
  handle.change(doc => {
    datatype?.init?.(doc, repo)
    doc["@patchwork"] ??= {}
    doc["@patchwork"].type ??= type.id
  })
  return handle.url
}

function embedFor(url, type) {
  let tool = null
  try {
    tool = (getSupportedToolsForType(type) ?? []).find(tool => !tool.unlisted)?.id ?? null
  } catch {}
  return tool ? Embed.of(url).withMarks([EmbedTool.of(tool)]) : Embed.of(url)
}

function patchworkDocForm(bar) {
  const { wg, context } = bar
  context.element.querySelector(".rich-doc-sheet")?.remove()
  const at = wg.state.selection
  const types = globalThis.repo
    ? listPlugins("patchwork:datatype").filter(type => type?.id && !type.unlisted && type.id !== "file")
    : []
  const insert = leaf => {
    close()
    wg.dispatch({ selection: { anchor: at.anchor, head: at.head } })
    insertBlocks(wg, [leaf])
  }
  const status = el("p", { class: "rich-sheet-status", role: "status" })
  const typeButton = type =>
    el(
      "button",
      {
        class: "rich-doc-type",
        type: "button",
        "data-type": type.id,
        onclick: async () => {
          status.textContent = `Making a new ${type.name ?? type.id}…`
          try {
            insert(embedFor(await createPatchworkDoc(type), type.id))
          } catch (error) {
            console.error(error)
            status.textContent = `Could not make a ${type.name ?? type.id}.`
          }
        },
      },
      svg(ICONS.shippingbox, 14),
      el("span", {}, type.name ?? type.id),
    )
  const url = el("input", { type: "text", name: "url", placeholder: "automerge:…", "aria-label": "Document URL", autocomplete: "off", spellcheck: "false" })
  const card = el(
    "form",
    {
      class: "rich-doc-card",
      novalidate: true,
      onsubmit: event => {
        event.preventDefault()
        let value = url.value.trim()
        if (!value) return
        const id = value.match(/#doc=([^&\s]+)/)?.[1] ?? value.match(/automerge:([A-Za-z0-9]+)/)?.[1]
        if (id) value = `automerge:${id}`
        insert(Embed.of(value))
      },
    },
    el("h3", { class: "rich-sheet-title" }, "New Patchwork Document"),
    types.length
      ? el("div", { class: "rich-doc-types", role: "list" }, ...types.map(typeButton))
      : el("p", { class: "rich-sheet-note" }, "There is no repo here to make a document in. Embed one by its URL."),
    el("label", { class: "rich-sheet-label" }, "Or embed a document", url),
    status,
    el(
      "div",
      { class: "rich-sheet-buttons" },
      el("span", { class: "rich-sheet-spacer" }),
      el("button", { class: "rich-button", type: "button", onclick: () => { close(); wg.focus() } }, "Cancel"),
      el("button", { class: "rich-button prominent", type: "submit" }, "Embed"),
    ),
  )
  const sheet = el(
    "div",
    {
      class: "rich-sheet rich-doc-sheet",
      role: "dialog",
      "aria-modal": "true",
      "aria-label": "New Patchwork Document",
      onmousedown: event => {
        if (event.target === sheet) {
          event.preventDefault()
          close()
          wg.focus()
        }
      },
    },
    card,
  )
  const onKey = event => {
    if (event.key !== "Escape") return
    event.preventDefault()
    event.stopPropagation()
    close()
    wg.focus()
  }
  function close() {
    document.removeEventListener("keydown", onKey, true)
    sheet.remove()
  }
  document.addEventListener("keydown", onKey, true)
  context.element.append(sheet)
  ;(card.querySelector(".rich-doc-type") ?? url).focus()
  return sheet
}

export function insertTable(wg, rows = 3, columns = 3) {
  const cell = tag => tag.create([Paragraph.create([])])
  const table = Table.create([
    TableRow.create(Array.from({ length: columns }, () => cell(BlockHeaderCell))),
    ...Array.from({ length: rows - 1 }, () =>
      TableRow.create(Array.from({ length: columns }, () => cell(BlockCell))),
    ),
  ])
  topLevelInsert(wg, [table], 4)
}

export function insertColumns(wg, count = 2) {
  const row = Columns.create(Array.from({ length: count }, () => Column.create([Paragraph.create([])])))
  topLevelInsert(wg, [row], 3)
}

// Tables and columns only live at the top level of a note, as in lush: they
// go after the top-level block the caret is in.
function topLevelInsert(wg, nodes, depth) {
  const state = wg.state
  let top = state.sel.head.parent
  while (top?.parent?.parent) top = top.parent
  const block = state.sel.head.textblockParent
  const empty = block && block.node.contentLength === 0 && block.parent?.node === state.doc
  const from = empty ? block.before : top ? top.after : state.doc.contentLength
  const to = empty ? block.after : from
  wg.dispatch({
    changes: { from, to, insert: nodes },
    selection: { anchor: from + depth },
    scrollIntoView: true,
    userEvent: "input.insert",
  })
  wg.focus()
}

function attachMenu(bar) {
  const { wg } = bar
  const popover = new Popover(bar, bar.clip, "rich-attach-menu")
  const act = run => () => {
    popover.close()
    run()
  }
  const canRecord = Boolean(navigator.mediaDevices?.getUserMedia) && typeof MediaRecorder !== "undefined"
  popover.body.replaceChildren(
    menuItem("Choose Photo…", "photo", act(() => attachFiles(wg, "image/*"))),
    menuItem("Record Audio", "waveform", act(() => recordAudio(bar)), { disabled: !canRecord }),
    menuItem(bar.transcribing ? "Stop Transcription" : "Live Transcription", "micFill", act(() => liveTranscription(bar)), {
      disabled: !SpeechRecognition(),
    }),
    menuItem("Attach File…", "file", act(() => attachFiles(wg, ""))),
    divider(),
    menuItem("Logline", "clock", act(async () => insertBlocks(wg, [await loglineNow()]))),
    menuItem("Logline…", "clockEdit", act(() => loglineForm(bar))),
    menuItem("Table", "table", act(() => insertTable(wg))),
    menuItem("Columns", "columns", act(() => insertColumns(wg))),
    menuItem("HTML Block", "html", act(() => insertHtmlBlock(wg))),
    menuItem("Patchwork Doc…", "shippingbox", act(() => patchworkDocForm(bar))),
  )
  return popover
}

// ---------------------------------------------------------------------------
// The ••• menu and the info popover
// ---------------------------------------------------------------------------

function noteMenu(bar) {
  const { wg, context } = bar
  const popover = new Popover(bar, bar.more, "rich-note-menu")
  const act = (run, focus = true) => () => {
    popover.close()
    run()
    if (focus) wg.focus()
  }
  const hidden = context.element.classList.contains("rich-hide-checked")
  const checked = hasChecked(wg.state.doc)
  const items = [
    // A duplicate is a new document, so it needs a repo to make one in; a
    // host without one (the site editor) duplicates its own way.
    globalThis.repo && context.handle ? menuItem("Duplicate", "duplicate", act(() => duplicate(bar))) : null,
    context.handle?.url
      ? menuItem("Copy Link", "copyLink", act(() => navigator.clipboard?.writeText(context.handle.url)))
      : null,
    divider(),
    menuItem("Find…", "find", act(() => openFind(wg, false), false), { shortcut: "⌘F" }),
    menuItem("Find and Replace…", "replace", act(() => openFind(wg, true), false), { shortcut: "⌥⌘F" }),
    divider(),
    menuItem("Export as Markdown…", "export", act(() => exportAs(bar, "markdown"))),
    menuItem("Export as HTML…", "export", act(() => exportAs(bar, "html"))),
    divider(),
    menuItem("Move Checked to Bottom", "checkBottom", act(() => moveCheckedToBottom(wg)), { disabled: !checked }),
    menuItem(hidden ? "Show Checked Items" : "Hide Checked Items", hidden ? "eye" : "eyeSlash", act(() =>
      context.element.classList.toggle("rich-hide-checked", !hidden),
    )),
    menuItem("Delete Checked Items", "trash", act(() => deleteCheckedItems(wg)), { disabled: !checked, danger: true }),
  ]
  if (inTable(wg.state) || wg.state.selection instanceof CellSelection) {
    items.push(divider())
    for (const action of TABLE_ACTIONS) {
      items.push(menuItem(action.label, null, act(() => action.run(wg)), { danger: action.danger }))
    }
  }
  items.push(
    divider(),
    menuItem(
      "Plugins…",
      "plugins",
      act(() =>
        import("./plugins-panel.js").then(panel =>
          panel.openPluginsPanel({ parent: context.element, handle: context.handle }),
        ),
      ),
    ),
  )
  // no divider first, last or twice in a row
  const shown = items.filter(Boolean).filter((item, i, all) => {
    if (!item.classList.contains("rich-popover-divider")) return true
    const before = all.slice(0, i).reverse().find(Boolean)
    return before && !before.classList.contains("rich-popover-divider") && i < all.length - 1
  })
  popover.body.replaceChildren(...shown)
  return popover
}

async function exportAs(bar, format) {
  const { exportNote } = await import("./export.js")
  if (bar.context.handle) exportNote(bar.context.handle, format)
}

async function duplicate(bar) {
  const { context } = bar
  const repo = globalThis.repo
  if (!repo || !context.handle) return
  const { copyNote, RichDatatype } = await import("./datatype.js")
  const copy = copyNote(repo, context.handle.doc())
  copy.change(doc => RichDatatype.markCopy(doc))
  bar.lastCopy = copy
  context.element.dispatchEvent(new CustomEvent("rich:duplicated", { detail: { url: copy.url }, bubbles: true }))
  try {
    const { openDocument } = await import("@inkandswitch/patchwork-elements")
    openDocument(context.element, copy.url)
  } catch {}
}

// What the Info tab counts, from the spans every peer has (lush's
// InspectorViews.swift): words and characters, then the blocks by kind.
function noteStats(spans) {
  const stats = {
    words: 0,
    characters: 0,
    paragraphs: 0,
    headings: 0,
    listItems: 0,
    todos: { open: 0, checked: 0, canceled: 0, pending: 0 },
    codeBlocks: 0,
    tables: 0,
    columns: 0,
    links: 0,
    attachments: 0,
  }
  const str = value => (value == null ? "" : typeof value === "string" ? value : String(value.val ?? value))
  let text = ""
  let inCode = false
  let lastLink = null
  for (const span of spans) {
    if (span.type === "block") {
      const block = span.value
      const type = str(block.type)
      const parents = (block.parents ?? []).map(str)
      text += "\n"
      lastLink = null
      if (type !== "code-block") inCode = false
      if (type === "paragraph" && !parents.includes("blockquote")) stats.paragraphs++
      else if (type === "heading") stats.headings++
      else if (type === "unordered-list-item" || type === "ordered-list-item") stats.listItems++
      else if (type === "todo-list-item") {
        stats.listItems++
        const state = block.attrs?.checked === true ? "checked" : str(block.attrs?.state)
        stats.todos[stats.todos[state] != null ? state : "open"]++
      } else if (type === "code-block") {
        if (!inCode) stats.codeBlocks++
        inCode = true
      } else if (type === "table") stats.tables++
      else if (type === "columns") stats.columns++
      else if (type === "embed" || type === "image") stats.attachments++
    } else if (span.type === "text") {
      text += span.value
      const link = span.marks?.link ? str(span.marks.link) : null
      if (link && link !== lastLink) stats.links++
      lastLink = link
    }
  }
  const words = text.trim().split(/\s+/).filter(Boolean)
  stats.words = words.length
  stats.characters = text.replace(/\n/g, "").length
  return stats
}

// The headings, for the Outline tab: level, text and where they start.
function outlineOf(doc) {
  const headings = []
  doc.iterate((node, pos) => {
    if (!node.isPlot) return
    if (node.type?.name === "Heading") {
      headings.push({ level: Math.max(1, Number(node.tag.param) || 1), text: node.textContent(), pos })
      return false
    }
  })
  return headings
}

function infoPopover(bar) {
  const { wg, context } = bar
  const popover = new Popover(bar, bar.info, "rich-info-popover")
  let tab = bar.infoTab ?? "info"
  const handle = context.handle
  const doc = handle?.doc?.()
  let spans = []
  try {
    spans = doc ? am.spans(doc, ["content"]) : []
  } catch {}
  const row = (label, value) =>
    value == null
      ? null
      : el("div", { class: "rich-info-row" }, el("span", { class: "rich-info-label" }, label), el("span", { class: "rich-info-value" }, value))
  const section = (title, ...rows) => {
    const shown = rows.filter(Boolean)
    return shown.length ? el("section", { class: "rich-info-section" }, el("h4", {}, title), ...shown) : null
  }
  const number = value => Number(value).toLocaleString()

  function info() {
    const stats = noteStats(spans)
    const title = typeof doc?.title === "string" ? doc.title : (doc?.title?.val ?? "")
    let history = null
    try {
      if (doc) {
        const changes = am.getAllChanges(doc)
        // decoding every change is only worth it for a note of ordinary size
        const actors = changes.length <= 5000 ? new Set(changes.map(change => am.decodeChange(change).actor)) : null
        history = { changes: changes.length, contributors: actors?.size ?? null }
      }
    } catch {}
    const todos = stats.todos
    const todoCount = todos.open + todos.checked + todos.canceled + todos.pending
    return [
      section(
        "Document",
        row("Name", title || "Untitled"),
        row("Kind", "Note"),
        handle?.url ? row("Document", el("code", {}, handle.url)) : null,
      ),
      section(
        "Content",
        row("Words", number(stats.words)),
        row("Characters", number(stats.characters)),
        row("Paragraphs", number(stats.paragraphs)),
        stats.headings ? row("Headings", number(stats.headings)) : null,
        stats.listItems ? row("List items", number(stats.listItems)) : null,
        todoCount
          ? row(
              "To-dos",
              [
                `${todos.checked} done`,
                `${todos.open} open`,
                todos.pending ? `${todos.pending} pending` : null,
                todos.canceled ? `${todos.canceled} canceled` : null,
              ]
                .filter(Boolean)
                .join(", "),
            )
          : null,
        stats.codeBlocks ? row("Code blocks", number(stats.codeBlocks)) : null,
        stats.tables ? row("Tables", number(stats.tables)) : null,
        stats.columns ? row("Column layouts", number(stats.columns)) : null,
        stats.links ? row("Links", number(stats.links)) : null,
        stats.attachments ? row("Attachments", number(stats.attachments)) : null,
      ),
      history
        ? section(
            "Automerge",
            row("Changes", number(history.changes)),
            history.contributors == null ? null : row("Contributors", number(history.contributors)),
          )
        : null,
    ]
  }

  function outline() {
    const headings = outlineOf(wg.state.doc)
    if (!headings.length) return [el("p", { class: "rich-outline-empty" }, "No headings")]
    return [
      el(
        "nav",
        { class: "rich-outline", "aria-label": "Outline" },
        ...headings.map(heading =>
          el(
            "button",
            {
              class: `rich-outline-item level-${Math.min(heading.level, 3)}`,
              type: "button",
              style: `padding-left: ${6 + (Math.min(heading.level, 3) - 1) * 14}px`,
              onmousedown: event => event.preventDefault(),
              onclick: () => {
                popover.close()
                wg.dispatch({ selection: { anchor: heading.pos + 1 }, scrollIntoView: true })
                wg.focus()
              },
            },
            heading.text || "Untitled",
          ),
        ),
      ),
    ]
  }

  function render() {
    const tabButton = (id, label) => {
      const node = makeButton(`rich-tab${tab === id ? " active" : ""}`, label, label, () => {
        tab = bar.infoTab = id
        render()
      })
      node.setAttribute("role", "tab")
      node.setAttribute("aria-selected", String(tab === id))
      return node
    }
    popover.body.replaceChildren(
      el("div", { class: "rich-tabs", role: "tablist" }, tabButton("info", "Info"), tabButton("outline", "Outline")),
      el("div", { class: "rich-tab-panel", role: "tabpanel" }, ...(tab === "info" ? info() : outline())),
    )
  }
  render()
  return popover
}

// ---------------------------------------------------------------------------
// The bar
// ---------------------------------------------------------------------------

class TopBar {
  constructor(wg, context) {
    this.wg = wg
    this.context = context
    barOf.set(wg, this)
    this.popover = null
    this.transcribing = null

    this.aa = makeButton("rich-bar-button rich-aa", "Format", el("span", { class: "rich-aa-glyph" }, "Aa"), () =>
      this.toggle(formatPopover),
    )
    this.clip = makeButton("rich-bar-button rich-clip", "Attach", svg(ICONS.paperclip, 16), () => this.toggle(attachMenu))
    this.more = makeButton("rich-bar-button rich-more", "More", svg(ICONS.more, 16), () => this.toggle(noteMenu))
    this.info = makeButton("rich-bar-button rich-info", "Info", svg(ICONS.info, 17), () => this.toggle(infoPopover))

    this.layer = el(
      "div",
      { class: "rich-topbar" },
      el("div", { class: "rich-topbar-side" }),
      el("div", { class: "rich-bar-pill rich-bar-centre" }, this.aa, this.clip),
      el("div", { class: "rich-topbar-side rich-topbar-right" }, el("div", { class: "rich-bar-pill" }, this.more, this.info)),
    )
  }

  // Phone width: lush's iOS layout, where the format popover is an island.
  narrow() {
    return this.context.element.getBoundingClientRect().width < 560
  }

  toggle(make) {
    const was = this.popover
    was?.close()
    if (was && was.maker === make) return
    const popover = make(this)
    popover.maker = make
    this.popover = popover
    popover.open()
  }

  connect() {
    this.context.element.classList.add("rich-has-topbar")
    this.context.element.append(this.layer)
    this.sync()
  }

  disconnect() {
    this.popover?.close()
    this.transcribing?.stop()
    this.layer.remove()
    this.context.element.classList.remove("rich-has-topbar")
  }

  remove() {
    this.disconnect()
  }

  update(update) {
    if (!update.docChanged && !update.selectionSet) return
    this.sync()
    if (this.popover?.render) this.popover.render()
  }

  // The Aa wears the marks the selection does, as lush's button does.
  sync() {
    const state = this.wg.state
    const glyph = this.aa.firstChild
    const marks = [Strong, Emphasis, Underline, Strikethrough, Code].filter(mark => active(state, mark))
    const font = markIn(state, Font)?.value
    glyph.className = [
      "rich-aa-glyph",
      ...marks.map(mark => `wears-${mark.type?.name ?? mark.name}`),
      font ? `wears-font-${font}` : "",
      baselineAt(state, Superscript) ? "wears-sup" : "",
      baselineAt(state, Subscript) ? "wears-sub" : "",
    ]
      .filter(Boolean)
      .join(" ")
    // lush tints the Aa for any mark it knows, the baselines included
    const baseline = baselineAt(state, Superscript) || baselineAt(state, Subscript)
    this.aa.classList.toggle("marked", marks.length > 0 || Boolean(font) || baseline)
  }
}

export function topBar(context) {
  return [
    Wordgard.Plugin.define(wg => new TopBar(wg, context)).extension,
  ]
}

export { loglineForm, selectedLogline }

// Cmd-K: the link editor, from the key binding.
export function openLinkEditor(wg) {
  const bar = barOf.get(wg)
  if (!bar) return false
  bar.popover?.close()
  linkDialog(bar)
  return true
}

// Cmd-Opt-L: the logline form, from the key binding (which has no bar).
export function openLoglineForm(wg) {
  const bar = barOf.get(wg)
  if (bar) loglineForm(bar)
}

const barOf = new WeakMap()
