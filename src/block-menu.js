// The menu behind the block handle: turn this block into another type, colour
// it, duplicate it, delete it. The block types are the same `lush:block`
// plugins the slash menu offers, so a contributed type shows up in both.
import { Slice } from "wordgard/doc"
import { el } from "./dom.js"
import { icon } from "./icons.js"
import { TABLE_BLOCK_ACTIONS, tableAtPos } from "./tables.js"

function put(wg, range) {
  // Commands act on the selection, so move it into the block first.
  wg.dispatch({ selection: { anchor: range.from + 1 } })
}

export function openBlockMenu({ wg, parent, anchor, blockTypes, range, context }) {
  parent.querySelector(".lush-block-menu")?.remove()
  put(wg, range)

  const close = () => {
    menu.remove()
    document.removeEventListener("keydown", onKey, true)
    document.removeEventListener("mousedown", onOutside, true)
  }
  const onKey = event => {
    if (event.key !== "Escape") return
    event.preventDefault()
    close()
    wg.focus()
  }
  const onOutside = event => {
    if (!menu.contains(event.target)) close()
  }

  const act = run => () => {
    run()
    close()
    wg.focus()
  }

  const typeButton = block =>
    el(
      "button",
      {
        class: block.active?.(wg.state) ? "lush-block-menu-item active" : "lush-block-menu-item",
        type: "button",
        onclick: act(() => {
          // The selection may have wandered (a colour click, a click in the
          // menu); block commands act on it, so put it back in this block.
          put(wg, range)
          block.apply(wg, context)
        }),
      },
      el("span", { class: "lush-slash-icon" }, icon(block)),
      el("span", { class: "lush-slash-name" }, block.name),
    )

  const duplicate = () => {
    const node = wg.state.doc.resolve(range.from).nodeAfter
    if (node) {
      wg.dispatch({
        changes: { from: range.to, insert: Slice.of([node]) },
        userEvent: "input.duplicate",
      })
    }
  }

  const remove = () => {
    wg.dispatch({ changes: { from: range.from, to: range.to }, userEvent: "delete.block" })
  }

  const table = tableAtPos(wg.state, range.from)

  const tableButton = action =>
    el(
      "button",
      { class: "lush-block-menu-item", type: "button", onclick: act(() => action.run(wg, table)) },
      el("span", { class: "lush-slash-name" }, action.label),
    )

  const menu = el(
    "div",
    { class: "lush-block-menu" },
    el("div", { class: "lush-block-menu-group" }, "Turn into"),
    ...blockTypes.map(typeButton),
    table ? el("div", { class: "lush-block-menu-group" }, "Table") : null,
    ...(table ? TABLE_BLOCK_ACTIONS.map(tableButton) : []),
    el("div", { class: "lush-block-menu-group" }, "Block"),
    el(
      "button",
      { class: "lush-block-menu-item", type: "button", onclick: act(duplicate) },
      el("span", { class: "lush-slash-name" }, "Duplicate"),
    ),
    el(
      "button",
      { class: "lush-block-menu-item danger", type: "button", onclick: act(remove) },
      el("span", { class: "lush-slash-name" }, "Delete"),
    ),
  )

  parent.append(menu)
  const host = parent.getBoundingClientRect()
  menu.style.top = `${anchor.bottom - host.top + 4}px`
  menu.style.left = `${anchor.left - host.left}px`
  // Keep it on screen.
  const box = menu.getBoundingClientRect()
  if (box.bottom > window.innerHeight) {
    menu.style.top = `${Math.max(0, anchor.top - host.top - box.height - 4)}px`
  }

  document.addEventListener("keydown", onKey, true)
  document.addEventListener("mousedown", onOutside, true)
  return close
}
