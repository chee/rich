import { GardState, Transaction } from "wordgard/state"
import { Wordgard } from "wordgard/editor"
import * as am from "@automerge/automerge"
import { SchemaAdapter } from "./schema.js"
import { spansFromDoc, docFromSpans } from "./traversal.js"
import { diffDocs } from "./diff.js"
import { DocHandle, DocHandleChangePayload } from "./DocHandle.js"

/// Annotation added to transactions that this plugin dispatches in
/// response to remote Automerge changes. Such transactions are not
/// written back to the Automerge document.
export const reconcileAnnotation = Transaction.Annotation.define<boolean>()

/// Whether a transaction was produced by reconciling a remote Automerge
/// change.
export const isReconcileTransaction = (tr: Transaction): boolean =>
  tr.annotation(reconcileAnnotation) === true

export interface SyncPluginConfig {
  adapter: SchemaAdapter
  handle: DocHandle<unknown>
  path: am.Prop[]
}

/// Create the editor extension that keeps a wordgard editor in sync
/// with a rich-text field in an Automerge document.
///
/// Local editor changes are written to the Automerge document with
/// `am.updateSpans`; remote Automerge changes are read back, converted
/// to a wordgard document, and dispatched as a minimal reconciling
/// transaction that preserves the selection.
export function automergeSyncPlugin({
  adapter,
  handle,
  path,
}: SyncPluginConfig): GardState.Extension {
  return Wordgard.Plugin.fromClass(
    class {
      wg: Wordgard
      reconciledHeads: am.Heads
      isProcessing = false
      listening = false
      onChange: (payload: DocHandleChangePayload<unknown>) => void

      constructor(wg: Wordgard) {
        this.wg = wg
        this.reconciledHeads = am.getHeads(handle.doc())
        this.onChange = () => this.receiveRemote()
      }

      listen() {
        if (this.listening) return
        this.listening = true
        handle.on("change", this.onChange)
      }

      unlisten() {
        if (!this.listening) return
        this.listening = false
        handle.off("change", this.onChange)
      }

      connect() {
        // Catch up on anything that changed before we were listening.
        this.listen()
        this.receiveRemote()
      }

      disconnect() {
        this.unlisten()
      }

      update(update: Wordgard.Update) {
        const relevant = update.transactions.filter(
          tr => !isReconcileTransaction(tr) && tr.docChanged,
        )
        if (relevant.length === 0) return

        // While we write our own change, ignore the resulting handle
        // "change" notification.
        this.isProcessing = true
        try {
          handle.change(doc => {
            am.updateSpans(
              doc,
              // slice() because am mutates the path array in place
              path.slice(),
              spansFromDoc(adapter, update.state.doc),
              adapter.updateSpansConfig(),
            )
          })
          this.reconciledHeads = am.getHeads(handle.doc())
        } finally {
          this.isProcessing = false
        }
      }

      receiveRemote() {
        if (this.isProcessing) return

        const heads = am.getHeads(handle.doc())
        if (am.equals(heads, this.reconciledHeads)) return

        const spans = am.spans(handle.doc(), path)
        const newDoc = docFromSpans(adapter, spans)
        this.reconciledHeads = heads

        const diff = diffDocs(this.wg.state.doc, newDoc)
        if (diff == null) return

        this.wg.dispatch({
          changes: { from: diff.from, to: diff.to, insert: diff.slice, fit: true },
          annotations: [
            reconcileAnnotation.of(true),
            Transaction.addToHistory.of(false),
            Transaction.remote.of(true),
          ],
          scrollIntoView: false,
        })
      }

      remove() {
        this.unlisten()
      }
    },
  )
}
