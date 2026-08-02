import * as am from "@automerge/automerge"
import { spansFromDoc } from "./wordgard/index.js"
import { Paragraph } from "wordgard/types"
import { lushAdapter } from "./adapter.js"
import { builtinFullIds } from "./plugin-catalog.js"

// The document model: a `content` rich-text field (edited via
// @automerge/wordgard) plus an optional `title`.
export const LushDatatype = {
  init(doc) {
    doc.title = ""
    doc.content = ""
    // The enabled full-tier plugin ids. Core-tier plugins are always on; the
    // `/plugins` command edits this array.
    doc.plugins = builtinFullIds()
    // Seed a single empty paragraph so every peer starts from the same
    // block structure (avoids two peers concurrently creating a first
    // paragraph).
    const seed = lushAdapter.schema.doc([Paragraph.create([])])
    am.updateSpans(
      doc,
      ["content"],
      spansFromDoc(lushAdapter, seed),
      lushAdapter.updateSpansConfig(),
    )
  },

  getTitle(doc) {
    if (doc.title) return doc.title
    try {
      const spans = am.spans(doc, ["content"])
      const firstText = spans.find(
        s => s.type === "text" && s.value.trim().length > 0,
      )
      if (firstText) return firstText.value.trim().slice(0, 60)
    } catch {
      // ignore
    }
    return "Lush"
  },

  setTitle(doc, title) {
    doc.title = title
  },

  markCopy(doc) {
    doc.title = "Copy of " + this.getTitle(doc)
  },
}
