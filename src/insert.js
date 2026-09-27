// Putting blocks into the note where the caret is, the way lush does: an
// empty line is replaced, a caret at the end of a line puts the block after
// it, and a caret mid-line splits the line around it.
export function insertBlocks(wg, nodes, { select = "after" } = {}) {
  const state = wg.state
  const block = state.sel.head.textblockParent
  let from = state.selection.from
  let to = state.selection.to
  if (block && block.node.contentLength === 0 && state.selection.empty) {
    from = block.before
    to = block.after
  } else if (block && state.selection.empty && state.selection.head === block.end) {
    from = to = block.after
  } else if (!block) {
    from = to = Math.min(state.selection.head, state.doc.contentLength)
  }
  wg.dispatch({
    changes: { from, to, insert: nodes, fit: true },
    ...(select === "inside" ? { selection: { anchor: from + 3 } } : {}),
    scrollIntoView: true,
    userEvent: "input.insert",
  })
  wg.focus()
}
