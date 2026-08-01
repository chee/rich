// Features are `rich:feature` plugins, not fields on the editor. Each one
// contributes Wordgard extensions; the tool enables a set of them with a single
// selector that applies across every rich plugin type.
//
// A host bundle can register more of them: `{type: "rich:feature", id, name,
// tier, async load() { return {extensions(context)} }}` — metadata is
// serializable, the function rides behind `load()`.
import { InputRule, Wordgard, dropCursor, placeholder } from "wordgard/editor"
import { GardState } from "wordgard/state"
import { blockGutter } from "./blocks.js"
import { formatBar } from "./format-bar.js"
import { imageDropAndPaste } from "./images.js"
import { slashCommands, slashMenu } from "./slash.js"
import { getDndPayload, hasDocumentDrag } from "./dnd.js"
import { Embed } from "./adapter.js"
import { loadedPlugins } from "./registry.js"

const feature = (id, name, tier, extensions) => ({
  type: "rich:feature",
  id,
  name,
  tier,
  extensions,
})

// Dropping a Patchwork document from the sidebar embeds it as a block.
function embedExtensions() {
  function onDragOver(event) {
    if (!hasDocumentDrag(event.dataTransfer)) return false
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy"
    return false
  }

  function onDrop(event, wg) {
    const payload = getDndPayload(event)
    if (!payload || payload.items.length === 0) return false
    event.preventDefault()

    let pos
    try {
      pos = wg.posAtCoords({ x: event.clientX, y: event.clientY }).pos
    } catch {
      pos = wg.state.doc.length
    }

    wg.dispatch({
      changes: { from: pos, insert: payload.items.map(item => Embed.of(item.url)), fit: true },
      scrollIntoView: true,
    })
    return true
  }

  return [
    GardState.prec.highest(Wordgard.domEventHandler("dragover", onDragOver)),
    GardState.prec.highest(Wordgard.domEventHandler("drop", onDrop)),
    dropCursor(),
  ]
}

const typographyRules = [
  InputRule.define({ expr: /--$/, apply: "—" }),
  InputRule.define({ expr: /\.\.\.$/, apply: "…" }),
  // Lookbehind so the preceding space isn't part of the match (an `apply`
  // string replaces the whole match).
  InputRule.define({ expr: /(?<=^|[\s([{])"$/, apply: "“" }),
  InputRule.define({ expr: /"$/, apply: "”" }),
  InputRule.define({ expr: /(?<=^|[\s([{])'$/, apply: "‘" }),
  InputRule.define({ expr: /'$/, apply: "’" }),
]

export const featurePlugins = [
  feature("slash", "Slash commands", "core", context =>
    slashMenu(context.slashCommands, context),
  ),
  feature("blocks", "Block handles", "core", () => blockGutter()),
  feature("images", "Image paste & drop", "core", () => imageDropAndPaste()),
  feature("embed", "Document embeds", "core", embedExtensions),
  feature("placeholder", "Placeholder", "core", () => placeholder("Start writing…")),
  feature("format-bar", "Selection formatting", "full", () => formatBar()),
  feature("typography", "Smart typography", "full", () =>
    typographyRules.map(rule => rule.extension),
  ),
]

// Live plugin lists for both types. `selector` is read on every refresh, so the
// tool can change it (the `/plugins` panel writing to `doc.plugins`) and call
// `refresh()`.
export function richPlugins(selector, onChange) {
  return {
    commands: loadedPlugins("rich:slash", slashCommands, selector, onChange),
    features: loadedPlugins("rich:feature", featurePlugins, selector, onChange),
  }
}

// Turn feature plugins into Wordgard extensions. A plugin whose implementation
// hasn't loaded yet contributes nothing on this pass; the tool re-runs this
// when the registry settles.
export function featureExtensions(features, context) {
  const extensions = []
  for (const plugin of features) {
    if (typeof plugin.extensions !== "function") continue
    try {
      extensions.push(plugin.extensions(context))
    } catch (error) {
      console.error(`rich: feature "${plugin.id}" failed to build extensions`, error)
    }
  }
  return extensions
}
