import { Plot, Node, Leaf, Mark, Slice } from "wordgard/doc"

// An "atom" is a single wordgard document position: an open-plot token,
// a close-plot token, a leaf node, or a single character of text
// (carrying its marks). The index of an atom in the linearised array
// equals the wordgard document position of that atom, which lets us
// derive a minimal replacement range from a common-prefix/suffix diff.
export type Atom =
  | { t: "open"; tag: Plot.Tag }
  | { t: "close" }
  | { t: "leaf"; node: Node }
  | { t: "char"; ch: string; marks: Mark.Set }

export function atomsOf(doc: Plot.Doc): Atom[] {
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

/// One region where two documents differ. `from`/`to` are positions in
/// the new document, `oldFrom`/`oldTo` the corresponding positions in
/// the old one; a pure insertion has `oldFrom === oldTo`, a pure
/// deletion `from === to`.
export type Hunk = { from: number; to: number; oldFrom: number; oldTo: number }

/// Every region where `a` and `b` differ, in document order.
///
/// Like diff(1) over lines, this diffs whole top-level blocks first and
/// only then looks inside the ones that changed — a diff free to match
/// anything against anything reads terribly on prose, where every
/// paragraph ends in a full stop and begins with a capital letter. A
/// block replaced by exactly one other is reported as the character
/// range within it that differs; anything else is reported whole.
/// Sequences further apart than `maxEdits` edits are reported as one
/// hunk covering everything, which is what {@link diffDocs} would say
/// about them anyway.
export function diffAtoms(a: Atom[], b: Atom[], maxEdits = 3000): Hunk[] {
  const oldBlocks = blocksOf(a)
  const newBlocks = blocksOf(b)
  const blockHunks = myers(oldBlocks.length, newBlocks.length, maxEdits, (i, j) =>
    rangesEqual(a, oldBlocks[i], b, newBlocks[j]),
  )
  if (blockHunks == null) return whole(a, b)

  const hunks: Hunk[] = []
  for (const hunk of blockHunks) {
    // The blocks a hunk replaces are paired off in order, and each pair
    // diffed inside; whatever is left over on one side is the run of
    // blocks the draft added or took out.
    const pairs = Math.min(hunk.oldTo - hunk.oldFrom, hunk.to - hunk.from)
    for (let i = 0; i < pairs; i++) {
      const old = oldBlocks[hunk.oldFrom + i]
      const now = newBlocks[hunk.from + i]
      const inside = within(a, old, b, now, maxEdits)
      if (inside) hunks.push(...inside)
      else hunks.push({ from: now[0], to: now[1], oldFrom: old[0], oldTo: old[1] })
    }
    const old = spanOf(oldBlocks, hunk.oldFrom + pairs, hunk.oldTo, a.length)
    const now = spanOf(newBlocks, hunk.from + pairs, hunk.to, b.length)
    if (old[0] !== old[1] || now[0] !== now[1]) {
      hunks.push({ from: now[0], to: now[1], oldFrom: old[0], oldTo: old[1] })
    }
  }
  return hunks
}

/// The text a range of atoms spells out, ignoring the structure around
/// it — what a deleted range says, for showing it back to the reader.
export function atomsText(atoms: Atom[], from: number, to: number): string {
  let text = ""
  for (let i = from; i < to; i++) {
    const atom = atoms[i]
    if (atom.t === "char") text += atom.ch
  }
  return text
}

/// The parts of `from`–`to` that are content rather than the structure
/// around it. A decoration marking a range should mark the words in it,
/// not wrap the paragraphs they sit in.
export function contentRuns(
  atoms: Atom[],
  from: number,
  to: number,
): [number, number][] {
  const runs: [number, number][] = []
  let start = -1
  for (let i = from; i <= to; i++) {
    const content = i < to && atoms[i].t !== "open" && atoms[i].t !== "close"
    if (content && start < 0) start = i
    if (!content && start >= 0) {
      runs.push([start, i])
      start = -1
    }
  }
  return runs
}

type Span = [from: number, to: number]

// The top-level nodes: an open atom and everything up to its close, or
// a leaf standing on its own.
function blocksOf(atoms: Atom[]): Span[] {
  const blocks: Span[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < atoms.length; i++) {
    const atom = atoms[i]
    if (atom.t === "open") {
      if (depth === 0) start = i
      depth++
    } else if (atom.t === "close") {
      depth--
      if (depth === 0) blocks.push([start, i + 1])
    } else if (depth === 0) {
      blocks.push([i, i + 1])
    }
  }
  return blocks
}

function rangesEqual(a: Atom[], x: Span, b: Atom[], y: Span): boolean {
  if (x[1] - x[0] !== y[1] - y[0]) return false
  for (let i = 0; i < x[1] - x[0]; i++) {
    if (!atomsEqual(a[x[0] + i], b[y[0] + i])) return false
  }
  return true
}

// The atom range a run of blocks covers. An empty run is the point
// where blocks were inserted or removed.
function spanOf(blocks: Span[], from: number, to: number, end: number): Span {
  if (from === to) {
    const at = from < blocks.length ? blocks[from][0] : end
    return [at, at]
  }
  return [blocks[from][0], blocks[to - 1][1]]
}

// Where one block became another, the part inside it that changed.
// Words, not letters: a line that was rewritten has letters in common
// with the one it replaced, and picking those out of it says nothing.
function within(
  a: Atom[],
  old: Span,
  b: Atom[],
  now: Span,
  maxEdits: number,
): Hunk[] | null {
  const oldWords = wordsOf(a, old)
  const newWords = wordsOf(b, now)
  const hunks = myers(oldWords.length, newWords.length, maxEdits, (i, j) =>
    rangesEqual(a, oldWords[i], b, newWords[j]),
  )
  return (
    hunks?.map(hunk => {
      const was = spanOf(oldWords, hunk.oldFrom, hunk.oldTo, old[1])
      const is = spanOf(newWords, hunk.from, hunk.to, now[1])
      return { from: is[0], to: is[1], oldFrom: was[0], oldTo: was[1] }
    }) ?? null
  )
}

// A word runs up to and including the spaces after it, so a diff moves
// whole words. Anything that isn't text stands on its own.
function wordsOf(atoms: Atom[], span: Span): Span[] {
  const words: Span[] = []
  let start = -1
  for (let i = span[0]; i < span[1]; i++) {
    const atom = atoms[i]
    if (atom.t !== "char") {
      if (start >= 0) words.push([start, i])
      words.push([i, i + 1])
      start = -1
    } else if (atom.ch === " ") {
      words.push([start < 0 ? i : start, i + 1])
      start = -1
    } else if (start < 0) {
      start = i
    }
  }
  if (start >= 0) words.push([start, span[1]])
  return words
}

function whole(a: Atom[], b: Atom[]): Hunk[] {
  return a.length || b.length
    ? [{ from: 0, to: b.length, oldFrom: 0, oldTo: a.length }]
    : []
}

// Myers' O(ND) diff over two sequences of `n` and `m` items compared by
// `eq`: walk the edit graph one edit further per round, keeping the
// furthest-reaching path on each diagonal, until one of them reaches
// the far corner. `trace` keeps each round's frontier so the path can
// be walked back into hunks. Returns null when the sequences are more
// than `maxEdits` edits apart.
function myers(
  n: number,
  m: number,
  maxEdits: number,
  eq: (i: number, j: number) => boolean,
): Hunk[] | null {
  const max = Math.min(maxEdits, n + m)
  const off = max
  const v = new Int32Array(2 * max + 2)
  const trace: Int32Array[] = []

  for (let d = 0; d <= max; d++) {
    trace.push(v.slice())
    for (let k = -d; k <= d; k += 2) {
      const down = k === -d || (k !== d && v[off + k - 1] < v[off + k + 1])
      let x = down ? v[off + k + 1] : v[off + k - 1] + 1
      let y = x - k
      while (x < n && y < m && eq(x, y)) {
        x++
        y++
      }
      v[off + k] = x
      if (x >= n && y >= m) return walkBack(trace, off, n, m)
    }
  }
  return null
}

// Follow the trace back from the far corner, collecting each edit and
// merging edits that touch into one hunk.
function walkBack(trace: Int32Array[], off: number, n: number, m: number): Hunk[] {
  const hunks: Hunk[] = []
  let x = n
  let y = m
  for (let d = trace.length - 1; d > 0; d--) {
    const v = trace[d]
    const k = x - y
    const down = k === -d || (k !== d && v[off + k - 1] < v[off + k + 1])
    const prevX = v[off + (down ? k + 1 : k - 1)]
    const prevY = prevX - (down ? k + 1 : k - 1)
    while (x > prevX && y > prevY) {
      x--
      y--
    }
    const last = hunks[hunks.length - 1]
    if (last && last.oldFrom === x && last.from === y) {
      last.oldFrom = prevX
      last.from = prevY
    } else {
      hunks.push({ from: prevY, to: y, oldFrom: prevX, oldTo: x })
    }
    x = prevX
    y = prevY
  }
  return hunks.reverse()
}
