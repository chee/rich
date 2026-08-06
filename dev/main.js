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

const repo = new Repo({})
window.repo = repo

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
window.richDev = {handle, repo, cleanup, editor, Embed, Leaf, Paragraph, draft, roundTrip: () => roundTrip(handle, editor)}
