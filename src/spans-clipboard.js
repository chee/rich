// Clipboard interchange with other automerge rich-text editors (chee's Swift
// notes app, Lush). The selection travels as automerge spans JSON, so blocks
// that html can't carry (embeds, loglines, todo state) survive the trip.
//
// Two carriers, because no browser writes a custom DataTransfer type to the
// pasteboard as itself:
//
// - `org.automerge.richtext` via setData: lands inside the browser's private
//   blob (Chromium's web-custom-data pickle, Firefox's custom-clipdata), which
//   round-trips within that browser with no permissions. Written on every
//   copy; read synchronously on paste.
// - `web application/vnd.inkandswitch.automerge.richtext`, the Clipboard API
//   web custom format: after the copy commits, the clipboard is rewritten
//   asynchronously with the same text/html/spans, which puts the JSON on the
//   OS pasteboard as documented raw types (`org.w3.web-custom-format.map` +
//   `.type-N`) that native apps read and write. Paste falls back to
//   `navigator.clipboard.read()` — permission-free inside a paste gesture —
//   and replays the captured html/text through a synthetic paste event when
//   no spans turn up. Browsers without web custom formats keep the first
//   carrier: the rewrite throws and the pickle stays.
import * as am from "@automerge/automerge"
import { Wordgard } from "wordgard/editor"
import { GardState } from "wordgard/state"
import { spansFromSlice } from "./wordgard/index.js"
import { docFromSpansCompat } from "./compat.js"

export const SPANS_MIME = "org.automerge.richtext"
export const SPANS_WEB_MIME = "application/vnd.inkandswitch.automerge.richtext"
const WEB_FORMAT = `web ${SPANS_WEB_MIME}`

const webFormats = () =>
  typeof ClipboardItem !== "undefined" && ClipboardItem.supports?.(WEB_FORMAT)

const encodeSpans = spans =>
  JSON.stringify(spans, (key, value) =>
    am.isImmutableString(value) ? value.val : value,
  )

const parseSpans = json => {
  try {
    const spans = JSON.parse(json)
    return Array.isArray(spans) && spans.length ? spans : null
  } catch {
    return null
  }
}

async function readWebSpans() {
  try {
    for (const item of await navigator.clipboard.read()) {
      if (item.types.includes(WEB_FORMAT)) {
        return parseSpans(await (await item.getType(WEB_FORMAT)).text())
      }
    }
  } catch {}
  return null
}

export function spansClipboard(adapter) {
  let replaying = false

  function insertSpans(wg, spans) {
    const doc = docFromSpansCompat(adapter, spans)
    const { from, to } = wg.state.selection
    wg.dispatch({
      changes: { from, to, insert: doc.slice(0, doc.length), fit: true },
      scrollIntoView: true,
      userEvent: "input.paste",
    })
  }

  function replay(wg, html, text) {
    replaying = true
    try {
      const data = new DataTransfer()
      if (html) data.setData("text/html", html)
      if (text) data.setData("text/plain", text)
      wg.contentDOM.dispatchEvent(
        new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }),
      )
    } finally {
      replaying = false
    }
  }

  function onCopy(event, wg) {
    const { state } = wg
    if (state.selection.empty || !event.clipboardData) return false
    try {
      const slice = state.doc.slice(state.selection.from, state.selection.to)
      const spans = spansFromSlice(adapter, slice)
      if (spans.length) event.clipboardData.setData(SPANS_MIME, encodeSpans(spans))
    } catch (error) {
      console.warn("rich: selection could not be written as spans", error)
    }
    return false
  }

  function onPaste(event, wg) {
    if (replaying || !event.clipboardData) return false
    const spans = parseSpans(event.clipboardData.getData(SPANS_MIME))
    if (spans) {
      event.preventDefault()
      insertSpans(wg, spans)
      return true
    }
    if (!webFormats() || !navigator.clipboard?.read) return false
    if (event.clipboardData.files?.length) return false
    const html = event.clipboardData.getData("text/html")
    const text = event.clipboardData.getData("text/plain")
    if (!html && !text) return false
    // The web format is invisible to the paste event, and clipboard.write
    // sanitizes the html it republishes (no wordgard markers survive to sniff
    // for) — so any html/text paste may secretly be a spans one. Take it
    // over: when the async read finds no spans, the replay pastes the same
    // html/text through the normal path.
    event.preventDefault()
    readWebSpans().then(found => {
      if (found) insertSpans(wg, found)
      else replay(wg, html, text)
    })
    return true
  }

  // After a copy or cut commits, republish the clipboard through the async
  // API so the spans reach the OS pasteboard as a web custom format. This
  // replaces the whole clipboard, so the text and html written by the editor
  // ride along.
  const republish = Wordgard.Plugin.define(wg => {
    const onCopyOut = event => {
      if (!event.defaultPrevented || !event.clipboardData || !webFormats()) return
      const spans = event.clipboardData.getData(SPANS_MIME)
      if (!spans) return
      const html = event.clipboardData.getData("text/html")
      const text = event.clipboardData.getData("text/plain")
      setTimeout(async () => {
        try {
          await navigator.clipboard.write([
            new ClipboardItem({
              "text/plain": new Blob([text], { type: "text/plain" }),
              "text/html": new Blob([html], { type: "text/html" }),
              [WEB_FORMAT]: new Blob([spans], { type: SPANS_WEB_MIME }),
            }),
          ])
        } catch {}
      })
    }
    const connect = () => {
      wg.dom.addEventListener("copy", onCopyOut)
      wg.dom.addEventListener("cut", onCopyOut)
    }
    const disconnect = () => {
      wg.dom.removeEventListener("copy", onCopyOut)
      wg.dom.removeEventListener("cut", onCopyOut)
    }
    return { connect, disconnect, remove: disconnect }
  }).extension

  return [
    republish,
    GardState.prec.highest([
      Wordgard.domEventHandler("copy", onCopy),
      Wordgard.domEventHandler("cut", onCopy),
      Wordgard.domEventHandler("paste", onPaste),
    ]),
  ]
}
