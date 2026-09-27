// Images live in the document as Patchwork file documents (UnixFileEntry), not
// as data URLs: pasting, dropping or uploading one creates a `file` doc and the
// editor stores its AutomergeUrl. Only the rendered <img> resolves that to a
// service-worker URL, so the note stays portable between hosts.
import { automergeUrlToServiceWorkerUrl } from "@inkandswitch/patchwork-filesystem"

export function srcForImage(src) {
  if (typeof src !== "string" || !src) return ""
  if (!src.startsWith("automerge:")) return src
  try {
    return automergeUrlToServiceWorkerUrl(src)
  } catch {
    return src
  }
}

function repo() {
  const repo = globalThis.repo
  if (!repo) throw new Error("rich: no repo on window")
  return repo
}

// A UnixFileEntry document, the same shape the sidebar's file drop creates.
export async function createFileDoc(file) {
  const content = new Uint8Array(await file.arrayBuffer())
  const parts = (file.name || "").split(".")
  const extension = parts.length > 1 ? parts.pop() : (file.type.split("/")[1] ?? "bin")
  const name = parts.join(".") || `${(file.type.split("/")[0] || "file")}-${extension}`
  const handle = await repo().create2({
    "@patchwork": { type: "file" },
    content,
    extension,
    mimeType: file.type || "application/octet-stream",
    name,
  })
  return handle.url
}

export const imageFiles = list =>
  Array.from(list || []).filter(file => file.type.startsWith("image/"))

// An <input type=file> click, for the slash command.
export const pickImageFiles = () => pickFiles("image/*").then(imageFiles)

// Any files: lush attaches anything, and the embed draws it by its type.
export function pickFiles(accept = "") {
  return new Promise(resolve => {
    const input = document.createElement("input")
    input.type = "file"
    if (accept) input.accept = accept
    input.multiple = true
    input.style.display = "none"
    document.body.append(input)
    input.addEventListener("change", () => {
      resolve(Array.from(input.files || []))
      input.remove()
    })
    input.addEventListener("cancel", () => {
      resolve([])
      input.remove()
    })
    input.click()
  })
}
