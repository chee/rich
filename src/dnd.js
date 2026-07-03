// Parsing of Patchwork sidebar drag payloads. Mirrors the format produced
// by @chee/patchwork-sideboard (patchwork-base/sideboard/src/sideboard/dnd/payload.ts)
// so a document dragged from the sidebar can be dropped into the editor.
import { isValidAutomergeUrl } from "@automerge/automerge-repo"

export const DND_DATA_TYPES = [
  "text/x-patchwork-dnd",
  "text/x-patchwork-urls",
  "text/uri-list",
  "text/plain",
]

export function hasDocumentDrag(dataTransfer) {
  return Boolean(
    dataTransfer &&
      DND_DATA_TYPES.some(type => dataTransfer.types.includes(type)),
  )
}

function urlFromText(text) {
  const trimmed = text.trim()
  if (isValidAutomergeUrl(trimmed)) return trimmed
  // Patchwork web links carry the document id in the fragment: #doc=<id>
  const docId = trimmed.match(/#doc=([^&\s]+)/)?.[1]
  if (docId && isValidAutomergeUrl(`automerge:${docId}`)) {
    return `automerge:${docId}`
  }
  return null
}

// Returns { source, items: [{ url, name?, type? }] } or null.
export function getDndPayload(event) {
  const data = event.dataTransfer
  if (!data) return null

  const dndData = data.getData("text/x-patchwork-dnd")
  if (dndData) {
    try {
      const parsed = JSON.parse(dndData)
      if (Array.isArray(parsed?.items) && parsed.items.length > 0) {
        return { source: parsed.source ?? "", items: parsed.items }
      }
    } catch {
      // fall through
    }
  }

  const urlData = data.getData("text/x-patchwork-urls")
  if (urlData) {
    try {
      const urls = JSON.parse(urlData)
      const items = (Array.isArray(urls) ? urls : [])
        .filter(url => isValidAutomergeUrl(url))
        .map(url => ({ url }))
      if (items.length > 0) return { source: "", items }
    } catch {
      // fall through
    }
  }

  const text = data.getData("text/uri-list") || data.getData("text/plain")
  const items = (text || "")
    .split(/\r?\n/)
    .map(urlFromText)
    .filter(url => url !== null)
    .map(url => ({ url }))
  if (items.length > 0) return { source: "", items }

  return null
}
