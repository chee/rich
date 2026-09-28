// Lush's sheets: a card over the dimmed note, with a title, its fields and a
// row of buttons — the Link sheet, Logline…, an HTML block's source and New
// Patchwork Document. Escape, or a click on the note around the card, is
// Cancel.
import { el } from "./dom.js"

// Put `card` (usually a form) up as a sheet over `parent`, the tool's element.
// `onCancel` runs when it is dismissed rather than submitted. Returns
// `close()`, which takes it down without cancelling.
export function openSheet(parent, { label, className = "", card, onCancel }) {
  // one sheet at a time
  for (const open of parent.querySelectorAll(":scope > .rich-sheet")) open.richCancel?.()
  const sheet = el(
    "div",
    {
      class: `rich-sheet ${className}`.trim(),
      role: "dialog",
      "aria-modal": "true",
      "aria-label": label,
      onmousedown: event => {
        if (event.target !== sheet) return
        event.preventDefault()
        cancel()
      },
    },
    card,
  )
  const onKey = event => {
    if (event.key !== "Escape") return
    event.preventDefault()
    event.stopPropagation()
    cancel()
  }
  function close() {
    document.removeEventListener("keydown", onKey, true)
    sheet.remove()
  }
  function cancel() {
    close()
    onCancel?.()
  }
  sheet.richCancel = cancel
  document.addEventListener("keydown", onKey, true)
  parent.append(sheet)
  return { sheet, close, cancel }
}

// The row along the bottom: whatever goes on the left, a spacer, then the
// rest (Cancel, and the prominent button last).
export const sheetButtons = (left, right) =>
  el("div", { class: "rich-sheet-buttons" }, ...[].concat(left ?? []), el("span", { class: "rich-sheet-spacer" }), ...right)

export const sheetButton = (label, onclick, { prominent = false, type = "button", disabled = false } = {}) =>
  el("button", { class: `rich-button${prominent ? " prominent" : ""}`, type, disabled, onclick }, label)
