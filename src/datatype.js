import * as am from "@automerge/automerge"
import { spansFromDoc } from "@automerge/wordgard"
import { Paragraph } from "wordgard/types"
import { richAdapter } from "./adapter.js"

// The document model: a `content` rich-text field (edited via
// @automerge/wordgard) plus an optional `title`.
export const RichDatatype = {
  init(doc) {
    doc.title = ""
    doc.content = ""
    // Seed a single empty paragraph so every peer starts from the same
    // block structure (avoids two peers concurrently creating a first
    // paragraph).
    const seed = richAdapter.schema.doc([Paragraph.create([])])
    am.updateSpans(
      doc,
      ["content"],
      spansFromDoc(richAdapter, seed),
      richAdapter.updateSpansConfig(),
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
    return "Rich Text"
  },

  setTitle(doc, title) {
    doc.title = title
  },

  markCopy(doc) {
    doc.title = "Copy of " + this.getTitle(doc)
  },
}
