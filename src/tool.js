import * as am from "@automerge/automerge"
import { Wordgard, menuBar } from "wordgard/editor"
import { history } from "wordgard/history"
import {
  blockDoc,
  paragraph,
  heading,
  blockquote,
  codeBlock,
  bulletList,
  orderedList,
  image,
  strong,
  emphasis,
  code,
  link,
} from "wordgard/schema"
import { GardState } from "wordgard/state"
import { automergeSyncPlugin, docFromSpans } from "@automerge/wordgard"
import { richAdapter, Embed } from "./adapter.js"
import { getDndPayload, hasDocumentDrag } from "./dnd.js"
import "./rich.css"

// The render contract: (handle, element) => cleanup.
export default function RichTool(handle, element) {
  element.classList.add("rich-tool")

  const initialDoc = docFromSpans(
    richAdapter,
    am.spans(handle.doc(), ["content"]),
  )

  const editor = Wordgard.create({
    parent: element,
    doc: initialDoc,
    config: [
      // The embed leaf type (basic editing types come from the bundles below).
      GardState.schemaElement.of(Embed),

      // Editing behaviour for exactly the node/mark types the adapter maps,
      // so the user can only create content that round-trips to Automerge.
      blockDoc(),
      paragraph(),
      heading(),
      blockquote(),
      codeBlock(),
      bulletList(),
      orderedList(),
      image(),
      strong(),
      emphasis(),
      code(),
      link(),

      history(),
      menuBar(),

      // Keep the editor in sync with the Automerge `content` field.
      automergeSyncPlugin({ adapter: richAdapter, handle, path: ["content"] }),

      // Fill the tool's bounded box and scroll internally.
      Wordgard.scrolling("100%"),

      // Embed a Patchwork document dropped from the sidebar.
      GardState.prec.highest(Wordgard.domEventHandler("dragover", onDragOver)),
      GardState.prec.highest(Wordgard.domEventHandler("drop", onDrop)),
    ],
  })

  function onDragOver(event) {
    if (!hasDocumentDrag(event.dataTransfer)) return false
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy"
    return false // allow Wordgard to also show its drop cursor
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

    const inserts = payload.items.map(item => Embed.of(item.url))
    wg.dispatch({
      changes: { from: pos, insert: inserts, fit: true },
      scrollIntoView: true,
    })
    return true
  }

  return () => {
    element.classList.remove("rich-tool")
    editor.dom.remove()
  }
}
