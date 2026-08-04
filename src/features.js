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
import { blockTypes } from "./block-types.js"
import { richKeys } from "./keys.js"
import { htmlEditing } from "./html-block.js"
import { todoLists } from "./todo-list.js"
import { tableEditing } from "./tables.js"
import { listIndent } from "./lists.js"
import { getDndPayload, hasDocumentDrag } from "./dnd.js"
import { Embed, EmbedTool } from "./adapter.js"
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

  // `<rich-embed>` asks for a tool by dispatching an event: it draws the menu,
  // the editor owns the document.
  const chooseTool = Wordgard.Plugin.define(wg => {
    const onChoose = event => {
      const element = event.target.closest?.("rich-embed") ?? event.target
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
      connect: () => wg.dom.addEventListener("rich-embed-tool", onChoose),
      disconnect: () => wg.dom.removeEventListener("rich-embed-tool", onChoose),
      remove: () => wg.dom.removeEventListener("rich-embed-tool", onChoose),
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

// An empty note offers you an opening line. Usually the fairytale one.
const OPENINGS = [
  "Howdy, partner…",
  "Call me Ishmael…",
  "Once upon a time there were four little Rabbits…",
  "The story so far…",
  "It was a queer, sultry summer…",
  "I write this sitting in the kitchen sink…",
  "It was the best of times, it was the worst of times…",
]

const opening = () =>
  Math.random() < 0.6
    ? "Once upon a time…"
    : OPENINGS[Math.floor(Math.random() * OPENINGS.length)]

export const featurePlugins = [
  feature("slash", "Slash menu", "core", context => slashMenu(context)),
  feature("blocks", "Block handles", "core", context => blockGutter(context)),
  feature("tables", "Table editing", "core", () => tableEditing()),
  feature("lists", "List indenting", "core", () => listIndent()),
  feature("todo", "To-do checkboxes", "core", () => todoLists()),
  feature("images", "Image paste & drop", "core", () => imageDropAndPaste()),
  feature("embed", "Document embeds", "core", embedExtensions),
  feature("placeholder", "Placeholder", "core", () => placeholder(opening())),
  feature("keys", "Keyboard shortcuts", "core", context => richKeys(context)),
  feature("html", "HTML blocks", "core", () => htmlEditing()),
  feature("format-bar", "Selection formatting", "full", context => formatBar(context)),
  feature("typography", "Smart typography", "full", () =>
    typographyRules.map(rule => rule.extension),
  ),
]

// Live plugin lists for both types. `selector` is read on every refresh, so the
// tool can change it (the `/plugins` panel writing to `doc.plugins`) and call
// `refresh()`.
export function richPlugins(selector, onChange) {
  return {
    blocks: loadedPlugins("rich:block", blockTypes, selector, onChange),
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
