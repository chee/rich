// Named colours, not raw values: the document stores `pink`, and the theme
// decides what pink is. The palette is derived from the host's
// `--studio-color-ink-*` / `--studio-color-fill-*` tokens when it has them,
// with a soft fallback set (and a dark variant) in rich.css.
import { Mark } from "wordgard/doc"

export const COLORS = [
  "default",
  "pink",
  "red",
  "orange",
  "yellow",
  "green",
  "sea",
  "sky",
  "purple",
]

const named = value => (COLORS.includes(value) ? value : "default")

// Text colour. Rendered as a class so the palette lives in CSS.
export const InkColor = Mark.Type.define("InkColor", {
  rank: 30,
  spanning: true,
  validate: "string",
  shape: { element: "span", attributes: value => ({ class: `rich-ink-${named(value)}` }) },
})

// Highlight / background colour.
export const FillColor = Mark.Type.define("FillColor", {
  rank: 35,
  spanning: true,
  validate: "string",
  shape: { element: "span", attributes: value => ({ class: `rich-fill-${named(value)}` }) },
})

export const colorParsers = {
  fromAutomerge: value => named(typeof value === "string" ? value : String(value ?? "")),
  fromWordgard: value => named(value),
}

// Apply (or clear, for "default") a colour over a document range. Removing a
// parameterised mark needs the mark itself, so collect the ones actually in
// the range first.
export function colorChanges(doc, type, color, from, to) {
  const changes = []
  const seen = new Set()
  doc.iterate(from, to, node => {
    const mark = type.isInSet(node.marks)
    if (!mark || seen.has(mark.value)) return
    seen.add(mark.value)
    changes.push({ from, to, remove: mark })
  })
  if (color !== "default") changes.push({ from, to, add: type.of(color) })
  return changes
}
