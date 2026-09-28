// Marks that carry a value — a highlight's name, a font, a link's URL — and
// what the format controls read off the selection.

// What a control shows for a mark, read the way lush reads it: with a caret,
// what the next character typed will wear (a mark just picked in the popover
// included); with a selection, what its first character wears, so a word
// selected exactly shows its own marks and a click does what the control
// shows.
export function markAt(state, type) {
  const { from, to } = state.selection
  if (from === to) return type.isInSet(state.sel.activeMarks) ?? null
  let found
  state.doc.iterate(from, to, (node, pos) => {
    if (found !== undefined || !node.isText || pos + node.length <= from) return
    found = type.isInSet(node.marks) ?? null
  })
  return found ?? null
}

// Set a valued mark over a range, or clear it (`value` null or ""). Setting is
// a single `add`: wordgard's add already replaces another value of the same
// mark, and leaves text that has this value alone. Removing and adding in one
// change doesn't do it — where the text already had the value, the add was
// dropped and the remove kept, so re-applying a link took it off. Clearing
// needs each value that is there, since a mark with a value is removed by
// value.
export function valuedMarkChanges(doc, type, value, from, to) {
  if (value != null && value !== "") return [{ from, to, add: type.of(value) }]
  const changes = []
  const seen = new Set()
  doc.iterate(from, to, node => {
    const mark = type.isInSet(node.marks)
    if (!mark || seen.has(mark.value)) return
    seen.add(mark.value)
    changes.push({ from, to, remove: mark })
  })
  return changes
}
