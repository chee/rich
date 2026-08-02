// Stand-in for @inkandswitch/patchwork-filesystem outside Patchwork. There is
// no service worker here, so a file doc's URL is resolved to a blob URL from
// the in-memory repo (asynchronously — the <img> src is patched once ready).
const blobs = new Map()

export function automergeUrlToServiceWorkerUrl(url) {
  if (blobs.has(url)) return blobs.get(url)
  blobs.set(url, "")
  resolve(url)
  return ""
}

async function resolve(url) {
  try {
    const handle = await globalThis.repo.find(url)
    const doc = handle.doc()
    const blob = new Blob([doc.content], { type: doc.mimeType })
    const objectUrl = URL.createObjectURL(blob)
    blobs.set(url, objectUrl)
    const roots = [document, ...[...document.querySelectorAll("*")].map(e => e.shadowRoot).filter(Boolean)]
    for (const root of roots) {
      for (const media of root.querySelectorAll('img[src=""], video[src=""], audio[src=""]')) {
        media.src = objectUrl
      }
    }
  } catch (error) {
    console.error("filesystem stub:", error)
  }
}
