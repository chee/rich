// Table editing. `tables()` in tool.js brings the schema, the cell selection
// and the correction/paste/drop handlers, but the row and column commands it
// registers are menu items, and rich has no menu bar. These put the same
// commands on the surfaces rich does have: the block menu, the format bar when
// cells are selected, Tab between cells, and handles on the table itself.
import { Command } from "wordgard/command"
import { KeyBinding, Wordgard } from "wordgard/editor"
import { GardState } from "wordgard/state"
import { Table } from "wordgard/types"
import {
  CellSelection,
  addColumn,
  addRow,
  deleteColumn,
  deleteRow,
  mergeCells,
  splitCell,
  toggleHeaderCell,
} from "wordgard/table"
import { el, svg } from "./dom.js"

// `Table` is a tag, not a type — comparing types rather than tags so a table
// carrying marks still matches.
const isTable = plot => plot.tag.type === Table.type

export const tableAt = state => state.sel.head.matchingParent(isTable)

// The table a block-level position points at, for the block menu, which opens
// on the table as a whole rather than on a cell.
export const tableAtPos = (state, pos) => {
  try {
    return state.doc.resolve(pos + 1).matchingParent(isTable)
  } catch {
    return null
  }
}

export const inTable = state =>
  state.selection instanceof CellSelection || Boolean(tableAt(state))

// Every cell in the table, in document order. Rows and cells are plots, so a
// node's length covers its content plus its two boundary positions.
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
  return Command.dispatch(wg, command, param)
}

// What the format bar offers once cells are selected: everything acts on the
// selection, so `label` is the short form the bar shows and `title` the long
// one it explains itself with.
export const TABLE_ACTIONS = [
  { id: "row-above", label: "Row ↑", title: "Row above", run: wg => Command.dispatch(wg, addRow, "before") },
  { id: "row-below", label: "Row ↓", title: "Row below", run: wg => Command.dispatch(wg, addRow, "after") },
  {
    id: "column-before",
    label: "Col ←",
    title: "Column left",
    run: wg => Command.dispatch(wg, addColumn, "before"),
  },
  {
    id: "column-after",
    label: "Col →",
    title: "Column right",
    run: wg => Command.dispatch(wg, addColumn, "after"),
  },
  { id: "header", label: "Header", title: "Toggle header cells", run: wg => Command.dispatch(wg, toggleHeaderCell) },
  { id: "merge", label: "Merge", title: "Merge cells", run: wg => Command.dispatch(wg, mergeCells) },
  { id: "split", label: "Split", title: "Split cell", run: wg => Command.dispatch(wg, splitCell) },
  { id: "delete-row", label: "− Row", title: "Delete row", run: wg => Command.dispatch(wg, deleteRow) },
  { id: "delete-column", label: "− Col", title: "Delete column", run: wg => Command.dispatch(wg, deleteColumn) },
]

// The block menu opens on the table as a whole, so its verbs are table-level:
// grow it at the end, or flip the header row. Editing a particular row or
// column needs one selected, which the grips and the format bar do.
export const TABLE_BLOCK_ACTIONS = [
  {
    id: "add-row",
    label: "Add row",
    run: (wg, table) => runAt(wg, lastCell(table), addRow, "after"),
  },
  {
    id: "add-column",
    label: "Add column",
    run: (wg, table) => runAt(wg, lastCell(table), addColumn, "after"),
  },
  {
    id: "header-row",
    label: "Toggle header row",
    run: (wg, table) => {
      const span = rowSpan(table, 0)
      selectSpan(wg, span.from, span.to)
      Command.dispatch(wg, toggleHeaderCell)
    },
  },
]

const lastCell = table => cellRanges(table).at(-1).from + 1

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
      wg.dispatch({ selection: { anchor: next.from + 1 }, scrollIntoView: true })
      return true
    }
    // Off the end: a new row. Off the front: nowhere to go.
    if (direction < 0) return false
    if (!Command.dispatch(wg, addRow, "after")) return false
    const grown = tableAt(wg.state)
    const after = grown && cellRanges(grown)[index + 1]
    if (after) wg.dispatch({ selection: { anchor: after.from + 1 }, scrollIntoView: true })
    return true
  }
}

// Selecting a whole row or column is what makes the format bar's table
// buttons (and merge in particular) reachable.
function selectSpan(wg, from, to) {
  const selection = CellSelection.between(wg.state.doc, from, to)
  if (selection) wg.dispatch({ selection })
  else wg.dispatch({ selection: { anchor: from + 1 } })
  wg.focus()
}

function rowSpan(table, index) {
  const ranges = cellRanges(table)
  const width = table.node.content[0].content.length
  return { from: ranges[index * width].from, to: ranges[index * width + width - 1].to }
}

function columnSpan(table, index) {
  const ranges = cellRanges(table)
  const width = table.node.content[0].content.length
  const rows = table.node.content.length
  return { from: ranges[index].from, to: ranges[(rows - 1) * width + index].to }
}

// Handles drawn over a hovered table: a grip per row and per column that
// selects it, and a "+" past the last of each that grows the table.
class TableHandles {
  constructor(wg) {
    this.wg = wg
    this.table = null
    this.layer = el("div", { class: "rich-table-handles" })

    this.onMouseMove = event => this.track(event)
    this.onMouseLeave = () => this.hide()
    this.onScroll = () => this.hide()
  }

  connect(wg) {
    wg.dom.append(this.layer)
    wg.dom.addEventListener("mousemove", this.onMouseMove)
    wg.dom.addEventListener("mouseleave", this.onMouseLeave)
    wg.scrollDOM.addEventListener("scroll", this.onScroll)
  }

  disconnect(wg) {
    wg.dom.removeEventListener("mousemove", this.onMouseMove)
    wg.dom.removeEventListener("mouseleave", this.onMouseLeave)
    wg.scrollDOM.removeEventListener("scroll", this.onScroll)
    this.layer.remove()
  }

  remove(wg) {
    this.disconnect(wg)
  }

  update(update) {
    if (update.docChanged) this.hide()
  }

  hide() {
    this.layer.textContent = ""
    this.table = null
  }

  track(event) {
    if (this.layer.contains(event.target)) return
    const element = event.target.closest?.("table")
    if (!element || !this.wg.contentDOM.contains(element)) return this.hide()
    this.draw(element)
  }

  // The table's position in the document. `nodeFromDOM` throws for an element
  // the editor has replaced since, which a stale hover can hand us.
  tablePos(element) {
    try {
      const found = this.wg.nodeFromDOM(element)
      if (!found) return null
      const at = this.wg.state.doc.resolve(found.pos + 1)
      return at.matchingParent(isTable)
    } catch {
      return null
    }
  }

  draw(element) {
    const table = this.tablePos(element)
    if (!table) return this.hide()
    this.layer.textContent = ""
    this.table = element

    const host = this.wg.dom.getBoundingClientRect()
    const box = element.getBoundingClientRect()
    const rows = [...element.rows]
    const cells = [...(rows[0]?.cells ?? [])]

    const grip = (className, rect, onclick) =>
      this.layer.append(
        el("div", {
          class: `rich-table-grip ${className}`,
          role: "button",
          tabindex: "0",
          title: "Select",
          style: `top:${rect.top - host.top}px;left:${rect.left - host.left}px;width:${rect.width}px;height:${rect.height}px`,
          onmousedown: event => {
            event.preventDefault()
            onclick()
          },
        }),
      )

    const plus = (className, style, title, onclick) => {
      const button = el("button", {
        class: `rich-table-plus ${className}`,
        type: "button",
        title,
        style,
        onmousedown: event => {
          event.preventDefault()
          onclick()
          this.wg.focus()
        },
      })
      button.append(svg(`<path d="M8 3v10M3 8h10"/>`, 12))
      this.layer.append(button)
    }

    // A grip is inset by a pixel at each end so a run of them reads as one per
    // row or column rather than as a single bar down the side.
    cells.forEach((cell, index) => {
      const rect = cell.getBoundingClientRect()
      grip(
        "column",
        { top: box.top - 7, left: rect.left + 1, width: rect.width - 2, height: 5 },
        () => {
          const span = columnSpan(table, index)
          selectSpan(this.wg, span.from, span.to)
        },
      )
    })

    rows.forEach((row, index) => {
      const rect = row.getBoundingClientRect()
      grip(
        "row",
        { top: rect.top + 1, left: box.left - 7, width: 5, height: rect.height - 2 },
        () => {
          const span = rowSpan(table, index)
          selectSpan(this.wg, span.from, span.to)
        },
      )
    })

    const last = cellRanges(table)
    plus(
      "column",
      `top:${box.top - host.top}px;left:${box.right - host.left + 4}px;height:${box.height}px`,
      "Add column",
      () => runAt(this.wg, last[last.length - 1].from + 1, addColumn, "after"),
    )
    plus(
      "row",
      `top:${box.bottom - host.top + 4}px;left:${box.left - host.left}px;width:${box.width}px`,
      "Add row",
      () => runAt(this.wg, last[last.length - 1].from + 1, addRow, "after"),
    )
  }
}

export function tableEditing() {
  return [
    GardState.prec.high(KeyBinding.of({ key: "Tab", run: step(1) }).extension),
    GardState.prec.high(KeyBinding.of({ key: "Shift-Tab", run: step(-1) }).extension),
    Wordgard.Plugin.fromClass(TableHandles).extension,
  ]
}
