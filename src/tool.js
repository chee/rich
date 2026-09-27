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
import { lushTrigger, restyleTriggers } from "./triggers.js"
import { registerFonts } from "./fonts.js"
import { dropExcludedMarks } from "./excluded-marks.js"
import "./rich.css"

// Lush's markdown triggers: `-` or `*` for a bullet, `1.` for a number, `#`
// to `###` for Title, Heading and Subheading, `>` for a quote (the to-do
// brackets are in todo-list.js). The schema bundles' own versions of these
// only fire on empty lines; these fire on a line with content after the
// cursor too.
// Inside a list or a quote they replace the block's style, as lush's do (see
// triggers.js).
const convertOnPrefix = [
  lushTrigger(InputRule.textblockType(/^(#{1,3}) $/, match => Heading.of(match[1].text.length)), match => ({
    id: `h${match[1].text.length}`,
  })),
  lushTrigger(InputRule.wrapping(/^> $/, Blockquote), () => ({ id: "quote" })),
  lushTrigger(InputRule.wrapping(/^ ?[-*] $/, BulletList), () => ({ id: "bullet" })),
  lushTrigger(InputRule.wrapping(/^ ?(\d+)\. $/, match => OrderedList.of(+match[1].text)), () => ({ id: "ordered" })),
]

// Lush's colours come in a light and a dark set (rich.css picks with
// light-dark()). With no theme of the host's, the page follows the system. A
// host that paints its own fill (Patchwork's and the site editor's
// --editor-fill) decides instead: a dark fill gets the dark set, so the cards,
// highlights and marks stay readable on it.
function followHostScheme(element) {
  const canvas = document.createElement("canvas")
  canvas.width = canvas.height = 1
  const paint = canvas.getContext("2d", { willReadFrequently: true })
  const sync = () => {
    const host = getComputedStyle(element).getPropertyValue("--editor-fill").trim()
    if (!host || !paint) {
      element.style.removeProperty("color-scheme")
      return
    }
    paint.clearRect(0, 0, 1, 1)
    paint.fillStyle = "#fff"
    paint.fillStyle = host
    paint.fillRect(0, 0, 1, 1)
    const [r, g, b] = paint.getImageData(0, 0, 1, 1).data
    const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
    element.style.colorScheme = luminance < 0.5 ? "dark" : "light"
  }
  sync()
  const media = matchMedia("(prefers-color-scheme: dark)")
  media.addEventListener?.("change", sync)
  // Hosts switch themes with a class or attribute on the root or the body.
  const observer = new MutationObserver(sync)
  for (const node of [document.documentElement, document.body, element.parentElement].filter(Boolean)) {
    observer.observe(node, { attributes: true, attributeFilter: ["class", "style", "theme", "data-theme"] })
  }
  return () => {
    media.removeEventListener?.("change", sync)
    observer.disconnect()
  }
}

// The render contract: (handle, element) => cleanup.
export default function RichTool(handle, element) {
  element.classList.add("rich-tool")
  registerFonts()
  const stopScheme = followHostScheme(element)

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

      // ahead of the schema bundles' own rules, which nest in a list
      GardState.prec.highest(convertOnPrefix.map(rule => rule.extension)),
      restyleTriggers,
      dropExcludedMarks,

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

      // A key command's change reaches the DOM on the next animation frame.
      // Typing that lands before then is read against the old DOM: after
      // select-all and Backspace, the browser still has the whole old note
      // selected, and the first letter went into a paragraph of its own. So
      // bring the DOM up to date as soon as a key has changed the note.
      Wordgard.domEventObserver("keydown", (event, wg) => {
        if (event.isComposing || event.keyCode === 229) return
        const before = wg.state
        queueMicrotask(() => {
          if (wg.state !== before && !wg.inputState?.composing) wg.flush()
        })
      }),

      featureConfig.of(extensions()),
    ],
  })

  // Handle for embedders (and the dev harness) that want to drive the editor.
  page.wordgard = editor

  return () => {
    stopScheme()
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
