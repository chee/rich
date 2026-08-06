// Drafts, the host's copy-on-write branches. Editing a note inside a draft
// forks it, and the drafts module serves the fork point as `draft:baseline` —
// a subscription answered by whichever provider is above this tool, or by
// nobody at all when the note is open on main.
//
// Supporting drafts means showing that fork: the note reads as it now is, with
// what the draft added marked in place and what it took out struck through
// where it was. The diff is against the document as of the baseline heads, so
// it covers remote edits too, not just the ones typed here.
import * as am from "@automerge/automerge"
import { decodeHeads } from "@automerge/automerge-repo"
import { subscribe } from "@inkandswitch/patchwork-providers"
import { Decoration, PointSet, RangeSet, Widget, Wordgard } from "wordgard/editor"
import { GardState, Transaction } from "wordgard/state"
import { atomsOf, atomsText, contentRuns, diffAtoms } from "./wordgard/index.js"
import { docFromSpansCompat } from "./compat.js"

const setBaseline = Transaction.Effect.define()

const added = Decoration.Range.wrapper("span", {
  attributes: { class: "rich-diff-added" },
  scope: "all",
})

// Deleted text is not in the document, so it is a widget rather than a
// decoration over anything: an inert span the editor draws and never lets the
// cursor into.
const deleted = Widget.define({
  render: text => {
    const span = document.createElement("span")
    span.className = "rich-diff-deleted"
    span.textContent = text
    return span
  },
})

const nothing = { added: RangeSet.empty, deleted: PointSet.empty }

export function draftDiff({ handle, element, adapter, path = ["content"] }) {
  // The baseline document, linearised once per fork point: rebuilding it on
  // every keystroke would mean re-reading the whole note from Automerge.
  let baseline = null

  // No heads at all means no fork point and so no diff; empty heads are a
  // fork point before the note's first change, which reads as all new.
  function readBaseline(heads) {
    if (!heads) return null
    try {
      const at = am.view(handle.doc(), decodeHeads(heads))
      return atomsOf(docFromSpansCompat(adapter, am.spans(at, path.slice())))
    } catch (error) {
      console.warn("rich: could not read the draft baseline", error)
      return null
    }
  }

  function build(doc) {
    if (!baseline) return nothing
    const atoms = atomsOf(doc)
    const ranges = []
    const widgets = []
    for (const hunk of diffAtoms(baseline, atoms)) {
      for (const [from, to] of contentRuns(atoms, hunk.from, hunk.to)) {
        ranges.push([from, to, added])
      }
      const text = atomsText(baseline, hunk.oldFrom, hunk.oldTo)
      if (text) {
        widgets.push([hunk.from, Decoration.Point.widget(deleted.of(text), { side: -1 })])
      }
    }
    return { added: RangeSet.create(ranges), deleted: PointSet.create(widgets) }
  }

  const field = GardState.Field.define({
    create: () => nothing,
    update(value, tr) {
      let stale = tr.docChanged
      for (const effect of tr.effects) {
        if (!effect.is(setBaseline)) continue
        baseline = readBaseline(effect.value)
        stale = true
      }
      return stale ? build(tr.state.doc) : value
    },
    provide: field => [
      Decoration.Range.source.of(state => state.field(field).added),
      Decoration.Point.source.of(state => state.field(field).deleted),
    ],
  })

  // The subscription lives in a plugin so it is torn down with the editor. It
  // pushes the heads in as an effect; the field turns them into decorations.
  const listener = Wordgard.Plugin.fromClass(
    class {
      constructor(wg) {
        this.unsubscribe = subscribe(
          element,
          { type: "draft:baseline", url: handle.url },
          value =>
            wg.dispatch({
              effects: setBaseline.of(value?.heads ?? null),
              annotations: [Transaction.addToHistory.of(false)],
            }),
        )
      }

      remove() {
        this.unsubscribe()
      }
    },
  )

  return [field.extension, listener]
}
