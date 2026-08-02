import { Repo } from "@automerge/automerge-repo"
import { getRegistry } from "@inkandswitch/patchwork-plugins"
import { LushDatatype } from "../src/datatype.js"
import LushTool from "../src/tool.js"
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
if (!fixture) handle.change(doc => LushDatatype.init(doc))

// A registry-contributed slash command, to exercise the extension seam the way
// another bundle would use it.
getRegistry("lush:slash").register({
  type: "lush:slash",
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

const cleanup = LushTool(handle, document.getElementById("app"))
const editor = document.querySelector(".lush-page").wordgard
window.lushDev = {handle, repo, cleanup, editor, Embed, roundTrip: () => roundTrip(handle, editor)}
