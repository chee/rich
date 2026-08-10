import { GardState } from "wordgard/state"
import { Plot, Schema } from "wordgard/doc"
import * as am from "@automerge/automerge"
import { SchemaAdapter } from "./schema.js"
import { basicSchemaAdapter } from "./basicSchema.js"
import { docFromSpans } from "./traversal.js"
import { automergeSyncPlugin } from "./plugin.js"
import { DocHandle } from "./DocHandle.js"

export { SchemaAdapter, UnknownBlock } from "./schema.js"
export type {
  MappedSchemaSpec,
  BlockMappingSpec,
  MarkMappingSpec,
  BlockMarker,
  BlockAttrParsers,
  MarkParsers,
} from "./schema.js"
export { amMarksFromMarks, marksFromAmMarks } from "./schema.js"
export { basicSchemaAdapter, basicSchemaSpec } from "./basicSchema.js"
export { docFromSpans, spansFromDoc, spansFromSlice } from "./traversal.js"
export { indexUnits, indexFromPos, posFromIndex } from "./traversal.js"
export type { IndexUnit } from "./traversal.js"
export { diffDocs, diffAtoms, atomsOf, atomsText, contentRuns } from "./diff.js"
export type { Atom, Hunk } from "./diff.js"
export {
  automergeSyncPlugin,
  reconcileAnnotation,
  isReconcileTransaction,
} from "./plugin.js"
export type { DocHandle, DocHandleChangePayload } from "./DocHandle.js"

/// Initialise the editor state and syncing extension for an Automerge
/// rich-text field.
///
/// @param handle - a handle to the Automerge document
/// @param path - the path to the rich text field within the document
/// @param options - pass a custom {@link SchemaAdapter} here; defaults
///   to {@link basicSchemaAdapter}
///
/// @returns The wordgard {@link Schema}, the initial {@link Plot.Doc
/// document} materialised from Automerge, and the {@link
/// GardState.Extension extension} to install in the editor (which
/// registers the schema and the syncing plugin).
///
/// @example
/// ```ts
/// const { doc, extension } = init(handle, ["text"])
/// const editor = Wordgard.create({
///   parent: document.body,
///   doc,
///   config: [extension, history(), menuBar()],
/// })
/// ```
export function init(
  handle: DocHandle<unknown>,
  path: am.Prop[],
  options: { adapter?: SchemaAdapter } = {},
): { schema: Schema; doc: Plot.Doc; extension: GardState.Extension } {
  const adapter = options.adapter ?? basicSchemaAdapter
  const spans = am.spans(handle.doc(), path)
  const doc = docFromSpans(adapter, spans)
  const extension: GardState.Extension = [
    GardState.schemaElement.of(adapter.elements),
    automergeSyncPlugin({ adapter, handle, path }),
  ]
  return { schema: adapter.schema, doc, extension }
}
