import { Plot, Node, Leaf, Mark, Slice } from "wordgard/doc"

// An "atom" is a single wordgard document position: an open-plot token,
// a close-plot token, a leaf node, or a single character of text
// (carrying its marks). The index of an atom in the linearised array
// equals the wordgard document position of that atom, which lets us
// derive a minimal replacement range from a common-prefix/suffix diff.
type Atom =
  | { t: "open"; tag: Plot.Tag }
  | { t: "close" }
  | { t: "leaf"; node: Node }
  | { t: "char"; ch: string; marks: Mark.Set }

function atomsOf(doc: Plot.Doc): Atom[] {
  const atoms: Atom[] = []
  const walk = (node: Node) => {
    if (node.is(Leaf.Text)) {
      const text = node.param
      for (let i = 0; i < text.length; i++) {
        atoms.push({ t: "char", ch: text[i], marks: node.marks })
      }
    } else if (node.isLeaf) {
      atoms.push({ t: "leaf", node })
    } else {
      atoms.push({ t: "open", tag: node.tag })
      for (const c of node.content) walk(c)
      atoms.push({ t: "close" })
    }
  }
  for (const c of doc.content) walk(c)
  return atoms
}

function atomsEqual(a: Atom, b: Atom): boolean {
  if (a.t !== b.t) return false
  if (a.t === "close") return true
  if (a.t === "open" && b.t === "open") return a.tag.eq(b.tag)
  if (a.t === "leaf" && b.t === "leaf") return a.node.eq(b.node)
  if (a.t === "char" && b.t === "char")
    return a.ch === b.ch && Mark.sameSet(a.marks, b.marks)
  return false
}

/// Compute a single minimal replacement that transforms `oldDoc` into
/// `newDoc`, by trimming the common prefix and suffix. Returns `null`
/// when the documents are equal. Positions are wordgard document
/// positions.
export function diffDocs(
  oldDoc: Plot.Doc,
  newDoc: Plot.Doc,
): { from: number; to: number; slice: Slice } | null {
  const a = atomsOf(oldDoc)
  const b = atomsOf(newDoc)

  let pre = 0
  const maxPre = Math.min(a.length, b.length)
  while (pre < maxPre && atomsEqual(a[pre], b[pre])) pre++

  let suf = 0
  const maxSuf = Math.min(a.length, b.length) - pre
  while (
    suf < maxSuf &&
    atomsEqual(a[a.length - 1 - suf], b[b.length - 1 - suf])
  ) {
    suf++
  }

  const fromA = pre
  const toA = a.length - suf
  const toB = b.length - suf

  if (fromA === toA && fromA === toB) return null // no change

  const slice = newDoc.slice(fromA, toB)
  return { from: fromA, to: toA, slice }
}
