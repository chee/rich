import * as am from "@automerge/automerge"
import { Wordgard } from "wordgard/editor"
import { history } from "wordgard/history"
import {
  blockDoc,
  paragraph,
  heading,
  blockquote,
  codeBlock,
  bulletList,
  orderedList,
  strong,
  emphasis,
  code,
  link,
} from "wordgard/schema"
import { GardState } from "wordgard/state"
import { tables } from "wordgard/table"
import { automergeSyncPlugin } from "./wordgard/index.js"
import { docFromSpansCompat } from "./compat.js"
import "./embed-element.js"
import { richAdapter, Column, Columns, Embed, EmbedTool, RichImage } from "./adapter.js"
import { Highlight } from "./highlight.js"
import { Logline } from "./logline.js"
import { HtmlBlock } from "./html-block.js"
import { featureExtensions, richPlugins } from "./features.js"
import { docSelector, expandSelector } from "./plugin-catalog.js"
import "./rich.css"

// The render contract: (handle, element) => cleanup.
export default function RichTool(handle, element) {
  element.classList.add("rich-tool")

  const page = document.createElement("div")
  page.className = "rich-page"
  element.append(page)

  let editor = null
  // Which plugins are on is the document's business: `doc.plugins` lists the
  // enabled full-tier ids, core-tier is always on, and the `/plugins` panel
  // edits that array.
  const selector = () => expandSelector(docSelector(handle.doc()))
  const { blocks, commands, features } = richPlugins(selector, () => applyFeatures())
  const featureConfig = GardState.Compartment.define()

  const context = {
    handle,
    element,
    adapter: richAdapter,
    blockTypes: () => blocks.get(),
    slashCommands: () => commands.get(),
  }

  // Built extensions are cached per feature id: a plugin's extension value is
  // its identity to the editor, so rebuilding them on every reconfigure would
  // tear down and recreate every plugin (and its DOM).
  const built = new Map()
  const extensions = () =>
    features.get().map(plugin => {
      if (!built.has(plugin.id)) built.set(plugin.id, featureExtensions([plugin], context))
      return built.get(plugin.id)
    })

  function applyFeatures() {
    if (!editor) return
    editor.dispatch({ effects: featureConfig.reconfigure(extensions()) })
  }

  let enabled = JSON.stringify(handle.doc()?.plugins ?? null)
  function onDocChange() {
    const next = JSON.stringify(handle.doc()?.plugins ?? null)
    if (next === enabled) return
    enabled = next
    blocks.refresh()
    commands.refresh()
    features.refresh()
  }
  handle.on("change", onDocChange)

  editor = Wordgard.create({
    parent: page,
    doc: docFromSpansCompat(richAdapter, am.spans(handle.doc(), ["content"])),
    config: [
      // Node types the adapter maps but no editing bundle registers.
      GardState.schemaElement.of([
        Embed,
        RichImage,
        Columns,
        Column,
        Highlight,
        EmbedTool,
        Logline,
        HtmlBlock,
      ]),

      // Editing behaviour for exactly the node/mark types the adapter maps,
      // so the user can only create content that round-trips to Automerge.
      blockDoc(),
      paragraph(),
      heading(),
      blockquote(),
      codeBlock(),
      bulletList(),
      orderedList(),
      strong(),
      emphasis(),
      code(),
      link(),

      // Tables: cells hold inline content, which is what the block encoding
      // can represent.
      tables({ cellContent: "inline" }),

      history(),

      // Keep the editor in sync with the Automerge `content` field.
      automergeSyncPlugin({ adapter: richAdapter, handle, path: ["content"] }),

      Wordgard.scrolling("100%"),

      featureConfig.of(extensions()),
    ],
  })

  // Handle for embedders (and the dev harness) that want to drive the editor.
  page.wordgard = editor

  return () => {
    handle.off("change", onDocChange)
    blocks.dispose()
    commands.dispose()
    features.dispose()
    editor.dom.remove()
    page.remove()
    element.querySelector(".rich-plugins-panel")?.remove()
    element.classList.remove("rich-tool")
  }
}
