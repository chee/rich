// Marks a block doesn't keep: bold in a heading (headings are bold already)
// and inline code in a code block (it is all code). They are never written to
// automerge (SchemaAdapter.excludedMarks), and lush drops them on its next
// save. The editor drops them too, as soon as a line becomes a heading or a
// code block, so what it shows is what a fresh editor on the same note shows,
// and turning the line back into Body doesn't bring them back.
//
// The same goes for an indent on a list item's or a quote's first line: that
// line is the list item's or the quote's own marker, and a list item nests
// rather than indents, so an indent there is never written (a quote's indent
// rides on the quote itself).
import { Leaf } from "wordgard/doc"
import { Transaction } from "wordgard/state"
import { Blockquote, Code, ListItem, Paragraph, Strong } from "wordgard/types"
import { Indent } from "./adapter.js"

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
    doc.iterate(from, to, (node, pos, parent, index) => {
      if (
        node.type === Paragraph.type &&
        index === 0 &&
        (parent?.type === ListItem.type || parent?.type === Blockquote.type) &&
        !seen.has(pos)
      ) {
        const indent = Indent.isInSet(node.tag.marks)
        if (indent) {
          seen.add(pos)
          changes.push({ from: pos, remove: indent })
        }
      }
      if (!node.is(Leaf.Text) || seen.has(pos)) return
      const mark = excludedIn(parent)
      if (!mark || !mark.isInSet(node.marks)) return
      seen.add(pos)
      changes.push({ from: pos, to: pos + node.length, remove: mark.isInSet(node.marks) })
    })
  }
  return changes.length ? { changes } : null
})
