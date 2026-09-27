// Lush's top bar: a translucent strip floating over the note, the text fading
// away beneath it as you scroll. In the middle a pill with "Aa" (the format
// popover) and a paperclip (things to put in the note); on the right a pill
// with "•••" (the note) and an info button.
//
// The popover is lush's FormatPopover, row for row: the marks, the fonts, the
// highlights, the block styles each drawn in its own style, and the indent
// pill — every one of them writing exactly what lush writes.
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

const button = (className, title, content, onpress) =>
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

const menuItem = (label, glyph, run, { disabled = false, danger = false } = {}) =>
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
  let linkEditing = null

  const markButton = (title, content, isActive, run) => {
    const node = button("rich-mark-button", title, content, () => {
      run()
      render()
    })
    node.classList.toggle("active", isActive)
    node.setAttribute("aria-pressed", String(isActive))
    return node
  }

  function linkRow(state) {
    const existing = markIn(state, Link)
    const { from, to } = state.selection
    const input = el("input", {
      class: "rich-link-input",
      type: "url",
      placeholder: "https://…",
      value: existing?.value ?? "",
    })
    const restore = () => wg.dispatch({ selection: { anchor: from, head: to } })
    const commit = href => {
      restore()
      if (existing) Command.dispatch(wg, toggleMark, existing)
      if (href) Command.dispatch(wg, toggleMark, Link.of(href))
      linkEditing = null
      render()
      wg.focus()
    }
    const form = el(
      "form",
      {
        class: "rich-link-editor",
        onsubmit: event => {
          event.preventDefault()
          commit(input.value.trim())
        },
      },
      input,
      el("button", { class: "rich-link-submit", type: "submit" }, existing ? "Update" : "Link"),
      existing
        ? el(
            "button",
            {
              class: "rich-link-remove",
              type: "button",
              title: "Remove link",
              onclick: event => {
                event.preventDefault()
                commit("")
              },
            },
            svg(ICONS.none, 13),
          )
        : null,
    )
    queueMicrotask(() => {
      input.focus()
      input.select()
    })
    return form
  }

  function render() {
    if (popover.element.contains(document.activeElement) && linkEditing) return
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
          linkEditing = linkEditing ? null : true
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
    if (linkEditing) rows.push(linkRow(state))

    const font = markIn(state, Font)?.value ?? null
    const fontButton = (label, family, isActive, run) => {
      const node = button(`rich-font-button rich-font-sample-${family}`, label, label, () => {
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
        fontButton("Code", "mono", active(state, Code), () => Command.dispatch(wg, toggleMark, Code)),
      ),
    )

    const highlight = highlightAt(state)
    rows.push(
      el(
        "div",
        { class: "rich-highlight-row" },
        el("span", { class: `rich-highlighter${highlight ? " active" : ""}` }, svg(ICONS.highlighter, 14)),
        ...HIGHLIGHTS.map(name => {
          const node = button(`rich-swatch rich-highlight-${name}`, `${name[0].toUpperCase()}${name.slice(1)} Highlight`, null, () => {
            setHighlight(wg, highlight === name ? null : name)
            render()
          })
          node.dataset.highlight = name
          node.classList.toggle("active", highlight === name)
          return node
        }),
        button("rich-swatch-none", "No Highlight", svg(ICONS.none, 15), () => {
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
        const node = button(`rich-style-row rich-style-${id}`, block.name, [
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
          button("rich-mark-button", "Decrease Indent", svg(ICONS.outdent, 14), () => {
            indentBlock(wg, -1)
            render()
          }),
          button("rich-mark-button", "Increase Indent", svg(ICONS.indent, 14), () => {
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
  }

  popover.render = render
  render()
  return popover
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

function patchworkDocForm(bar) {
  const { wg } = bar
  const { result } = Dialog.show(wg, {
    class: "rich-dialog",
    focus: "input",
    content: () =>
      el(
        "form",
        {},
        el("h3", {}, "Patchwork Doc"),
        el("label", { class: "rich-form-field" }, el("span", {}, "URL"), el("input", { name: "url", placeholder: "automerge:…" })),
        el("label", { class: "rich-form-field" }, el("span", {}, "Tool"), el("input", { name: "tool", placeholder: "optional" })),
        el("button", { type: "submit" }, "Insert"),
      ),
  })
  result.then(form => {
    let url = form?.elements?.url?.value?.trim()
    if (!url) return
    const id = url.match(/#doc=([^&\s]+)/)?.[1]
    if (id) url = `automerge:${id}`
    const tool = form.elements.tool.value.trim()
    const leaf = tool ? Embed.of(url).withMarks([EmbedTool.of(tool)]) : Embed.of(url)
    insertBlocks(wg, [leaf])
  })
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
    menuItem("Record Audio", "mic", act(() => recordAudio(bar)), { disabled: !canRecord }),
    menuItem(bar.transcribing ? "Stop Transcription" : "Live Transcription", "waveform", act(() => liveTranscription(bar)), {
      disabled: !SpeechRecognition(),
    }),
    menuItem("Attach File…", "paperclip", act(() => attachFiles(wg, ""))),
    divider(),
    menuItem("Logline", "clock", act(async () => insertBlocks(wg, [await loglineNow()]))),
    menuItem("Logline…", "clockEdit", act(() => loglineForm(bar))),
    menuItem("Table", "table", act(() => insertTable(wg))),
    menuItem("Columns", "columns", act(() => insertColumns(wg))),
    menuItem("HTML Block", "html", act(() => insertHtmlBlock(wg))),
    menuItem("Patchwork Doc…", "doc", act(() => patchworkDocForm(bar))),
  )
  return popover
}

// ---------------------------------------------------------------------------
// The ••• menu and the info popover
// ---------------------------------------------------------------------------

function noteMenu(bar) {
  const { wg, context } = bar
  const popover = new Popover(bar, bar.more, "rich-note-menu")
  const act = run => () => {
    popover.close()
    run()
    wg.focus()
  }
  const items = [
    menuItem("Duplicate", "duplicate", act(() => duplicate(bar))),
    context.handle?.url
      ? menuItem("Copy Link", "copyLink", act(() => navigator.clipboard?.writeText(context.handle.url)))
      : null,
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
  popover.body.replaceChildren(...items.filter(Boolean))
  return popover
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

function countWords(doc) {
  const text = doc.textContent?.() ?? ""
  const words = text.trim() ? text.trim().split(/\s+/).length : 0
  return { words, characters: text.length }
}

function infoPopover(bar) {
  const { wg, context } = bar
  const popover = new Popover(bar, bar.info, "rich-info-popover")
  const { words, characters } = countWords(wg.state.doc)
  const doc = context.handle?.doc?.()
  const title = typeof doc?.title === "string" ? doc.title : (doc?.title?.val ?? "")
  const row = (label, value) =>
    el("div", { class: "rich-info-row" }, el("span", { class: "rich-info-label" }, label), el("span", { class: "rich-info-value" }, value))
  popover.body.replaceChildren(
    el("div", { class: "rich-info-title" }, title || "Untitled"),
    row("Words", words.toLocaleString()),
    row("Characters", characters.toLocaleString()),
    context.handle?.url ? row("Document", el("code", {}, context.handle.url)) : null,
  )
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

    this.aa = button("rich-bar-button rich-aa", "Format", el("span", { class: "rich-aa-glyph" }, "Aa"), () =>
      this.toggle(formatPopover),
    )
    this.clip = button("rich-bar-button rich-clip", "Attach", svg(ICONS.paperclip, 16), () => this.toggle(attachMenu))
    this.more = button("rich-bar-button rich-more", "More", svg(ICONS.more, 16), () => this.toggle(noteMenu))
    this.info = button("rich-bar-button rich-info", "Info", svg(ICONS.info, 17), () => this.toggle(infoPopover))

    this.layer = el(
      "div",
      { class: "rich-topbar" },
      el("div", { class: "rich-topbar-side" }),
      el("div", { class: "rich-bar-pill rich-bar-centre" }, this.aa, this.clip),
      el("div", { class: "rich-topbar-side rich-topbar-right" }, el("div", { class: "rich-bar-pill" }, this.more, this.info)),
    )
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
    this.aa.classList.toggle("marked", marks.length > 0 || Boolean(font))
  }
}

export function topBar(context) {
  return [
    Wordgard.Plugin.define(wg => new TopBar(wg, context)).extension,
  ]
}

export { loglineForm, selectedLogline }

// Cmd-Opt-L: the logline form, from the key binding (which has no bar).
export function openLoglineForm(wg) {
  const bar = barOf.get(wg)
  if (bar) loglineForm(bar)
}

const barOf = new WeakMap()
