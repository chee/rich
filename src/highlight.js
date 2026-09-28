// Highlighting a span: five named highlights, each a pairing of a background
// (an offset from the editor's own fill) and a text colour, defined for light
// and dark schemes in rich.css. The document stores the name — "pink" — so the
// look belongs to the theme, not the note.
import { Mark } from "wordgard/doc"
import { markAt, valuedMarkChanges } from "./marks.js"

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

// A name this editor doesn't know is kept (and drawn pink), so another
// editor's palette survives a save here.
export const highlightParsers = {
  fromAutomerge: value => (typeof value === "string" && value ? value : "pink"),
  fromWordgard: value => String(value),
}

// The highlight the swatches show: the caret's (one just picked included), or
// the first character's of a selection, as lush reads it.
export const highlightAt = state => markAt(state, Highlight)?.value ?? null

// Set or clear the highlight over a range.
export const highlightChanges = (doc, name, from, to) => valuedMarkChanges(doc, Highlight, name, from, to)
