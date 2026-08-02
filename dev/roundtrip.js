// Dev-only: re-materialise the document from the Automerge spans and compare
// it to what the editor has, so the tests can prove blocks round-trip.
import * as am from "@automerge/automerge"
import { docFromSpans } from "../src/wordgard/index.js"
import { lushAdapter } from "../src/adapter.js"

export function roundTrip(handle, editor) {
  const spans = am.spans(handle.doc(), ["content"])
  const rebuilt = docFromSpans(lushAdapter, spans)
  return {
    spans: JSON.stringify(spans),
    live: JSON.stringify(editor.state.doc.toJSON()),
    rebuilt: JSON.stringify(rebuilt.toJSON()),
  }
}
