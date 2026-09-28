// Tab nests the list lines the selection touches one list deeper, Shift-Tab
// takes them one back out — lush's `adjustListNesting`: each line's own depth
// changes, and the lines around it stay where they are (see block-style.js).
import { KeyBinding } from "wordgard/editor"
import { indentLines } from "./block-style.js"

export const nestListItems = (wg, direction) => indentLines(wg, direction, { listsOnly: true })

export function listIndent() {
  return [
    KeyBinding.of({ key: "Tab", run: wg => nestListItems(wg, 1) }).extension,
    KeyBinding.of({ key: "Shift-Tab", run: wg => nestListItems(wg, -1) }).extension,
  ]
}
