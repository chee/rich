// Superscript and subscript are one axis, not two marks: text sits on one
// baseline. Turning either on takes the other off — which is also what the
// Swift app does, so a run never arrives there wearing both.
import { Command, toggleMark } from "wordgard/command"
import { Subscript, Superscript } from "wordgard/types"

const other = mark => (mark === Superscript ? Subscript : Superscript)

// Read what is actually inside the selection: the marks AT a position come
// from the text before it, so a selection sitting exactly on a marked run has
// none at either end.
export const baselineAt = (state, mark) => {
  const { from, to } = state.selection
  if (from === to) return mark.isInSet(state.doc.resolve(from).marks()) != null
  let found = false
  state.doc.iterate(from, to, node => {
    found ||= mark.isInSet(node.marks) != null
  })
  return found
}

export function toggleBaseline(wg, mark) {
  const state = wg.state
  if (baselineAt(state, other(mark))) {
    if (state.selection.empty) {
      Command.dispatch(wg, toggleMark, other(mark))
    } else {
      wg.dispatch({
        changes: state.selection.ranges.map(range => ({
          from: range.from,
          to: range.to,
          remove: other(mark),
        })),
      })
    }
  }
  return Command.dispatch(wg, toggleMark, mark)
}
