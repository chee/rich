import { GardState, Transaction } from "wordgard/state"
import { Wordgard } from "wordgard/editor"
import { Leaf, Mark, Node, Plot } from "wordgard/doc"
import * as am from "@automerge/automerge"
import { SchemaAdapter, amMarksFromMarks } from "./schema.js"
import { spansFromDoc, docFromSpans, indexUnits, indexFromPos, IndexUnit } from "./traversal.js"
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
  const spansConfig = adapter.updateSpansConfig()
  const touchesPath = (patch: am.Patch): boolean => {
    const length = Math.min(path.length, patch.path.length)
    for (let i = 0; i < length; i++) {
      if (path[i] !== patch.path[i]) return false
    }
    return true
  }
  return Wordgard.Plugin.fromClass(
    class {
      wg: Wordgard
      reconciledHeads: am.Heads
      isProcessing = false
      listening = false
      writeQueued = false
      removed = false
      // Local transactions not yet written to the Automerge document.
      pending: Transaction[] = []
      unitsDoc: Plot.Doc | null = null
      units: IndexUnit[] = []
      onChange: (payload: DocHandleChangePayload<unknown>) => void

      constructor(wg: Wordgard) {
        this.wg = wg
        this.reconciledHeads = am.getHeads(handle.doc())
        this.onChange = payload => {
          if (payload.patches.some(touchesPath)) {
            this.receiveRemote()
          } else {
            this.reconciledHeads = am.getHeads(payload.doc)
          }
        }
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

        this.pending.push(...relevant)
        if (this.writeQueued) return
        this.writeQueued = true
        queueMicrotask(() => this.writeLocal())
      }

      writeLocal() {
        if (!this.writeQueued || this.removed) return
        this.writeQueued = false

        // While we write our own change, ignore the resulting handle
        // "change" notification.
        const pending = this.pending
        this.pending = []
        this.isProcessing = true
        try {
          handle.change(doc => {
            if (this.writeText(doc, pending)) return
            am.updateSpans(
              doc,
              // slice() because am mutates the path array in place
              path.slice(),
              spansFromDoc(adapter, this.wg.state.doc),
              spansConfig,
            )
          })
          this.reconciledHeads = am.getHeads(handle.doc())
        } finally {
          this.isProcessing = false
        }
      }

      unitsFor(doc: Plot.Doc): IndexUnit[] {
        if (doc !== this.unitsDoc) {
          this.unitsDoc = doc
          this.units = indexUnits(adapter, doc)
        }
        return this.units
      }

      /// Write plain typing (text replacing text, inside one textblock)
      /// straight to the Automerge text, instead of diffing the whole
      /// document with `updateSpans`, which costs time in proportion to
      /// the note's length on every keystroke. Returns false, having
      /// changed nothing, when the transactions aren't all like that;
      /// returns false having spliced when the marks came out different
      /// from the editor's, and the caller's `updateSpans` then corrects
      /// just that.
      writeText(doc: am.Doc<unknown>, transactions: Transaction[]): boolean {
        type Edit = { index: number; del: number; text: string; marks: am.MarkSet }
        const plan: Edit[][] = []
        for (const tr of transactions) {
          const start = tr.startState.doc
          const edits: Edit[] = []
          let simple = true
          tr.changes.iterChanges(
            (fromA, toA, fromB, toB, inserted) => {
              if (!simple) return
              const units = this.unitsFor(start)
              const from = indexFromPos(units, fromA)
              const to = indexFromPos(units, toA)
              // only characters go: no block markers, no embeds
              if (to - from !== toA - fromA) return (simple = false)
              for (let i = from; i < to; i++) {
                if (units[i].kind !== "char") return (simple = false)
              }
              // an insertion or deletion at a block boundary could just as
              // well belong to the block on either side: leave it to
              // updateSpans
              if (units[from - 1]?.kind !== "char" && units[to]?.kind !== "char")
                return (simple = false)
              // only text comes in
              let text = ""
              for (const token of inserted.content) {
                const node = token as Node
                if (typeof node.is !== "function" || !node.is(Leaf.Text)) return (simple = false)
                text += node.param as string
              }
              // and it ends up with one set of marks. (The inserted slice
              // carries mark changes, not the final marks: read those from
              // the new document.)
              let marks: Mark.Set | null = null
              if (text)
                tr.newDoc.iterate(fromB, toB, node => {
                  if (!node.is(Leaf.Text)) return
                  if (marks && !Mark.sameSet(marks, node.marks)) simple = false
                  marks = node.marks
                })
              if (!simple || (text && !marks)) return (simple = false)
              edits.push({
                index: from,
                del: to - from,
                text,
                marks: marks ? amMarksFromMarks(adapter, marks) : {},
              })
            },
            (_fromA, _toA, _fromB, _toB, modifications) => {
              if (modifications) simple = false
            },
          )
          if (!simple) return false
          plan.push(edits)
        }

        let marksMatch = true
        for (const edits of plan) {
          // right to left, so each index still means what it did
          for (const edit of edits.reverse()) {
            am.splice(doc, path.slice(), edit.index, edit.del, edit.text)
            if (!edit.text) continue
            const got: { [key: string]: am.MarkValue } = {}
            for (const [k, v] of Object.entries(am.marksAt(doc, path.slice(), edit.index)))
              if (v != null) got[k] = v
            if (!sameMarks(got, edit.marks)) marksMatch = false
          }
        }
        return marksMatch
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
        this.writeLocal()
        this.removed = true
        this.unlisten()
      }
    },
  )
}

function sameMarks(a: am.MarkSet, b: am.MarkSet): boolean {
  const keys = Object.keys(a)
  if (keys.length !== Object.keys(b).length) return false
  return keys.every(k => JSON.stringify(a[k]) === JSON.stringify(b[k]))
}
