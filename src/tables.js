// Table editing. `tables()` in tool.js brings the schema, the cell selection
// and the correction/paste/drop handlers, but the row and column commands it
// registers are menu items, and rich has no menu bar. These put the same
// commands where lush has them: a "•••" menu at a table's top-trailing corner
// (and a column layout's), Tab between cells, and the top bar's ••• menu while
// the caret is in a table.
import { Command } from "wordgard/command"
import { KeyBinding, Wordgard } from "wordgard/editor"
import { GardState } from "wordgard/state"
import { BlockHeaderCell, Paragraph, Table } from "wordgard/types"
import {
  CellSelection,
  addColumn,
  addRow,
  deleteColumn,
  deleteRow,
  toggleHeaderCell,
} from "wordgard/table"
import { el, svg } from "./dom.js"
import { Column, Columns } from "./adapter.js"

// `Table` is a tag, not a type — comparing types rather than tags so a table
// carrying marks still matches.
const isTable = plot => plot.tag.type === Table.type

export const tableAt = state => state.sel.head.matchingParent(isTable)

export const inTable = state =>
  state.selection instanceof CellSelection || Boolean(tableAt(state))

// Every cell in the table, in document order. Rows and cells are plots, so a
// node's length covers its content plus its two boundary positions. Cells hold
// blocks, so the text of a cell starts two positions in (`from + 2`).
function cellRanges(table) {
  const ranges = []
  let row = table.start
  for (const rowNode of table.node.content) {
    let cell = row + 1
    for (const cellNode of rowNode.content) {
      ranges.push({ from: cell, to: cell + cellNode.length })
      cell += cellNode.length
    }
    row += rowNode.length
  }
  return ranges
}

// A command that acts on the cell the selection is in has to have the
// selection in a cell, which the block menu and the table handles don't
// guarantee. `at` puts it there first.
function runAt(wg, pos, command, param) {
  if (pos != null) wg.dispatch({ selection: { anchor: pos } })
  return command ? Command.dispatch(wg, command, param) : true
}

// What the table menu offers. Everything acts on the selection, which is
// already in the table for the menu to be showing at all.
export const TABLE_ACTIONS = [
  { id: "row-above", label: "Add row above", run: wg => Command.dispatch(wg, addRow, "before") },
  { id: "row-below", label: "Add row below", run: wg => Command.dispatch(wg, addRow, "after") },
  {
    id: "column-before",
    label: "Add column before",
    run: wg => Command.dispatch(wg, addColumn, "before"),
  },
  {
    id: "column-after",
    label: "Add column after",
    run: wg => Command.dispatch(wg, addColumn, "after"),
  },
  { id: "header", label: "Toggle header row", run: wg => toggleHeaderRow(wg) },
  { id: "delete-row", label: "Delete row", danger: true, run: wg => Command.dispatch(wg, deleteRow) },
  {
    id: "delete-column",
    label: "Delete column",
    danger: true,
    run: wg => Command.dispatch(wg, deleteColumn),
  },
]

// Lush's tables have a header row or none: header cells anywhere else are
// lost when lush saves. So the header toggles for the whole first row.
function toggleHeaderRow(wg) {
  const table = tableAt(wg.state)
  if (!table) return false
  const span = rowSpan(table, 0)
  selectSpan(wg, span.from, span.to)
  return Command.dispatch(wg, toggleHeaderCell)
}

// Tab walks the cells and, from the last one, grows the table — the habit from
// every other editor, and the only way to add a row without reaching for a
// menu.
function step(direction) {
  return wg => {
    const table = tableAt(wg.state)
    if (!table) return false
    const head = wg.state.sel.head.pos
    const ranges = cellRanges(table)
    const index = ranges.findIndex(range => head >= range.from && head <= range.to)
    if (index < 0) return false
    const next = ranges[index + direction]
    if (next) {
      wg.dispatch({ selection: { anchor: next.from + 2 }, scrollIntoView: true })
      return true
    }
    // Off the end: a new row. Off the front: nowhere to go.
    if (direction < 0) return false
    if (!Command.dispatch(wg, addRow, "after")) return false
    const grown = tableAt(wg.state)
    const after = grown && cellRanges(grown)[index + 1]
    if (after) wg.dispatch({ selection: { anchor: after.from + 2 }, scrollIntoView: true })
    return true
  }
}

// Put the selection over a range of cells.
function selectSpan(wg, from, to) {
  const selection = CellSelection.between(wg.state.doc, from, to)
  if (selection) wg.dispatch({ selection })
  else wg.dispatch({ selection: { anchor: from + 2 } })
  wg.focus()
}

function rowSpan(table, index) {
  const ranges = cellRanges(table)
  const width = table.node.content[0].content.length
  return { from: ranges[index * width].from, to: ranges[index * width + width - 1].to }
}

const hasHeader = table => table.node.content[0]?.content.every(cell => cell.type === BlockHeaderCell.type) ?? false

// Lush's table menu (TableInline.swift): grow or shrink the table at its end,
// and the header row on or off.
function tableItems(wg, table) {
  const rows = table.node.content.length
  const columns = table.node.content[0]?.content.length ?? 0
  const ranges = cellRanges(table)
  const inCell = index => ranges[index].from + 2
  return [
    { label: "Add Row", run: () => runAt(wg, inCell(ranges.length - 1), addRow, "after") },
    { label: "Add Column", run: () => runAt(wg, inCell(ranges.length - 1), addColumn, "after") },
    null,
    { label: "Remove Last Row", disabled: rows < 2, run: () => runAt(wg, inCell(ranges.length - 1), deleteRow) },
    { label: "Remove Last Column", disabled: columns < 2, run: () => runAt(wg, inCell(columns - 1), deleteColumn) },
    null,
    {
      label: "Header Row",
      checked: hasHeader(table),
      run: () => {
        runAt(wg, inCell(0))
        toggleHeaderRow(wg)
      },
    },
  ]
}

// And the column layout's (ColumnsInline.swift).
function columnsItems(wg, columns) {
  const count = columns.node.content.length
  return [
    {
      label: "Add Column",
      run: () => {
        const at = columns.end
        wg.dispatch({
          changes: { from: at, insert: [Column.create([Paragraph.create([])])] },
          selection: { anchor: at + 2 },
          userEvent: "columns.add",
        })
      },
    },
    {
      label: "Remove Last Column",
      disabled: count < 2,
      run: () => {
        const last = columns.node.content[count - 1]
        wg.dispatch({ changes: { from: columns.end - last.length, to: columns.end }, userEvent: "columns.remove" })
      },
    },
  ]
}

// lush's `ellipsis.circle.fill`
const MORE = `<circle cx="8" cy="8" r="7" fill="currentColor" stroke="none"/><circle class="rich-corner-dot" cx="4.9" cy="8" r="1" stroke="none"/><circle class="rich-corner-dot" cx="8" cy="8" r="1" stroke="none"/><circle class="rich-corner-dot" cx="11.1" cy="8" r="1" stroke="none"/>`
const CHECK = `<path d="M3 8.5l3 3 7-7"/>`

// How far outside a table the pointer still counts as on it.
const REACH = 16

// The "•••" at the top-trailing corner of the table or column layout the
// pointer is over, or the caret is in.
class CornerMenus {
  constructor(wg) {
    this.wg = wg
    this.target = null
    this.menu = null
    this.layer = el("div", { class: "rich-corner-layer" })
    this.button = el(
      "button",
      {
        class: "rich-corner-button",
        type: "button",
        title: "More",
        "aria-label": "More",
        "aria-haspopup": "menu",
        onmousedown: event => event.preventDefault(),
        onclick: event => {
          event.preventDefault()
          this.menu ? this.closeMenu() : this.openMenu()
        },
      },
      svg(MORE, 16),
    )
    this.onMouseMove = event => {
      if (this.layer.contains(event.target)) return
      this.show(this.targetNear(event) ?? this.caretTarget())
    }
    this.onMouseLeave = () => this.menu || this.show(this.caretTarget())
    this.onScroll = () => this.menu || this.place()
  }

  connect(wg) {
    wg.dom.append(this.layer)
    wg.dom.addEventListener("mousemove", this.onMouseMove)
    wg.dom.addEventListener("mouseleave", this.onMouseLeave)
    wg.scrollDOM.addEventListener("scroll", this.onScroll)
  }

  disconnect(wg) {
    this.closeMenu()
    wg.dom.removeEventListener("mousemove", this.onMouseMove)
    wg.dom.removeEventListener("mouseleave", this.onMouseLeave)
    wg.scrollDOM.removeEventListener("scroll", this.onScroll)
    this.layer.remove()
  }

  remove(wg) {
    this.disconnect(wg)
  }

  update(update) {
    if (!update.docChanged && !update.selectionSet) return
    if (this.menu && update.docChanged) this.closeMenu()
    this.wg.scheduleDOMRead(() => {
      const target = this.target?.isConnected ? this.target : this.caretTarget()
      this.show(target)
    })
  }

  // The table or column layout element the caret is in.
  caretTarget() {
    const { state } = this.wg
    const found = state.sel.head.matchingParent(plot => plot.tag.type === Table.type || plot.tag.type === Columns.type)
    if (!found) return null
    try {
      return this.wg.nodeDOM(found.before)
    } catch {
      return null
    }
  }

  targetNear(event) {
    const under = event.target.closest?.("table, .rich-columns")
    if (under && this.wg.contentDOM.contains(under)) return under
    for (const element of this.wg.contentDOM.querySelectorAll("table, .rich-columns")) {
      const box = element.getBoundingClientRect()
      if (
        event.clientX >= box.left - REACH &&
        event.clientX <= box.right + REACH &&
        event.clientY >= box.top - REACH &&
        event.clientY <= box.bottom + REACH
      ) {
        return element
      }
    }
    return null
  }

  // Where the element is in the document, as a resolved table or columns.
  plotOf(element) {
    try {
      const found = this.wg.nodeFromDOM(element)
      if (!found) return null
      return this.wg.state.doc.resolve(found.pos + 1).matchingParent(plot => plot.tag.type === Table.type || plot.tag.type === Columns.type)
    } catch {
      return null
    }
  }

  show(element) {
    if (element === this.target && this.button.isConnected) return this.place()
    this.closeMenu()
    this.target = element ?? null
    if (!element) return this.button.remove()
    this.layer.append(this.button)
    this.place()
  }

  place() {
    if (!this.target?.isConnected) return
    const host = this.wg.dom.getBoundingClientRect()
    const box = this.target.getBoundingClientRect()
    this.button.style.top = `${box.top - host.top + 3}px`
    this.button.style.left = `${box.right - host.left - 3 - 20}px`
  }

  openMenu() {
    const plot = this.target && this.plotOf(this.target)
    if (!plot) return
    const items = plot.node.type === Table.type ? tableItems(this.wg, plot) : columnsItems(this.wg, plot)
    const body = el(
      "div",
      { class: "rich-popover-body", role: "menu" },
      ...items.map(item =>
        item
          ? el(
              "button",
              {
                class: "rich-menu-item",
                type: "button",
                role: item.checked == null ? "menuitem" : "menuitemcheckbox",
                "aria-checked": item.checked == null ? null : String(item.checked),
                disabled: item.disabled,
                onmousedown: event => event.preventDefault(),
                onclick: event => {
                  event.preventDefault()
                  this.closeMenu()
                  item.run()
                  this.wg.focus()
                },
              },
              el("span", { class: "rich-menu-glyph" }, item.checked ? svg(CHECK, 12) : null),
              el("span", { class: "rich-menu-label" }, item.label),
            )
          : el("div", { class: "rich-popover-divider", role: "separator" }),
      ),
    )
    this.menu = el("div", { class: "rich-popover rich-corner-menu" }, body)
    this.layer.append(this.menu)
    const host = this.wg.dom.getBoundingClientRect()
    const button = this.button.getBoundingClientRect()
    const width = this.menu.offsetWidth
    this.menu.style.top = `${button.bottom - host.top + 4}px`
    this.menu.style.left = `${Math.max(4, button.right - host.left - width)}px`
    this.button.classList.add("open")
    this.onOutside = event => {
      if (!this.menu?.contains(event.target) && !this.button.contains(event.target)) this.closeMenu()
    }
    this.onKey = event => {
      if (event.key !== "Escape") return
      event.preventDefault()
      event.stopPropagation()
      this.closeMenu()
      this.wg.focus()
    }
    document.addEventListener("mousedown", this.onOutside, true)
    document.addEventListener("keydown", this.onKey, true)
  }

  closeMenu() {
    if (!this.menu) return
    this.menu.remove()
    this.menu = null
    this.button.classList.remove("open")
    document.removeEventListener("mousedown", this.onOutside, true)
    document.removeEventListener("keydown", this.onKey, true)
  }
}

export function tableEditing() {
  return [
    GardState.prec.high(KeyBinding.of({ key: "Tab", run: step(1) }).extension),
    GardState.prec.high(KeyBinding.of({ key: "Shift-Tab", run: step(-1) }).extension),
    Wordgard.Plugin.fromClass(CornerMenus).extension,
  ]
}
