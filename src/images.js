// Getting images into the document: paste, drop from the desktop, or pick a
// file. Each one becomes a Patchwork file document; the editor inserts an image
// block holding that document's AutomergeUrl.
import { Wordgard } from "wordgard/editor"
import { GardState } from "wordgard/state"
import { LushImage } from "./adapter.js"
import { createFileDoc, imageFiles, pickImageFiles } from "./files.js"

// Create the file docs, then insert them as image blocks at `pos`. The
// insertion happens after an await, so the position is a starting guess — it is
// clamped to the document as it is by then.
export async function insertImageFiles(wg, files, pos) {
  const urls = []
  for (const file of files) {
    try {
      urls.push(await createFileDoc(file))
    } catch (error) {
      console.error("lush: could not store image", error)
    }
  }
  if (!urls.length) return
  const at = Math.min(pos ?? wg.state.selection.head, wg.state.doc.contentLength)
  wg.dispatch({
    changes: { from: at, insert: urls.map(url => LushImage.of(url)), fit: true },
    scrollIntoView: true,
  })
  wg.focus()
}

export async function uploadImage(wg) {
  const files = await pickImageFiles()
  if (files.length) await insertImageFiles(wg, files, wg.state.selection.head)
}

export function insertImageUrl(wg, src) {
  wg.dispatch({
    changes: { from: wg.state.selection.head, insert: [LushImage.of(src)], fit: true },
    scrollIntoView: true,
  })
  wg.focus()
}

function onPaste(event, wg) {
  const files = imageFiles(event.clipboardData?.files)
  if (!files.length) return false
  event.preventDefault()
  insertImageFiles(wg, files, wg.state.selection.head)
  return true
}

function onDrop(event, wg) {
  const files = imageFiles(event.dataTransfer?.files)
  if (!files.length) return false
  event.preventDefault()
  let pos
  try {
    pos = wg.posAtCoords({ x: event.clientX, y: event.clientY }).pos
  } catch {
    pos = wg.state.selection.head
  }
  insertImageFiles(wg, files, pos)
  return true
}

function onDragOver(event) {
  if (!Array.from(event.dataTransfer?.types || []).includes("Files")) return false
  event.preventDefault()
  event.dataTransfer.dropEffect = "copy"
  return false
}

export function imageDropAndPaste() {
  return GardState.prec.highest([
    Wordgard.domEventHandler("paste", onPaste),
    Wordgard.domEventHandler("dragover", onDragOver),
    Wordgard.domEventHandler("drop", onDrop),
  ])
}
