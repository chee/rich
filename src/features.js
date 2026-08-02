// Features are `lush:feature` plugins, not fields on the editor. Each one
// contributes Wordgard extensions; the tool enables a set of them with a single
// selector that applies across every lush plugin type.
//
// A host bundle can register more of them: `{type: "lush:feature", id, name,
// tier, async load() { return {extensions(context)} }}` — metadata is
// serializable, the function rides behind `load()`.
import { InputRule, Wordgard, dropCursor, placeholder } from "wordgard/editor"
import { GardState } from "wordgard/state"
import { blockGutter } from "./blocks.js"
import { formatBar } from "./format-bar.js"
import { imageDropAndPaste } from "./images.js"
import { slashCommands, slashMenu } from "./slash.js"
import { blockTypes } from "./block-types.js"
import { tableEditing } from "./tables.js"
import { getDndPayload, hasDocumentDrag } from "./dnd.js"
import { Embed, EmbedTool } from "./adapter.js"
import { loadedPlugins } from "./registry.js"

const feature = (id, name, tier, extensions) => ({
  type: "lush:feature",
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

  // `<lush-embed>` asks for a tool by dispatching an event: it draws the menu,
  // the editor owns the document.
  const chooseTool = Wordgard.Plugin.define(wg => {
    const onChoose = event => {
      const element = event.target.closest?.("lush-embed") ?? event.target
      let found
      try {
        found = wg.nodeFromDOM(element)
      } catch {
        return
      }
      if (!found) return
      const node = wg.state.doc.resolve(found.pos).nodeAfter
      if (!node) return
      const toolId = event.detail?.toolId
      const existing = EmbedTool.isInSet(node.marks)
      const changes = []
      if (existing) changes.push({ from: found.pos, to: found.pos + 1, remove: existing })
      if (toolId) changes.push({ from: found.pos, to: found.pos + 1, add: EmbedTool.of(toolId) })
      if (changes.length) wg.dispatch({ changes, userEvent: "embed.tool" })
    }
    return {
      connect: () => wg.dom.addEventListener("lush-embed-tool", onChoose),
      disconnect: () => wg.dom.removeEventListener("lush-embed-tool", onChoose),
      remove: () => wg.dom.removeEventListener("lush-embed-tool", onChoose),
    }
  }).extension

  return [
    GardState.prec.highest(Wordgard.domEventHandler("dragover", onDragOver)),
    GardState.prec.highest(Wordgard.domEventHandler("drop", onDrop)),
    chooseTool,
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
  feature("slash", "Slash menu", "core", context => slashMenu(context)),
  feature("blocks", "Block handles", "core", context => blockGutter(context)),
  feature("tables", "Table editing", "core", () => tableEditing()),
  feature("images", "Image paste & drop", "core", () => imageDropAndPaste()),
  feature("embed", "Document embeds", "core", embedExtensions),
  feature("placeholder", "Placeholder", "core", () => placeholder("Start writing…")),
  feature("format-bar", "Selection formatting", "full", context => formatBar(context)),
  feature("typography", "Smart typography", "full", () =>
    typographyRules.map(rule => rule.extension),
  ),
]

// Live plugin lists for both types. `selector` is read on every refresh, so the
// tool can change it (the `/plugins` panel writing to `doc.plugins`) and call
// `refresh()`.
export function lushPlugins(selector, onChange) {
  return {
    blocks: loadedPlugins("lush:block", blockTypes, selector, onChange),
    commands: loadedPlugins("lush:slash", slashCommands, selector, onChange),
    features: loadedPlugins("lush:feature", featurePlugins, selector, onChange),
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
      console.error(`lush: feature "${plugin.id}" failed to build extensions`, error)
    }
  }
  return extensions
}
