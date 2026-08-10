// Loading documents written by other editors on this datatype.
//
// The Automerge rich-text schema is shared, but a peer can still write blocks
// this schema doesn't know, or mark a block as an inline embed where our node
// is a block (chee's Swift richtext app writes pasted images as an inline
// `embed`). `docFromSpans` validates strictly and throws, which would leave the
// tool blank on a document that is otherwise perfectly readable — so try the
// spans as they are, then repaired, then as plain text. A note never fails to
// open.
import { docFromSpans } from "./wordgard/index.js"
import { Leaf } from "wordgard/doc"
import { Paragraph } from "wordgard/types"

const blockName = value => {
  const type = value?.type
  return typeof type === "string" ? type : (type?.val ?? "")
}

// Rewrite spans so mapped block markers carry the `isEmbed` flag their
// mapping expects. Unknown blocks and parents pass through unchanged.
export function repairSpans(adapter, spans) {
  const known = name => adapter.nodesForBlock(name)
  return spans.map(span => {
    if (span.type !== "block") return span
    const value = span.value ?? {}
    const name = blockName(value)
    const mapping = known(name)
    const parents = (Array.isArray(value.parents) ? value.parents : [])
      .map(parent => (typeof parent === "string" ? parent : (parent?.val ?? "")))
      .filter(Boolean)
    return {
      type: "block",
      value: {
        ...value,
        type: name || "paragraph",
        parents,
        isEmbed: mapping ? Boolean(mapping.isEmbed) : Boolean(value.isEmbed),
        attrs: value.attrs ?? {},
      },
    }
  })
}

function textOnly(adapter, spans) {
  const paragraphs = [[]]
  for (const span of spans) {
    if (span.type === "block") paragraphs.push([])
    else if (span.value) paragraphs[paragraphs.length - 1].push(span.value)
  }
  return adapter.schema.doc(
    paragraphs
      .filter(parts => parts.length)
      .map(parts => Paragraph.create([Leaf.text(parts.join(""))])),
  )
}

export function docFromSpansCompat(adapter, spans) {
  try {
    return docFromSpans(adapter, spans)
  } catch (error) {
    console.warn("rich: document written by another editor needed repair", error)
  }
  try {
    return docFromSpans(adapter, repairSpans(adapter, spans))
  } catch (error) {
    console.error("rich: falling back to plain text", error)
  }
  return textOnly(adapter, spans)
}
