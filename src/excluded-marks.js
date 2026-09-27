// Marks a block doesn't keep: bold in a heading (headings are bold already)
// and inline code in a code block (it is all code). They are never written to
// automerge (SchemaAdapter.excludedMarks), and lush drops them on its next
// save. The editor drops them too, as soon as a line becomes a heading or a
// code block, so what it shows is what a fresh editor on the same note shows,
// and turning the line back into Body doesn't bring them back.
import { Leaf } from "wordgard/doc"
import { Transaction } from "wordgard/state"
import { Code, Strong } from "wordgard/types"

const excludedIn = parent => {
  const name = parent?.type?.name
  const mark = name === "Heading" ? Strong : name === "CodeBlock" ? Code : null
  return mark && (mark.type ?? mark)
}

// Where the local transactions changed the document, in its final positions.
function changedRanges(trs) {
  let ranges = []
  for (const tr of trs) {
    if (!tr.docChanged) continue
    ranges = ranges.map(([from, to]) => [tr.changes.mapPos(from, -1), tr.changes.mapPos(to, 1)])
    if (tr.annotation(Transaction.remote)) continue
    tr.changes.iterChangedRanges((_fromA, _toA, fromB, toB) => ranges.push([fromB, toB]))
  }
  return ranges
}

export const dropExcludedMarks = Transaction.appender.of((trs, state) => {
  const ranges = changedRanges(trs)
  if (!ranges.length) return null
  const doc = state.doc
  const changes = []
  const seen = new Set()
  for (let [from, to] of ranges) {
    // the whole of every textblock the change touched
    from = Math.max(0, Math.min(from, doc.contentLength))
    to = Math.max(from, Math.min(to, doc.contentLength))
    from = doc.resolve(from).textblockParent?.before ?? from
    to = doc.resolve(to).textblockParent?.after ?? to
    doc.iterate(from, to, (node, pos, parent) => {
      if (!node.is(Leaf.Text) || seen.has(pos)) return
      const mark = excludedIn(parent)
      if (!mark || !mark.isInSet(node.marks)) return
      seen.add(pos)
      changes.push({ from: pos, to: pos + node.length, remove: mark.isInSet(node.marks) })
    })
  }
  return changes.length ? { changes } : null
})
