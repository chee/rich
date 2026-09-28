// Superscript and subscript are one axis, not two marks: text sits on one
// baseline. Turning either on takes the other off — which is also what the
// Swift app does (`toggleBaseline`), so a run never arrives there wearing
// both.
import { Command, toggleMark } from "wordgard/command"
import { Subscript, Superscript } from "wordgard/types"
import { markAt } from "./marks.js"

const other = mark => (mark === Superscript ? Subscript : Superscript)

// What the buttons show and the toggle reads, as lush reads it: with a caret,
// what the next character typed will wear (a baseline just picked in the
// popover included); with a selection, what its first character wears.
export const baselineAt = (state, mark) => markAt(state, mark) != null

export function toggleBaseline(wg, mark) {
  const state = wg.state
  if (state.readOnly) return false
  const on = !baselineAt(state, mark)
  if (state.selection.empty) {
    // only the marks the next typing wears change
    if (on && baselineAt(state, other(mark))) Command.dispatch(wg, toggleMark, other(mark))
    return Command.dispatch(wg, toggleMark, mark)
  }
  // One change, so one undo takes it back. Turning one on clears the other
  // over the whole selection, whatever its first character wears.
  const changes = []
  for (const { from, to } of state.selection.ranges) {
    if (on) changes.push({ from, to, remove: other(mark) }, { from, to, add: mark })
    else changes.push({ from, to, remove: mark })
  }
  wg.dispatch({ changes, userEvent: on ? "mark.add" : "mark.remove" })
  return true
}
