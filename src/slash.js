// Notion-style slash menu. Typing `/` at the start of a block (or after a
// space) opens a filterable menu.
//
// It shows two kinds of thing, kept apart: the `lush:block` block types the
// current block can be turned into, and `lush:slash` commands, which insert or
// do something. Both kinds are plugins — the built-ins here plus anything the
// host registry contributes — so a bundle can add either.
import { Dialog, KeyBinding, Tooltip } from "wordgard/editor"
import { GardState, Transaction } from "wordgard/state"
import { Command, insertText } from "wordgard/command"
import { Cell, CodeBlock, HeaderCell, Paragraph, Table, TableRow } from "wordgard/types"
import { Column, Columns } from "./adapter.js"
import { el } from "./dom.js"
import { icon } from "./icons.js"

// Both of these run only when a command does, so they arrive as their own
// chunks rather than riding in with the menu.
const images = () => import("./images.js")
const pluginsPanel = () => import("./plugins-panel.js")

const command = (id, name, group, icon, keywords, run) => ({
  type: "lush:slash",
  id,
  name,
  group,
  icon,
  keywords,
  tier: "core",
  run,
})

export const slashCommands = [
  command("image", "Image", "Media", "image", ["picture", "photo", "upload", "file"], async wg =>
    (await images()).uploadImage(wg),
  ),
  command(
    "image-url",
    "Image from URL",
    "Media",
    "link",
    ["picture", "web", "link"],
    insertImageFromUrl,
  ),
  command("columns", "2 columns", "Layout", "columns", ["side", "split", "row"], wg =>
    insertColumns(wg, 2),
  ),
  command("columns-3", "3 columns", "Layout", "columns3", ["side", "split", "row"], wg =>
    insertColumns(wg, 3),
  ),
  command("table", "Table", "Layout", "table", ["grid", "rows", "cells"], wg =>
    insertTable(wg, 3, 3),
  ),
  {
    type: "lush:slash",
    id: "plugins",
    name: "Plugins",
    group: "Note",
    icon: "plugins",
    keywords: ["extensions", "features", "settings"],
    tier: "core",
    run: (wg, context) =>
      pluginsPanel().then(panel =>
        panel.openPluginsPanel({ parent: context.element, handle: context.handle }),
      ),
  },
]

// Where a new block goes: replacing the block the cursor is in when it is
// empty, otherwise straight after it.
function replacementRange(wg) {
  const block = wg.state.sel.head.textblockParent
  if (!block) {
    const end = wg.state.doc.contentLength
    return { from: end, to: end }
  }
  if (block.node.contentLength === 0) return { from: block.start - 1, to: block.end + 1 }
  return { from: block.end + 1, to: block.end + 1 }
}

// Replace the (empty) block the cursor is in with a row of columns, and put
// the cursor in the first one.
function insertColumns(wg, count) {
  const row = Columns.create(
    Array.from({ length: count }, () => Column.create([Paragraph.create([])])),
  )
  const at = replacementRange(wg)
  wg.dispatch({
    changes: { from: at.from, to: at.to, insert: [row] },
    // Columns open, Column open, Paragraph open.
    selection: { anchor: at.from + 3 },
    scrollIntoView: true,
  })
  wg.focus()
}

// A table with a header row, cursor in the first header cell.
function insertTable(wg, rows, columns) {
  const cells = (tag, count) => Array.from({ length: count }, () => tag.create([]))
  const table = Table.create([
    TableRow.create(cells(HeaderCell, columns)),
    ...Array.from({ length: rows - 1 }, () => TableRow.create(cells(Cell, columns))),
  ])
  const at = replacementRange(wg)
  wg.dispatch({
    changes: { from: at.from, to: at.to, insert: [table] },
    // Table open, TableRow open, HeaderCell open.
    selection: { anchor: at.from + 3 },
    scrollIntoView: true,
  })
  wg.focus()
}

function insertImageFromUrl(wg) {
  const { result } = Dialog.show(wg, {
    class: "lush-dialog",
    label: "Image URL",
    input: { name: "src", type: "url", placeholder: "https://…" },
    submitLabel: "Insert",
  })
  result.then(async form => {
    const src = form?.elements?.src?.value?.trim()
    if (src) (await images()).insertImageUrl(wg, src)
  })
}

// The `/query` run that ends at the cursor, if any. Positions are computed
// backwards from the cursor so inline leaves earlier in the block can't skew
// them.
function slashAt(doc, selection) {
  if (!selection.empty) return null
  const head = doc.resolve(selection.head)
  const block = head.textblockParent
  if (!block || block.node.tag === CodeBlock) return null
  const before = block.node.textContent({ from: 0, to: selection.head - block.start })
  const match = /(?:^|\s)\/([^\s/]*)$/.exec(before)
  if (!match) return null
  return { from: selection.head - match[1].length - 1, query: match[1] }
}

const closeSlash = Transaction.Effect.define()
const moveSlash = Transaction.Effect.define()

const slashState = GardState.Field.define({
  create: state => slashAt(state.doc, state.selection),
  update(value, tr) {
    const active = slashAt(tr.newDoc, tr.newSelection)
    if (!active) return null
    if (tr.effects.some(effect => effect.is(closeSlash))) {
      return { ...active, index: 0, closed: true }
    }
    const same = value && value.from === active.from
    // Dismissal sticks until the user leaves this `/` run.
    if (same && value.closed) return { ...active, index: 0, closed: true }
    const index = same && value.query === active.query ? value.index : 0
    const move = tr.effects.find(effect => effect.is(moveSlash))
    return { ...active, index: move ? index + move.value : index, closed: false }
  },
})

function matchingItems(items, query) {
  const needle = query.toLowerCase()
  if (!needle) return items
  return items.filter(item =>
    [item.name, item.id, ...(item.keywords || [])].some(term =>
      String(term).toLowerCase().includes(needle),
    ),
  )
}

// Block types first (turning this block into something), then commands, each
// under its own heading.
function menuItems(context) {
  const blocks = context.blockTypes().map(block => ({ ...block, group: "Turn into" }))
  return [...blocks, ...context.slashCommands()]
}

function activeMenu(state, context) {
  const value = state.field(slashState, false)
  if (!value || value.closed) return null
  const matching = matchingItems(menuItems(context), value.query)
  if (!matching.length) return null
  const index = ((value.index % matching.length) + matching.length) % matching.length
  return { ...value, items: matching, selected: matching[index], index }
}

// Both kinds run the same way: drop the `/query` text, then act. A block type
// applies itself to the block the cursor is in; a command does its thing.
function runItem(wg, item, context) {
  const value = wg.state.field(slashState, false)
  if (!value) return false
  wg.dispatch({
    changes: { from: value.from, to: wg.state.selection.head },
    selection: { anchor: value.from },
    userEvent: "input.slash",
  })
  wg.focus()
  if (item.type === "lush:block") item.apply(wg, context)
  else item.run(wg, context)
  return true
}

function menuView(context) {
  return wg => {
    const list = el("div", { class: "lush-slash" })
    let rendered = null

    function render(state) {
      const menu = activeMenu(state, context)
      if (!menu) {
        list.replaceChildren()
        rendered = null
        return
      }
      list.replaceChildren()
      let group = null
      for (const item of menu.items) {
        const heading = item.group || "Commands"
        if (heading !== group) {
          group = heading
          list.append(el("div", { class: "lush-slash-group" }, group))
        }
        const button = el(
          "button",
          {
            class: [
              "lush-slash-item",
              item.type === "lush:block" ? "block" : "command",
              item === menu.selected ? "selected" : "",
            ]
              .filter(Boolean)
              .join(" "),
            type: "button",
            onmousedown: event => {
              event.preventDefault()
              runItem(wg, item, context)
            },
          },
          el("span", { class: "lush-slash-icon" }, icon(item)),
          el("span", { class: "lush-slash-name" }, item.name),
          item.type === "lush:block"
            ? null
            : el("span", { class: "lush-slash-kind" }, "command"),
        )
        list.append(button)
      }
      rendered = menu.selected
      list.querySelector(".selected")?.scrollIntoView({ block: "nearest" })
    }

    render(wg.state)
    return {
      dom: list,
      update(update) {
        const menu = activeMenu(update.state, context)
        if (!menu || menu.selected !== rendered || update.docChanged) render(update.state)
      },
    }
  }
}

function selectedItem(wg, context) {
  return activeMenu(wg.state, context)?.selected ?? null
}

// The context's plugin lists are read on every render, so contributions that
// load after the editor mounted show up without a reconfigure.
export function slashMenu(context) {
  let shown = null
  const view = menuView(context)

  const move = delta => wg => {
    if (!activeMenu(wg.state, context)) return false
    wg.dispatch({ effects: moveSlash.of(delta) })
    return true
  }

  return [
    slashState,
    Tooltip.show.compute(state => {
      const menu = activeMenu(state, context)
      if (!menu) return (shown = null)
      if (shown?.pos !== menu.from) {
        shown = { pos: menu.from, above: false, clip: true, create: view }
      }
      return shown
    }),
    GardState.prec.highest([
      KeyBinding.of({ key: "ArrowDown", run: move(1) }).extension,
      KeyBinding.of({ key: "ArrowUp", run: move(-1) }).extension,
      KeyBinding.of({
        key: "Enter",
        run: wg => {
          const item = selectedItem(wg, context)
          return item ? runItem(wg, item, context) : false
        },
      }).extension,
      KeyBinding.of({
        key: "Tab",
        run: wg => {
          const item = selectedItem(wg, context)
          return item ? runItem(wg, item, context) : false
        },
      }).extension,
      KeyBinding.of({
        key: "Escape",
        run: wg => {
          if (!activeMenu(wg.state, context)) return false
          wg.dispatch({ effects: closeSlash.of(null) })
          return true
        },
      }).extension,
    ]),
  ]
}

// Used by the block gutter's "+" button: start a fresh block already in
// slash-menu mode, the way Notion does.
export function openSlashAt(wg, pos) {
  Command.dispatch(wg, insertText, {
    from: pos,
    to: pos,
    insert: "/",
    userEvent: "input.type",
  })
  wg.focus()
}
