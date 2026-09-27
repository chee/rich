import * as am from "@automerge/automerge"
import { InputRule, Wordgard } from "wordgard/editor"
import { history } from "wordgard/history"
import { Blockquote, BulletList, Heading, OrderedList } from "wordgard/types"
import {
  blockDoc,
  lineBreak,
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
  underline,
  strikethrough,
  superscript,
  subscript,
} from "wordgard/schema"
import { GardState } from "wordgard/state"
import { tables } from "wordgard/table"
import { automergeSyncPlugin, UnknownBlock, UnknownEmbed, BlockExtras, ForeignMarks } from "./wordgard/index.js"
import { docFromSpansCompat } from "./compat.js"
import "./embed-element.js"
import { richAdapter, Column, Columns, Embed, EmbedTool, Font, Indent, RichImage } from "./adapter.js"
import { Highlight } from "./highlight.js"
import { Logline } from "./logline.js"
import { HtmlBlock } from "./html-block.js"
import { Checked, TodoList, TodoState } from "./todo-list.js"
import { featureExtensions, richPlugins } from "./features.js"
import { draftDiff } from "./drafts.js"
import { docSelector, expandSelector } from "./plugin-catalog.js"
import { syncTitle } from "./datatype.js"
import "./cards.js"
import "./rich.css"

// Lush's markdown triggers: `-` or `*` for a bullet, `1.` for a number, `#`
// to `###` for Title, Heading and Subheading, `>` for a quote (the to-do
// brackets are in todo-list.js). The schema bundles' own versions of these
// only fire on empty lines; these fire on a line with content after the
// cursor too.
const convertOnPrefix = [
  InputRule.textblockType(/^(#{1,3}) $/, match => Heading.of(match[1].text.length)),
  InputRule.wrapping(/^> $/, Blockquote),
  InputRule.wrapping(/^ ?[-*] $/, BulletList),
  InputRule.wrapping(/^ ?(\d+)\. $/, match => OrderedList.of(+match[1].text)),
]

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
  function onDocChange({ patches }) {
    if (!patches.some(patch => patch.path.length === 0 || patch.path[0] === "plugins")) return
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
      // Every node and mark type the adapter maps, so whatever a document
      // holds can be loaded, whether or not an editing bundle offers it.
      GardState.schemaElement.of(richAdapter.elements),

      // Editing behaviour for exactly the node/mark types the adapter maps,
      // so the user can only create content that round-trips to Automerge.
      blockDoc(),
      paragraph(),
      // Soft line breaks: U+2028 in the text, the way lush writes them.
      lineBreak(),
      heading(),
      blockquote(),
      codeBlock(),
      bulletList(),
      orderedList(),
      strong(),
      emphasis(),
      code(),
      link(),
      underline(),
      strikethrough(),
      superscript(),
      subscript(),

      convertOnPrefix.map(rule => rule.extension),

      // Tables, as lush has them: cells hold blocks, there is a header row
      // or none, and no cell spans more than one row or column.
      tables({ cellContent: "block", cellSpanning: false }),

      history(),

      // Keep the editor in sync with the Automerge `content` field, and the
      // title with its first line.
      automergeSyncPlugin({ adapter: richAdapter, handle, path: ["content"], onWrite: syncTitle }),

      // Drafts: the diff against the fork point, and no typing into a note the
      // host has pinned to a point in its history.
      draftDiff({ handle, element, adapter: richAdapter }),
      Wordgard.editable.of(!handle.isReadOnly?.()),

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
