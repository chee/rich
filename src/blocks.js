// Notion-style block handles: hovering a block reveals a gutter with a "+"
// (insert a block below and open the slash menu) and a grip that reorders
// blocks by dragging. Blocks inside a column get handles too, and can be
// dragged between columns.
import { Wordgard } from "wordgard/editor"
import { Slice } from "wordgard/doc"
import { Paragraph } from "wordgard/types"
import { Column, Columns } from "./adapter.js"
import { el, svg } from "./dom.js"
import { openBlockMenu } from "./block-menu.js"
import { openSlashAt } from "./slash.js"

const DRAG_TYPE = "text/x-lush-block"
// How far left of a block the pointer still counts as "on" it, so the gutter
// is reachable without the hover being lost in the gap.
const GUTTER_REACH = 60
// Dropping within this much of a block's left or right edge puts the two
// side by side instead of stacking them.
const SIDE_ZONE = 0.25
const MAX_SIDE_ZONE = 140

// The containers whose children get handles: the document itself and any
// column.
function containers(wg) {
  return [wg.contentDOM, ...wg.contentDOM.querySelectorAll(".lush-column")]
}

function blockCandidates(wg) {
  const out = []
  for (const container of containers(wg)) {
    for (const element of container.children) out.push({ element, container })
  }
  return out
}

// The block under (or beside) the pointer. Innermost wins, so a paragraph in a
// column beats the columns row that holds it.
function blockAtPointer(wg, event) {
  let best = null
  for (const candidate of blockCandidates(wg)) {
    const rect = candidate.element.getBoundingClientRect()
    if (event.clientY < rect.top || event.clientY > rect.bottom) continue
    if (event.clientX < rect.left - GUTTER_REACH || event.clientX > rect.right) continue
    if (!best || rect.width < best.rect.width) best = { ...candidate, rect }
  }
  return best
}

// A block's position in the document. `nodeFromDOM` gives the position before
// the node — but the node it hands back is the one that element was built
// from, which an edit may have left behind, so read the live one at that
// position. It throws for an element the editor has since replaced.
function blockPos(wg, element) {
  try {
    const found = wg.nodeFromDOM(element)
    return found ? found.pos : null
  } catch {
    return null
  }
}

function blockRange(wg, element) {
  const pos = blockPos(wg, element)
  if (pos == null) return null
  const node = wg.state.doc.resolve(pos).nodeAfter
  return node && { from: pos, to: pos + node.length, node }
}

// Where a container's content starts and ends, for dropping at either edge.
function containerRange(wg, container) {
  if (container === wg.contentDOM) return { start: 0, end: wg.state.doc.contentLength }
  const range = blockRange(wg, container)
  return range && { start: range.from + 1, end: range.to - 1 }
}

class BlockGutter {
  constructor(wg, context) {
    this.wg = wg
    this.context = context
    // The last pointer position over content. The block is looked up from it
    // on demand rather than remembered, because an edit can replace the
    // element the gutter was pointing at.
    this.point = null
    this.dragging = null

    this.add = el("button", {
      class: "lush-gutter-button",
      type: "button",
      title: "Insert block below",
      onclick: () => this.insertBelow(),
    })
    this.add.append(svg(`<path d="M8 3v10M3 8h10"/>`, 14))

    // A <div>, not a <button>: browsers don't start native drags from form
    // controls, so a draggable button silently does nothing.
    this.grip = el("div", {
      class: "lush-gutter-button lush-gutter-grip",
      role: "button",
      tabindex: "0",
      title: "Click for block options, drag to move",
      draggable: "true",
      onclick: () => this.openMenu(),
    })
    this.grip.append(
      svg(
        `<circle cx="6" cy="4" r="1"/><circle cx="10" cy="4" r="1"/><circle cx="6" cy="8" r="1"/><circle cx="10" cy="8" r="1"/><circle cx="6" cy="12" r="1"/><circle cx="10" cy="12" r="1"/>`,
        14,
      ),
    )
    this.grip.addEventListener("dragstart", event => this.dragStart(event))
    this.grip.addEventListener("dragend", () => this.dragEnd())

    this.gutter = el("div", { class: "lush-gutter" }, this.add, this.grip)
    this.indicator = el("div", { class: "lush-drop-indicator" })

    this.onMouseMove = event => this.trackPointer(event)
    this.onMouseLeave = () => this.hide()
    this.onDragOver = event => this.dragOver(event)
    this.onDrop = event => this.drop(event)
    this.onScroll = () => this.hide()
  }

  connect(wg) {
    wg.dom.append(this.gutter, this.indicator)
    wg.dom.addEventListener("mousemove", this.onMouseMove)
    wg.dom.addEventListener("mouseleave", this.onMouseLeave)
    wg.dom.addEventListener("dragover", this.onDragOver)
    wg.dom.addEventListener("drop", this.onDrop)
    wg.scrollDOM.addEventListener("scroll", this.onScroll)
  }

  disconnect(wg) {
    wg.dom.removeEventListener("mousemove", this.onMouseMove)
    wg.dom.removeEventListener("mouseleave", this.onMouseLeave)
    wg.dom.removeEventListener("dragover", this.onDragOver)
    wg.dom.removeEventListener("drop", this.onDrop)
    wg.scrollDOM.removeEventListener("scroll", this.onScroll)
    this.gutter.remove()
    this.indicator.remove()
  }

  remove(wg) {
    this.disconnect(wg)
  }

  update(update) {
    if (update.docChanged) this.hide()
  }

  hide() {
    this.gutter.classList.remove("visible")
    this.point = null
  }

  // The block the gutter is currently pointing at, resolved fresh.
  hovered() {
    return this.point && blockAtPointer(this.wg, this.point)
  }

  trackPointer(event) {
    if (this.dragging != null) return
    // Moving onto the gutter itself must not count as leaving the block.
    if (this.gutter.contains(event.target)) return
    const point = { clientX: event.clientX, clientY: event.clientY }
    const found = blockAtPointer(this.wg, point)
    if (!found) return this.hide()
    this.point = point
    const host = this.wg.dom.getBoundingClientRect()
    this.gutter.style.top = `${found.rect.top - host.top}px`
    this.gutter.style.left = `${found.rect.left - host.left}px`
    this.gutter.classList.add("visible")
  }

  // Clicking the grip (as opposed to dragging it) opens the block's menu.
  openMenu() {
    const found = this.hovered()
    const range = found && blockRange(this.wg, found.element)
    if (!range) return
    openBlockMenu({
      wg: this.wg,
      parent: this.wg.dom,
      anchor: this.gutter.getBoundingClientRect(),
      blockTypes: this.context.blockTypes(),
      range,
      context: this.context,
    })
  }

  insertBelow() {
    const found = this.hovered()
    const range = found && blockRange(this.wg, found.element)
    if (!range) return
    this.wg.dispatch({
      changes: { from: range.to, insert: [Paragraph.create([])] },
      selection: { anchor: range.to + 1 },
      scrollIntoView: true,
    })
    openSlashAt(this.wg, this.wg.state.selection.head)
  }

  dragStart(event) {
    const found = this.hovered()
    const range = found && blockRange(this.wg, found.element)
    if (!range || !event.dataTransfer) return
    // Taking the last block out of a column would leave it empty, which the
    // schema (and the Automerge encoding) don't allow — it gets an empty
    // paragraph in exchange.
    const emptied =
      found.container !== this.wg.contentDOM && found.container.children.length === 1
    this.dragging = { ...range, emptied }
    event.dataTransfer.effectAllowed = "move"
    event.dataTransfer.setData(DRAG_TYPE, "block")
    event.dataTransfer.setDragImage(found.element, 12, 12)
    this.wg.dom.classList.add("lush-dragging")
  }

  dragEnd() {
    this.dragging = null
    this.indicator.classList.remove("visible")
    this.wg.dom.classList.remove("lush-dragging")
    this.hide()
  }

  // Where a drop at this pointer position would land: which container, above
  // which of its children, and the document position that implies.
  dropTarget(event) {
    let best = null
    for (const container of containers(this.wg)) {
      const rect = container.getBoundingClientRect()
      if (event.clientX < rect.left - GUTTER_REACH || event.clientX > rect.right) continue
      if (event.clientY < rect.top || event.clientY > rect.bottom) continue
      if (!best || rect.width < best.rect.width) best = { container, rect }
    }
    const container = best?.container ?? this.wg.contentDOM
    const range = containerRange(this.wg, container)
    if (!range) return null
    const children = [...container.children]
    // Dropping into a container holding nothing but an empty paragraph
    // replaces it, rather than leaving a blank line above the block.
    if (container !== this.wg.contentDOM && children.length === 1) {
      const only = blockRange(this.wg, children[0])
      if (only && only.node.isTextblock && only.node.contentLength === 0) {
        return {
          pos: only.from,
          replace: only,
          rect: children[0].getBoundingClientRect(),
          edge: "top",
        }
      }
    }
    // Near a block's left or right edge: offer to put the two side by side.
    for (const child of children) {
      const rect = child.getBoundingClientRect()
      if (event.clientY < rect.top || event.clientY > rect.bottom) continue
      const zone = Math.min(rect.width * SIDE_ZONE, MAX_SIDE_ZONE)
      const side =
        event.clientX < rect.left + zone
          ? "left"
          : event.clientX > rect.right - zone
            ? "right"
            : null
      if (!side) continue
      const at = blockRange(this.wg, child)
      if (!at) continue
      return { pos: at.from, beside: at, container, side, rect, edge: side }
    }
    for (const child of children) {
      const rect = child.getBoundingClientRect()
      if (event.clientY < rect.top + rect.height / 2) {
        const at = blockRange(this.wg, child)
        return at && { pos: at.from, rect, edge: "top" }
      }
    }
    const last = children[children.length - 1]
    return {
      pos: range.end,
      rect: last ? last.getBoundingClientRect() : container.getBoundingClientRect(),
      edge: "bottom",
    }
  }

  dragOver(event) {
    if (this.dragging == null) return
    event.preventDefault()
    event.dataTransfer.dropEffect = "move"
    const target = this.dropTarget(event)
    if (!target) return
    const host = this.wg.dom.getBoundingClientRect()
    const beside = Boolean(target.beside)
    this.indicator.classList.toggle("vertical", beside)
    if (beside) {
      this.indicator.style.top = `${target.rect.top - host.top}px`
      this.indicator.style.left = `${(target.side === "left" ? target.rect.left : target.rect.right) - host.left}px`
      this.indicator.style.width = ""
      this.indicator.style.height = `${target.rect.height}px`
    } else {
      this.indicator.style.top = `${(target.edge === "top" ? target.rect.top : target.rect.bottom) - host.top}px`
      this.indicator.style.left = `${target.rect.left - host.left}px`
      this.indicator.style.width = `${target.rect.width}px`
      this.indicator.style.height = ""
    }
    this.indicator.classList.add("visible")
  }

  drop(event) {
    if (this.dragging == null) return
    event.preventDefault()
    const source = this.dragging
    const target = this.dropTarget(event)
    this.dragEnd()
    // Dropping a block inside itself, or where it already is, is a no-op.
    if (!target) return
    if (target.pos >= source.from && target.pos <= source.to) return
    if (target.beside) return this.dropBeside(source, target)
    this.wg.dispatch({
      changes: [
        {
          from: source.from,
          to: source.to,
          insert: source.emptied ? [Paragraph.create([])] : undefined,
        },
        {
          from: target.pos,
          to: target.replace ? target.replace.to : undefined,
          insert: Slice.of([source.node]),
        },
      ],
      userEvent: "move.block",
    })
  }
  // Side-by-side: either a new column next to the target's own column, or a
  // fresh two-column row made from the target and the dragged block.
  dropBeside(source, target) {
    const column = Column.create([source.node])
    const inColumn = target.container.classList?.contains("lush-column")
    const replaced = inColumn ? blockRange(this.wg, target.container) : target.beside
    if (!replaced) return

    const insert = inColumn
      ? { from: target.side === "left" ? replaced.from : replaced.to, insert: [column] }
      : {
          from: replaced.from,
          to: replaced.to,
          insert: [
            Columns.create(
              target.side === "left"
                ? [column, Column.create([replaced.node])]
                : [Column.create([replaced.node]), column],
            ),
          ],
        }

    this.wg.dispatch({
      changes: [
        {
          from: source.from,
          to: source.to,
          insert: source.emptied ? [Paragraph.create([])] : undefined,
        },
        insert,
      ],
      userEvent: "move.block",
    })
  }
}

export function blockGutter(context) {
  return Wordgard.Plugin.define(wg => new BlockGutter(wg, context)).extension
}
