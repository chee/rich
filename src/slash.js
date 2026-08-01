// Notion-style slash commands. Typing `/` at the start of a block (or after a
// space) opens a filterable menu of block transformations.
//
// The items are `rich:slash` plugins: the built-ins below plus anything the
// host registry contributes, so a bundle can add commands to this editor
// without the tool knowing about them.
import { Dialog, KeyBinding, Tooltip } from "wordgard/editor"
import { GardState, Transaction } from "wordgard/state"
import {
  Command,
  insertText,
  setTextblockType,
  toggleList,
  wrapBlock,
} from "wordgard/command"
import {
  Blockquote,
  BulletList,
  CodeBlock,
  Heading,
  OrderedList,
  Paragraph,
} from "wordgard/types"
import { Column, Columns } from "./adapter.js"
import { insertImageUrl, uploadImage } from "./images.js"
import { openPluginsPanel } from "./plugins-panel.js"
import { el, svg } from "./dom.js"

const ICONS = {
  text: `<path d="M3 4h10M8 4v9M6 13h4"/>`,
  h1: `<path d="M3 3v10M9 3v10M3 8h6"/><path d="M11.5 7l1.5-1v7"/>`,
  h2: `<path d="M3 3v10M9 3v10M3 8h6"/><path d="M11.5 7.5a1.5 1.5 0 113 0c0 1.5-3 2-3 4.5h3"/>`,
  h3: `<path d="M3 3v10M9 3v10M3 8h6"/><path d="M11.5 6.5h3l-2 2.5a1.75 1.75 0 11-1.25 3"/>`,
  bullet: `<path d="M6 4h8M6 8h8M6 12h8"/><circle cx="3" cy="4" r=".8" fill="currentColor"/><circle cx="3" cy="8" r=".8" fill="currentColor"/><circle cx="3" cy="12" r=".8" fill="currentColor"/>`,
  ordered: `<path d="M6 4h8M6 8h8M6 12h8M2 3.5l1-.5v3M2 11h2l-2 2h2"/>`,
  quote: `<path d="M6 4H3v4h3l-1 4M13 4h-3v4h3l-1 4"/>`,
  code: `<path d="M6 4L2 8l4 4M10 4l4 4-4 4"/>`,
  image: `<rect x="2" y="3" width="12" height="10" rx="1.5"/><circle cx="6" cy="6.5" r="1"/><path d="M3 11.5l3-3 2.5 2.5 2-1.5L13 12"/>`,
  link: `<path d="M6.5 9.5l3-3M7 4.5l1-1a2.5 2.5 0 013.5 3.5l-1 1M9 11.5l-1 1a2.5 2.5 0 01-3.5-3.5l1-1"/>`,
  columns: `<rect x="2" y="3" width="5" height="10" rx="1"/><rect x="9" y="3" width="5" height="10" rx="1"/>`,
  columns3: `<rect x="1.5" y="3" width="3.5" height="10" rx="1"/><rect x="6.25" y="3" width="3.5" height="10" rx="1"/><rect x="11" y="3" width="3.5" height="10" rx="1"/>`,
  plugins: `<path d="M6 2v3M10 2v3M4 5h8v4a4 4 0 01-8 0z"/><path d="M8 13v2"/>`,
}

// A built-in icon name, raw SVG markup from a contributed command, or the
// command's initial as a last resort.
function icon(item) {
  if (ICONS[item.icon]) return svg(ICONS[item.icon])
  if (typeof item.icon === "string" && item.icon.includes("<")) return svg(item.icon)
  return item.name.slice(0, 1).toUpperCase()
}

const command = (id, name, group, icon, keywords, run) => ({
  type: "rich:slash",
  id,
  name,
  group,
  icon,
  keywords,
  tier: "core",
  run,
})

const applyBlock = (wg, blockCommand, param) =>
  Command.dispatch(wg, blockCommand, param)

export const slashCommands = [
  command("text", "Text", "Basic", "text", ["paragraph", "plain", "body"], wg =>
    applyBlock(wg, setTextblockType, Paragraph),
  ),
  command("h1", "Heading 1", "Basic", "h1", ["title", "big"], wg =>
    applyBlock(wg, setTextblockType, Heading.of(1)),
  ),
  command("h2", "Heading 2", "Basic", "h2", ["subtitle"], wg =>
    applyBlock(wg, setTextblockType, Heading.of(2)),
  ),
  command("h3", "Heading 3", "Basic", "h3", [], wg =>
    applyBlock(wg, setTextblockType, Heading.of(3)),
  ),
  command("bullet", "Bulleted list", "Basic", "bullet", ["ul", "unordered"], wg =>
    applyBlock(wg, toggleList, BulletList),
  ),
  command("ordered", "Numbered list", "Basic", "ordered", ["ol", "number"], wg =>
    applyBlock(wg, toggleList, OrderedList.of(1)),
  ),
  command("quote", "Quote", "Basic", "quote", ["blockquote", "citation"], wg =>
    applyBlock(wg, wrapBlock, Blockquote),
  ),
  command("code", "Code block", "Basic", "code", ["pre", "snippet"], wg =>
    applyBlock(wg, setTextblockType, CodeBlock),
  ),
  command("image", "Image", "Media", "image", ["picture", "photo", "upload", "file"], wg =>
    uploadImage(wg),
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
  {
    type: "rich:slash",
    id: "plugins",
    name: "Plugins",
    group: "Note",
    icon: "plugins",
    keywords: ["extensions", "features", "settings"],
    tier: "core",
    run: (wg, context) =>
      openPluginsPanel({ parent: context.element, handle: context.handle }),
  },
]

// Replace the (empty) block the cursor is in with a row of columns, and put
// the cursor in the first one.
function insertColumns(wg, count) {
  const block = wg.state.sel.head.textblockParent
  const row = Columns.create(
    Array.from({ length: count }, () => Column.create([Paragraph.create([])])),
  )
  const empty = block && block.node.contentLength === 0
  const from = empty ? block.start - 1 : (block ? block.end + 1 : wg.state.doc.contentLength)
  const to = empty ? block.end + 1 : from
  wg.dispatch({
    changes: { from, to, insert: [row] },
    // Columns open, Column open, Paragraph open.
    selection: { anchor: from + 3 },
    scrollIntoView: true,
  })
  wg.focus()
}

function insertImageFromUrl(wg) {
  const { result } = Dialog.show(wg, {
    class: "rich-dialog",
    label: "Image URL",
    input: { name: "src", type: "url", placeholder: "https://…" },
    submitLabel: "Insert",
  })
  result.then(form => {
    const src = form?.elements?.src?.value?.trim()
    if (src) insertImageUrl(wg, src)
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

function activeMenu(state, items) {
  const value = state.field(slashState, false)
  if (!value || value.closed) return null
  const matching = matchingItems(items, value.query)
  if (!matching.length) return null
  const index = ((value.index % matching.length) + matching.length) % matching.length
  return { ...value, items: matching, selected: matching[index], index }
}

function runCommand(wg, item, context) {
  const value = wg.state.field(slashState, false)
  if (!value) return false
  wg.dispatch({
    changes: { from: value.from, to: wg.state.selection.head },
    selection: { anchor: value.from },
    userEvent: "input.slash",
  })
  wg.focus()
  item.run(wg, context)
  return true
}

function menuView(getItems, context) {
  return wg => {
    const list = el("div", { class: "rich-slash" })
    let rendered = null

    function render(state) {
      const menu = activeMenu(state, getItems())
      if (!menu) {
        list.replaceChildren()
        rendered = null
        return
      }
      list.replaceChildren()
      let group = null
      for (const item of menu.items) {
        if (item.group && item.group !== group) {
          group = item.group
          list.append(el("div", { class: "rich-slash-group" }, group))
        }
        const button = el(
          "button",
          {
            class: item === menu.selected ? "rich-slash-item selected" : "rich-slash-item",
            type: "button",
            onmousedown: event => {
              event.preventDefault()
              runCommand(wg, item, context)
            },
          },
          el("span", { class: "rich-slash-icon" }, icon(item)),
          el("span", { class: "rich-slash-name" }, item.name),
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
        const menu = activeMenu(update.state, getItems())
        if (!menu || menu.selected !== rendered || update.docChanged) render(update.state)
      },
    }
  }
}

function selectedItem(wg, getItems) {
  return activeMenu(wg.state, getItems())?.selected ?? null
}

// `getItems` is called on every render so registry contributions that load
// after the editor mounted show up without a reconfigure.
export function slashMenu(getItems, context) {
  let shown = null
  const view = menuView(getItems, context)

  const move = delta => wg => {
    if (!activeMenu(wg.state, getItems())) return false
    wg.dispatch({ effects: moveSlash.of(delta) })
    return true
  }

  return [
    slashState,
    Tooltip.show.compute(state => {
      const menu = activeMenu(state, getItems())
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
          const item = selectedItem(wg, getItems)
          return item ? runCommand(wg, item, context) : false
        },
      }).extension,
      KeyBinding.of({
        key: "Tab",
        run: wg => {
          const item = selectedItem(wg, getItems)
          return item ? runCommand(wg, item, context) : false
        },
      }).extension,
      KeyBinding.of({
        key: "Escape",
        run: wg => {
          if (!activeMenu(wg.state, getItems())) return false
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
