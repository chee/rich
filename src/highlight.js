// Highlighting a span: five named highlights, each a pairing of a background
// (an offset from the editor's own fill) and a text colour, defined for light
// and dark schemes in rich.css. The document stores the name — "pink" — so the
// look belongs to the theme, not the note.
import { Mark } from "wordgard/doc"

export const HIGHLIGHTS = ["pink", "yellow", "sky", "sea", "mint"]

const named = value => (HIGHLIGHTS.includes(value) ? value : null)

export const Highlight = Mark.Type.define("Highlight", {
  rank: 30,
  spanning: true,
  validate: "string",
  shape: {
    element: "span",
    attributes: value => ({ class: `rich-highlight rich-highlight-${named(value) ?? "pink"}` }),
  },
})

export const highlightParsers = {
  fromAutomerge: value => named(typeof value === "string" ? value : "") ?? "pink",
  fromWordgard: value => named(value) ?? "pink",
}

export const highlightAt = state => {
  const { from, to } = state.selection
  const marks = state.doc.resolve(from).marks(from === to ? undefined : state.doc.resolve(to))
  return Highlight.isInSet(marks)?.value ?? null
}

// Set or clear the highlight over a range. Clearing needs the marks that are
// actually there, since a parameterised mark is removed by value.
export function highlightChanges(doc, name, from, to) {
  const changes = []
  const seen = new Set()
  doc.iterate(from, to, node => {
    const mark = Highlight.isInSet(node.marks)
    if (!mark || seen.has(mark.value)) return
    seen.add(mark.value)
    changes.push({ from, to, remove: mark })
  })
  if (name) changes.push({ from, to, add: Highlight.of(name) })
  return changes
}
