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
  /// Called inside every local write's change, after the content is
  /// written — for fields derived from it, like the title. `written` is
  /// the editor's document, which the content now matches.
  onWrite?: (doc: am.Doc<unknown>, written: Plot.Doc) => void
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
  onWrite,
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
            if (!this.writeText(doc, pending)) {
              am.updateSpans(
                doc,
                // slice() because am mutates the path array in place
                path.slice(),
                spansFromDoc(adapter, this.wg.state.doc),
                spansConfig,
              )
            }
            onWrite?.(doc, this.wg.state.doc)
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
      /// changed nothing, when the transactions aren't all like that.
      writeText(doc: am.Doc<unknown>, transactions: Transaction[]): boolean {
        type Edit = {
          index: number
          del: number
          text: string
          marks: am.MarkSet
          // marks to set by hand: at the edge of a run, what automerge gives
          // new text depends on how each mark expands
          explicit: string[] | null
        }
        const marksOf = (doc: Plot.Doc, from: number, to: number): Mark.Set | null => {
          let marks: Mark.Set | null = null
          let mixed = false
          doc.iterate(from, to, node => {
            if (!node.is(Leaf.Text)) return
            if (marks && !Mark.sameSet(marks, node.marks)) mixed = true
            marks = node.marks
          })
          return mixed ? null : marks
        }
        // The names of the marks on every run of text in a range.
        const markNames = (doc: Plot.Doc, from: number, to: number, blockName: string | null) => {
          const names = new Set<string>()
          doc.iterate(from, to, node => {
            if (!node.is(Leaf.Text)) return
            for (const name of Object.keys(amMarksFromMarks(adapter, node.marks, blockName))) names.add(name)
          })
          return names
        }
        // Marks on text these transactions delete. Text put in its place in
        // the same change can take them on in automerge (a mark whose every
        // character goes still holds the spot), whatever its neighbours say,
        // so new text in this change sets those by hand.
        const deleted = new Set<string>()
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
              // only text comes in, and no text that is a block marker or
              // a line break on the other side
              let text = ""
              for (const token of inserted.content) {
                const node = token as Node
                if (typeof node.is !== "function" || !node.is(Leaf.Text)) return (simple = false)
                text += node.param as string
              }
              if (new RegExp("[\\n\\u2028\\ufffc]").test(text)) return (simple = false)
              const block = tr.newDoc.resolve(fromB).parent.node.type
              const blockName = adapter.blockNameForNode(block, null)
              if (to > from) for (const name of markNames(start, fromA, toA, blockName)) deleted.add(name)
              let marks: am.MarkSet = {}
              let explicit: string[] | null = null
              if (text) {
                // the marks it ends up with, from the new document (the
                // inserted slice carries mark changes, not final marks)
                const wanted = marksOf(tr.newDoc, fromB, toB)
                if (!wanted) return (simple = false)
                marks = amMarksFromMarks(adapter, wanted, blockName)
                const before = units[from - 1]?.kind === "char" ? marksOf(start, fromA - 1, fromA) : null
                const after = units[to]?.kind === "char" ? marksOf(start, toA, toA + 1) : null
                const inside =
                  before && after && Mark.sameSet(before, wanted) && Mark.sameSet(after, wanted)
                if (!inside) {
                  const names = new Set(Object.keys(marks))
                  for (const side of [before, after])
                    if (side) for (const name of Object.keys(amMarksFromMarks(adapter, side, blockName))) names.add(name)
                  explicit = [...names]
                }
              }
              edits.push({ index: from, del: to - from, text, marks, explicit })
            },
            (_fromA, _toA, _fromB, _toB, modifications) => {
              if (modifications) simple = false
            },
          )
          if (!simple) return false
          plan.push(edits)
        }

        for (const edits of plan) {
          // right to left, so each index still means what it did
          for (const edit of edits.reverse()) {
            am.splice(doc, path.slice(), edit.index, edit.del, edit.text)
            if (edit.text && deleted.size)
              edit.explicit = [...new Set([...(edit.explicit ?? Object.keys(edit.marks)), ...deleted])]
            if (!edit.explicit) continue
            // expand both, like every other mark in the note (see
            // SchemaAdapter.updateSpansConfig)
            const range = { start: edit.index, end: edit.index + edit.text.length, expand: "both" as const }
            for (const name of edit.explicit) {
              if (name in edit.marks) am.mark(doc, path.slice(), range, name, edit.marks[name])
              else am.unmark(doc, path.slice(), range, name)
            }
          }
        }
        return true
      }

      receiveRemote() {
        if (this.isProcessing) return

        const heads = am.getHeads(handle.doc())
        if (am.equals(heads, this.reconciledHeads)) return

        const spans = am.spans(handle.doc(), path)
        const newDoc = docFromSpans(adapter, spans)
        this.reconciledHeads = heads

        const doc = this.wg.state.doc
        const diff = diffDocs(doc, newDoc)
        if (diff == null) return

        const annotations = [
          reconcileAnnotation.of(true),
          Transaction.addToHistory.of(false),
          Transaction.remote.of(true),
        ]
        // The diff's slice fits where it goes as it is (see diffDocs), so
        // it goes in unfitted: fitting would "repair" what it doesn't
        // expect, such as a list item that holds only a nested list (which
        // is how a peer nests a first item), and leave the old structure.
        // Should it not fit after all, the whole note is replaced.
        try {
          this.wg.dispatch({
            changes: { from: diff.from, to: diff.to, insert: diff.slice },
            annotations,
            scrollIntoView: false,
          })
        } catch (error) {
          console.warn("rich: replacing the whole note with a peer's change", error)
          this.wg.dispatch({
            changes: { from: 0, to: doc.contentLength, insert: newDoc.slice(0, newDoc.contentLength) },
            annotations,
            scrollIntoView: false,
          })
        }
      }

      remove() {
        this.writeLocal()
        this.removed = true
        this.unlisten()
      }
    },
  )
}

