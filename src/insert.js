// Putting blocks into the note, the way lush's `insertBlockAttachment` does:
// after the line the caret is in, so no line is ever split around a block,
// and with the caret on a line of its own after the block, so typing carries
// on below it and the next block goes after this one. An empty line is
// replaced rather than left above the block, and an empty line already after
// the block is where the caret goes.
import { ChangeSet } from "wordgard/doc"
import { Paragraph } from "wordgard/types"

export function insertBlocks(wg, nodes) {
  const { state } = wg
  const { doc, selection } = state
  const block = doc.resolve(selection.to).textblockParent
  let from
  let to
  if (block && block.node.contentLength === 0 && selection.empty) {
    from = block.before
    to = block.after
  } else if (block) {
    from = to = block.after
  } else {
    from = to = Math.min(selection.to, doc.contentLength)
  }
  const insert = ChangeSet.create(doc, { from, to, insert: nodes, fit: true })
  const inserted = insert.apply(doc)
  const end = insert.mapPos(to, 1)
  const next = inserted.resolve(end).nodeAfter
  let changes = insert
  let caret
  if (next && next.type === Paragraph.type && next.contentLength === 0) {
    caret = end + 1
  } else {
    const line = ChangeSet.create(inserted, { from: end, insert: [Paragraph.create([])], fit: true })
    changes = insert.compose(line)
    caret = (line.findInserted(tag => tag.type === Paragraph.type) ?? end) + 1
  }
  wg.dispatch({
    changes,
    selection: { anchor: caret },
    scrollIntoView: true,
    userEvent: "input.insert",
  })
  wg.focus()
}
