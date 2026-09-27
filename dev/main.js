import * as am from "@automerge/automerge"
import { Repo, encodeHeads } from "@automerge/automerge-repo"
import { getRegistry } from "@inkandswitch/patchwork-plugins"
import { accept } from "@inkandswitch/patchwork-providers"
import { Leaf } from "wordgard/doc"
import { Paragraph } from "wordgard/types"
import { RichDatatype } from "../src/datatype.js"
import RichTool from "../src/tool.js"
import { Embed } from "../src/adapter.js"
import { roundTrip } from "./roundtrip.js"
import { spansFromDoc } from "../src/wordgard/index.js"
import { richAdapter } from "../src/adapter.js"
import { copyNote, titleFromSpans } from "../src/datatype.js"

const repo = new Repo({})
window.repo = repo

// The datatypes a host would list, so Patchwork Doc… has something to make.
import { plugins as richPluginDescriptions } from "../src/index.js"
for (const plugin of richPluginDescriptions) getRegistry(plugin.type).register(plugin)

// `?fixture=name` opens dev/fixtures/name.automerge — real documents saved out
// of other editors, to check they still load.
const fixture = new URLSearchParams(location.search).get("fixture")
const handle = fixture
  ? await repo.import(new Uint8Array(await (await fetch(`./fixtures/${fixture}.automerge`)).arrayBuffer()))
  : repo.create()
if (!fixture) handle.change(doc => RichDatatype.init(doc))

// A registry-contributed slash command, to exercise the extension seam the way
// another bundle would use it.
getRegistry("rich:slash").register({
  type: "rich:slash",
  id: "signature",
  name: "Signature",
  group: "Dev",
  keywords: ["sign"],
  tier: "core",
  async load() {
    const { Leaf } = await import("wordgard/doc")
    return {
      run(wg) {
        const pos = wg.state.selection.head
        wg.dispatch({ changes: { from: pos, insert: [Leaf.text("— chee")] } })
      },
    }
  },
})

// Stand-in for the host's drafts provider, which is the only thing that
// answers `draft:baseline`. `richDev.draft()` forks here — the note is
// unchanged, and everything typed after it reads as this draft's work.
// `richDev.draft(null)` goes back to main.
let baseline = null
const responders = new Set()
document.addEventListener("patchwork:subscribe", event => {
  if (event.detail.selector.type !== "draft:baseline") return
  accept(event, respond => {
    respond({ heads: baseline })
    responders.add(respond)
    return () => responders.delete(respond)
  })
})
const draft = (heads = encodeHeads(am.getHeads(handle.doc()))) => {
  baseline = heads
  for (const respond of responders) respond({ heads })
}

const cleanup = RichTool(handle, document.getElementById("app"))
const editor = document.querySelector(".rich-page").wordgard

// Spans as JSON the way lush's core hands them over: every string in a block
// marker is a Str scalar. `{"$text": "…"}` in an attr asks for collaborative
// text instead.
const fromJSON = spans =>
  spans.map(span => {
    if (span.type !== "block") return span
    const str = value =>
      typeof value === "string"
        ? new am.ImmutableString(value)
        : value && typeof value === "object" && "$text" in value
          ? value.$text
          : value
    const attrs = {}
    for (const [key, value] of Object.entries(span.value.attrs ?? {})) attrs[key] = str(value)
    return {
      type: "block",
      value: {
        type: str(span.value.type ?? "paragraph"),
        parents: (span.value.parents ?? []).map(str),
        attrs,
        isEmbed: span.value.isEmbed ?? false,
      },
    }
  })

// The reverse: Str scalars as plain strings, collaborative text as `{"$text"}`.
const toJSON = spans =>
  JSON.parse(
    JSON.stringify(spans.map(span => {
      if (span.type !== "block") return span
      const str = value =>
        am.isImmutableString(value) ? value.val : typeof value === "string" ? { $text: value } : value
      const attrs = {}
      for (const [key, value] of Object.entries(span.value.attrs ?? {})) attrs[key] = str(value)
      return {
        type: "block",
        value: {
          type: str(span.value.type),
          parents: (span.value.parents ?? []).map(str),
          attrs,
          isEmbed: span.value.isEmbed,
        },
      }
    })),
  )

// A note written by lush: `@patchwork`, a title, and the given spans.
function lushNote(spans) {
  const note = repo.create()
  note.change(doc => {
    doc["@patchwork"] = { type: "rich", title: "", suggestedImportUrl: "automerge:2XoPZihn6Vo2aqeVu2WN39W8cdAN" }
    doc.title = ""
    doc.content = ""
    am.updateSpans(doc, ["content"], fromJSON(spans))
  })
  return note
}

// Mount the tool on a fresh lush note instead of the harness's own.
let current = { handle, cleanup, editor }
function mount(spans) {
  current.cleanup()
  const note = lushNote(spans)
  const done = RichTool(note, document.getElementById("app"))
  const wg = document.querySelector(".rich-page").wordgard
  current = { handle: note, cleanup: done, editor: wg }
  Object.assign(window.richDev, current)
  return true
}

window.richDev = {
  handle,
  repo,
  cleanup,
  editor,
  am,
  Embed,
  Leaf,
  Paragraph,
  draft,
  mount,
  lushNote,
  titleFromSpans,
  roundTrip: () => roundTrip(current.handle, current.editor),
  // What automerge holds, as lush-style JSON.
  spans: () => toJSON(am.spans(current.handle.doc(), ["content"])),
  // What the editor would write, as lush-style JSON.
  written: () => toJSON(spansFromDoc(richAdapter, current.editor.state.doc)),
  // Write the editor's whole document the slow way, and say whether that
  // changed anything: a document read faithfully writes back as a no-op.
  rewrite: () => {
    const before = am.getHeads(current.handle.doc()).join()
    current.handle.change(doc =>
      am.updateSpans(doc, ["content"], spansFromDoc(richAdapter, current.editor.state.doc), richAdapter.updateSpansConfig()),
    )
    return before !== am.getHeads(current.handle.doc()).join()
  },
  copy: () => {
    const copy = copyNote(repo, current.handle.doc())
    return {
      spans: toJSON(am.spans(copy.doc(), ["content"])),
      history: am.getHistory(copy.doc()).length,
      sourceHistory: am.getHistory(current.handle.doc()).length,
      title: copy.doc().title,
      patchwork: copy.doc()["@patchwork"],
    }
  },
}
