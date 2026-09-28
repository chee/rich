import * as am from "@automerge/automerge"
import { spansFromDoc } from "./wordgard/index.js"
import { Heading } from "wordgard/types"
import { richAdapter } from "./adapter.js"
import { builtinFullIds } from "./plugin-catalog.js"

// The rich tool that lush suggests for its notes, as lush writes it into
// every note's `@patchwork`.
export const SUGGESTED_IMPORT_URL = "automerge:2XoPZihn6Vo2aqeVu2WN39W8cdAN"

const TITLE_CAP = 60

const TABULAR = new Set(["table", "table-row", "table-cell", "table-header-cell", "columns", "column"])

const name = value => (value == null ? "" : typeof value === "string" ? value : (value.val ?? ""))

// Whitespace, but not the characters that end a line.
const edgeSpace = "[^\\S\\n\\r\\v\\f\\u0085\\u2028\\u2029]+"
const titleSpace = new RegExp(`^${edgeSpace}|${edgeSpace}$`, "g")

const graphemes = text => {
  try {
    return [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text)].map(
      part => part.segment,
    )
  } catch {
    return [...text]
  }
}

function titleLine(text) {
  for (const line of text.split(/[\n\r]/)) {
    const trimmed = line.replace(titleSpace, "")
    if (trimmed) return graphemes(trimmed).slice(0, TITLE_CAP).join("")
  }
  return null
}

function titleIn(spans, skipContainers) {
  let line = ""
  let skipping = false
  for (const span of spans) {
    if (span.type === "block") {
      const title = titleLine(line)
      if (title) return title
      line = ""
      const value = span.value ?? {}
      skipping =
        skipContainers &&
        (TABULAR.has(name(value.type)) || (value.parents ?? []).some(p => TABULAR.has(name(p))))
    } else if (!skipping) {
      line += span.value
    }
  }
  return titleLine(line)
}

// The note's title, the way lush derives it: the first line with anything
// on it, up to 60 graphemes, looking past tables and columns unless that
// finds nothing.
export function titleFromSpans(spans) {
  return titleIn(spans, true) ?? titleIn(spans, false) ?? ""
}

// Set a text field collaboratively, and only if it changed. `path` is from
// the document root.
function setText(doc, path, value) {
  const parent = path.slice(0, -1).reduce((object, key) => object?.[key], doc)
  if (parent == null || typeof parent !== "object") return
  const key = path[path.length - 1]
  const current = parent[key]
  if (typeof current === "string") {
    if (current !== value) am.updateText(doc, path, value)
  } else if (current == null || name(current) !== value) {
    parent[key] = value
  }
}

// The title from the editor's document, which is what a write just put in
// `content`: the lines of its top-level blocks in turn, only as far as the
// first one with anything on it. (A line never runs from one top-level
// block into the next, since each starts with a marker of its own.) Reading
// the whole of `content` back instead cost as much as the rest of a
// keystroke on a long note. Only a note with nothing outside its tables and
// columns is read to the end.
function titleFromEditor(written) {
  const lines = node => spansFromDoc(richAdapter, richAdapter.schema.doc([node]))
  for (const skipContainers of [true, false]) {
    for (const node of written.content) {
      const title = titleIn(lines(node), skipContainers)
      if (title) return title
    }
  }
  return ""
}

// Write the derived title into `title` and `@patchwork.title`, as lush does
// on every write. Called inside the change that wrote the content, with the
// editor's document when there is one. Only for notes: a document that merely
// has a rich text field (a blog post, whose title is its own) keeps its
// title.
export function syncTitle(doc, written) {
  const type = name(doc["@patchwork"]?.type)
  if (type !== "rich" && type !== "lush") return
  let title = null
  try {
    if (written) title = titleFromEditor(written)
  } catch {}
  try {
    title ??= titleFromSpans(am.spans(doc, ["content"]))
  } catch {
    return
  }
  setText(doc, ["title"], title)
  setText(doc, ["@patchwork", "title"], title)
}

// A copy of a note as a new document with no shared history, the way the
// site editor duplicates a post: `repo.create` seeded from the source doc.
// Only `content` needs more than that: a materialised doc reads it as a flat
// string, so it is rewritten from the source's spans, which carry the block
// markers and marks.
export function copyNote(repo, source, { title } = {}) {
  const spans = am.spans(source, ["content"])
  const handle = repo.create({ ...plain(source), content: "" })
  handle.change(doc => {
    am.updateSpans(doc, ["content"], spans, richAdapter.updateSpansConfig())
    if (title != null) {
      setText(doc, ["title"], title)
      setText(doc, ["@patchwork", "title"], title)
    }
  })
  return handle
}

// A deep copy of a materialised value, fit to assign into another doc.
function plain(value) {
  if (am.isImmutableString(value)) return new am.ImmutableString(value.val)
  if (value instanceof am.Counter) return new am.Counter(value.value)
  if (value instanceof Date) return new Date(value.getTime())
  if (value instanceof Uint8Array) return new Uint8Array(value)
  if (Array.isArray(value)) return value.map(plain)
  if (value != null && typeof value === "object") {
    const out = {}
    for (const [key, inner] of Object.entries(value)) out[key] = plain(inner)
    return out
  }
  return value
}

// The document model: lush's note. `content` is automerge rich text, `title`
// is derived from it, and `@patchwork` says what it is.
export const RichDatatype = {
  init(doc) {
    doc.title = ""
    doc["@patchwork"] = { type: "rich", title: "", suggestedImportUrl: SUGGESTED_IMPORT_URL }
    doc.content = ""
    // The enabled full-tier plugin ids. Core-tier plugins are always on; the
    // `/plugins` command edits this array.
    doc.plugins = builtinFullIds()
    // Seed a single empty block so every peer starts from the same block
    // structure (avoids two peers concurrently creating a first block). It is a
    // Title so a new note opens ready for one — nothing keeps it that way.
    const seed = richAdapter.schema.doc([Heading.of(1).create([])])
    am.updateSpans(
      doc,
      ["content"],
      spansFromDoc(richAdapter, seed),
      richAdapter.updateSpansConfig(),
    )
  },

  getTitle(doc) {
    const title = name(doc.title)
    if (title) return title
    try {
      return titleFromSpans(am.spans(doc, ["content"])) || "Note"
    } catch {
      return "Note"
    }
  },

  setTitle(doc, title) {
    setText(doc, ["title"], title)
  },

  // Both titles, as every write sets both: the host lists `@patchwork.title`.
  markCopy(doc) {
    const title = "Copy of " + this.getTitle(doc)
    setText(doc, ["title"], title)
    setText(doc, ["@patchwork", "title"], title)
  },

  // A duplicate is a new note, not a fork: see copyNote.
  duplicate(doc, repo) {
    return copyNote(repo, doc)
  },
}
