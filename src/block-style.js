// Block styles, set the way lush sets them.
//
// Lush holds a note as lines, each wearing one block marker: a type, the
// lists and the quote the line sits in (`parents`) and its attrs. Picking a
// style replaces the marker of every line the selection touches — parents
// and attrs along with it, lush's `applyBlockStyle` — and keeps the text and
// its marks. Indenting is the same kind of edit: a list line goes one list
// deeper or shallower (`adjustListNesting`), any other line takes an
// `indent` attr, and only the lines selected move.
//
// So these are edits to the note's spans — the lines this editor writes —
// read back and put in the editor as one change. That is one undo, and
// exactly what a fresh editor on the same note shows: three lines made code
// are one code block, as they are when the note is opened again.
import * as am from "@automerge/automerge"
import { GardSelection } from "wordgard/state"
import { CellSelection } from "wordgard/table"
import { richAdapter } from "./adapter.js"
import { diffDocs, docFromSpans, indexFromPos, indexUnits, spansFromDoc } from "./wordgard/index.js"

export const LIST_TYPES = ["unordered-list-item", "ordered-list-item", "todo-list-item"]

// lush's BlockValue.fromStyleKey, by the ids block-types.js uses
const STYLES = {
  text: { type: "paragraph" },
  h1: { type: "heading", attrs: { level: 1 } },
  h2: { type: "heading", attrs: { level: 2 } },
  h3: { type: "heading", attrs: { level: 3 } },
  code: { type: "code-block" },
  bullet: { type: "unordered-list-item" },
  ordered: { type: "ordered-list-item" },
  todo: { type: "todo-list-item" },
  quote: { type: "blockquote" },
}

// Lines that are never restyled: the markers that only frame a table's or
// a column layout's rows. (Embeds, which sit behind one character in lush,
// are skipped too; see `editable`.)
const FRAMES = new Set(["table", "table-row", "columns"])

// Containers whose first line has no marker of its own: a cell's or a
// column's first paragraph is the text right after the container's marker.
const CELLS = { "table-cell": "table-cell", "table-header-cell": "table-cell", column: "column" }

// The blocks that take an `indent` attr.
const INDENTABLE = ["paragraph", "heading", "code-block", "blockquote"]

const str = value => (am.isImmutableString(value) ? value.val : typeof value === "string" ? value : "")

// A marker as plain values, to edit.
const plain = value => ({
  type: str(value.type) || "paragraph",
  parents: (value.parents ?? []).map(str),
  attrs: { ...(value.attrs ?? {}) },
  isEmbed: Boolean(value.isEmbed),
})

// And back into the spans, names as Str scalars, the way lush writes them.
// Attr values go as they are (a string attr made here is a Str already).
const toSpan = block => {
  const attrs = {}
  for (const [key, value] of Object.entries(block.attrs)) {
    if (value !== undefined) attrs[key] = value
  }
  return {
    type: "block",
    value: {
      type: new am.ImmutableString(block.type),
      parents: block.parents.map(parent => new am.ImmutableString(parent)),
      attrs,
      isEmbed: block.isEmbed,
    },
  }
}

const editable = block => !block.isEmbed && !FRAMES.has(block.type) && !["embed", "image", "html"].includes(block.type)

// What a block sits in that a style keeps: the table cell or the column.
// Lists and quotes are the style's own business.
export const containerPrefix = parents =>
  parents[0] === "table" ? parents.slice(0, 3) : parents[0] === "columns" ? parents.slice(0, 2) : []

// How deep a line sits, not counting the table cell or column holding it:
// lush's parents, which a cell's own editor counts from the cell.
const depth = block => block.parents.length - containerPrefix(block.parents).length

// The note's lines: each block marker, where it is in the spans and in
// automerge's sequence, and where its text ends.
function linesOf(spans) {
  const lines = []
  let index = 0
  spans.forEach((span, at) => {
    if (span.type === "block") {
      lines.push({ at, index, block: plain(span.value) })
      index++
    } else index += span.value.length
  })
  lines.forEach((line, i) => (line.end = i + 1 < lines.length ? lines[i + 1].index : index))
  return { lines, length: index }
}

// The line an automerge index is in: its text runs from just after its
// marker up to the next one.
function lineAt(lines, index) {
  let lo = 0
  let hi = lines.length - 1
  let found = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (lines[mid].index < index) {
      found = mid
      lo = mid + 1
    } else hi = mid - 1
  }
  return found
}

// The lines a selection touches, the way lush's `paragraphRange` finds them:
// every line it has text of, and the line a caret is in. A selected embed is
// only its own line.
function touched(state, units, lines) {
  const { selection } = state
  const picked = new Set()
  for (const range of selection.ranges) {
    const from = indexFromPos(units, range.from)
    const to = indexFromPos(units, range.to)
    if (selection instanceof GardSelection.Node) {
      lines.forEach((line, i) => from <= line.index && line.index < to && picked.add(i))
      continue
    }
    for (let i = Math.max(0, lineAt(lines, from)); i < lines.length; i++) {
      const line = lines[i]
      const start = line.index + 1
      if (from === to ? start > from : start >= to) break
      if (from <= line.end) picked.add(i)
    }
  }
  return [...picked].sort((a, b) => a - b).map(i => lines[i])
}

// The block a line's text wears: for a cell's or a column's first line, the
// paragraph the container implies.
function ownBlock(line) {
  const cell = CELLS[line.block.type]
  if (cell) return { type: "paragraph", parents: [...line.block.parents, cell], attrs: {}, isEmbed: false }
  return { ...line.block, parents: [...line.block.parents], attrs: { ...line.block.attrs } }
}

const blockOf = line => line.own ?? ownBlock(line)

const implied = (block, cell) =>
  block.type === "paragraph" &&
  Object.keys(block.attrs).length === 0 &&
  block.parents.length === cell.parents.length + 1 &&
  block.parents.every((parent, i) => parent === (cell.parents[i] ?? CELLS[cell.type]))

// Where a position is, as a line and an offset into its text: what a
// restyle leaves alone.
function placeOf(units, lines, pos) {
  const index = indexFromPos(units, pos)
  const line = lineAt(lines, index)
  return line < 0 ? null : { line, offset: index - (lines[line].index + 1) }
}

// And back: a position in the new document.
function positionOf(doc, units, line, offset) {
  const length = line.end - line.index - 1
  const index = line.index + 1 + Math.max(0, Math.min(offset, length))
  if (index < line.end) return units[index].pos
  if (index - 1 > line.index) return units[index - 1].pos + 1
  // an empty line: the start of its textblock, inside whatever holds it
  let pos = units[line.index].pos
  let node = doc.resolve(pos).nodeAfter
  while (node && !node.isLeaf && !node.type.inlineContent) {
    pos++
    node = node.content[0]
  }
  return pos + 1
}

// Rewrite the lines the selection touches with `edit(lines, all)`, which
// sets `own` on each line it changes to the block that line's text should
// wear, and put the result in the editor. Returns whether anything changed.
export function editLines(wg, edit, userEvent = "format.block") {
  const { state } = wg
  if (state.readOnly) return false
  const doc = state.doc
  const spans = spansFromDoc(richAdapter, doc)
  const units = indexUnits(richAdapter, doc)
  const { lines, length } = linesOf(spans)
  if (!lines.length || units.length !== length) return false
  let chosen = touched(state, units, lines).filter(line => editable(line.block))
  if (!chosen.length) return false
  for (const line of chosen) line.own = ownBlock(line)
  // Only the lines in the same place as the first: a table or a column layout
  // is one block in lush, left alone by a selection running past it, and
  // its cells are restyled only from inside.
  const where = containerPrefix(chosen[0].own.parents).join("/")
  chosen = chosen.filter(line => {
    if (containerPrefix(line.own.parents).join("/") === where) return true
    delete line.own
    return false
  })
  edit(chosen, lines)

  // The new spans: a changed line's marker replaced, and a cell's first line
  // given a marker of its own once it is more than a plain paragraph.
  const out = []
  const moved = []
  let n = -1
  let lineCount = -1
  for (const span of spans) {
    if (span.type !== "block") {
      out.push(span)
      continue
    }
    const line = lines[++n]
    moved[n] = ++lineCount
    if (!line.own) out.push(span)
    else if (CELLS[line.block.type]) {
      out.push(span)
      if (!implied(line.own, line.block)) {
        out.push(toSpan(line.own))
        moved[n] = ++lineCount
      }
    } else out.push(toSpan(line.own))
  }

  let next
  try {
    next = docFromSpans(richAdapter, out)
  } catch (error) {
    console.error("rich: could not restyle", error)
    return false
  }
  const diff = diffDocs(doc, next)
  if (!diff) return false

  const spec = {
    changes: { from: diff.from, to: diff.to, insert: diff.slice },
    scrollIntoView: true,
    userEvent,
  }
  // The selection stays on the same text.
  if (state.selection instanceof GardSelection.Text) {
    const nextUnits = indexUnits(richAdapter, next)
    const nextLines = linesOf(spansFromDoc(richAdapter, next)).lines
    if (nextLines.length === lineCount + 1) {
      const map = pos => {
        const place = placeOf(units, lines, pos)
        return place ? positionOf(next, nextUnits, nextLines[moved[place.line]], place.offset) : null
      }
      const anchor = map(state.selection.anchor)
      const head = map(state.selection.head)
      if (anchor != null && head != null) {
        // A selection running into a table is a cell selection there. Hand
        // it over as one: left to the table's own normalizing, it would be
        // mapped through this change a second time, and past the end.
        const selection = GardSelection.Text.create({ anchor, head })
        spec.selection = CellSelection.normalize(selection, next) ?? selection
      }
    }
  }
  wg.dispatch(spec)
  return true
}

// Lush writes a run of quote lines as `blockquote` for the first and
// `paragraph` inside it for the rest, so a quote line next to another is
// part of the same quote.
const quotePath = block => {
  if (block.type === "blockquote") return [...block.parents, "blockquote"]
  const at = block.parents.lastIndexOf("blockquote")
  return at < 0 ? null : block.parents.slice(0, at + 1)
}
const samePath = (a, b) => a != null && b != null && a.length === b.length && a.every((part, i) => part === b[i])

function joinQuotes(lines, first, last) {
  for (let i = Math.max(1, first); i <= Math.min(last + 1, lines.length - 1); i++) {
    const block = blockOf(lines[i])
    if (block.type !== "blockquote") continue
    const path = quotePath(block)
    if (samePath(quotePath(blockOf(lines[i - 1])), path)) {
      lines[i].own = { type: "paragraph", parents: path, attrs: {}, isEmbed: false }
    }
  }
}

function setTodo(block, state) {
  if (state === "checked") block.attrs.checked = true
  else if (state === "canceled" || state === "pending") block.attrs.state = new am.ImmutableString(state)
}

// Give every line the selection touches this style (a block-types id), the
// way lush's `applyBlockStyle` does. `todo` is the state a to-do starts in.
export function applyStyle(wg, id, { todo } = {}) {
  const style = STYLES[id]
  if (!style) return false
  return editLines(wg, (chosen, lines) => {
    for (const line of chosen) {
      line.own = {
        type: style.type,
        parents: containerPrefix(line.own.parents),
        attrs: { ...style.attrs },
        isEmbed: false,
      }
      if (id === "todo") setTodo(line.own, todo)
    }
    if (id === "quote") joinQuotes(lines, lines.indexOf(chosen[0]), lines.indexOf(chosen[chosen.length - 1]))
  })
}

// A code block is one card however many lines it has: they indent together.
const attrsKey = attrs =>
  JSON.stringify(Object.keys(attrs).sort().map(key => [key, am.isImmutableString(attrs[key]) ? attrs[key].val : attrs[key]]))
const codeRun = (a, b) =>
  a.type === "code-block" &&
  b.type === "code-block" &&
  JSON.stringify(a.parents) === JSON.stringify(b.parents) &&
  attrsKey(a.attrs) === attrsKey(b.attrs)

// Indent or outdent the lines the selection touches: a list line one list
// deeper or shallower, any other line by lush's `indent` attr. With
// `listsOnly` (Tab), only list lines move. Returns whether anything did.
export function indentLines(wg, direction, { listsOnly = false } = {}) {
  return editLines(
    wg,
    (chosen, lines) => {
      // As in lush, outdenting from a list item at the top level makes the
      // lines Body.
      const first = chosen[0].own
      if (!listsOnly && direction < 0 && LIST_TYPES.includes(first.type) && !depth(first)) {
        for (const line of chosen) {
          line.own = { type: "paragraph", parents: containerPrefix(line.own.parents), attrs: {}, isEmbed: false }
        }
        return
      }
      const lineSet = new Set(chosen)
      for (const line of chosen) {
        if (line.own.type !== "code-block") continue
        const i = lines.indexOf(line)
        for (let j = i - 1; j >= 0 && codeRun(lines[j].block, line.block) && !lineSet.has(lines[j]); j--) {
          lines[j].own = ownBlock(lines[j])
          lineSet.add(lines[j])
        }
        for (let j = i + 1; j < lines.length && codeRun(lines[j].block, line.block) && !lineSet.has(lines[j]); j++) {
          lines[j].own = ownBlock(lines[j])
          lineSet.add(lines[j])
        }
      }
      for (const line of lineSet) {
        const block = line.own
        if (LIST_TYPES.includes(block.type)) {
          // a list line goes into a list of its own kind, or out of what it
          // was last in
          if (direction > 0) block.parents.push(block.type)
          else if (depth(block) > 0) block.parents.pop()
        } else if (!listsOnly && INDENTABLE.includes(block.type)) {
          const level = Math.max(0, Math.floor(Number(block.attrs.indent) || 0) + direction)
          if (level > 0) block.attrs.indent = level
          else delete block.attrs.indent
        }
      }
    },
    direction > 0 ? "format.indent" : "format.outdent",
  )
}
