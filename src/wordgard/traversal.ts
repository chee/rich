import { Plot, Leaf, Node, Mark, Slice, Token } from "wordgard/doc"
import * as am from "@automerge/automerge"
import {
  SchemaAdapter,
  BlockMarker,
  amMarksFromMarks,
  marksFromAmMarks,
} from "./schema.js"

// ---------------------------------------------------------------------------
// Span helpers
// ---------------------------------------------------------------------------

type Span =
  | { type: "text"; value: string; marks: am.MarkSet }
  | { type: "block"; value: BlockMarker }

function hasInlineContent(type: Node.Type): boolean {
  return type instanceof Plot.Type && type.inlineContent
}

// Append a node to a content array, merging adjacent text leaves that
// share the same marks (the public equivalent of Node.pushTo).
function appendNode(content: Node[], node: Node): void {
  if (node.is(Leaf.Text) && content.length) {
    const prev = content[content.length - 1]
    if (prev.is(Leaf.Text) && Mark.sameSet(prev.marks, node.marks)) {
      content[content.length - 1] = Leaf.text(prev.param + node.param, node.marks)
      return
    }
  }
  content.push(node)
}

// Create the default child node for a plot type (the public equivalent
// of Schema.createDefault).
function createDefault(adapter: SchemaAdapter, type: Plot.Type): Node {
  const tag = adapter.schema.defaultContentTag(type)
  if (tag == null) throw new Error(`No default child for ${type.name}`)
  return adapter.schema.createAndFill(tag)
}

function normalizeBlock(value: {
  [key: string]: am.MaterializeValue
}): BlockMarker {
  const type = am.isImmutableString(value.type)
    ? value.type
    : new am.ImmutableString(
        typeof value.type === "string" ? value.type : "paragraph",
      )
  const parents = Array.isArray(value.parents)
    ? (value.parents
        .map(p =>
          am.isImmutableString(p)
            ? p
            : typeof p === "string"
              ? new am.ImmutableString(p)
              : null,
        )
        .filter(p => p != null) as am.ImmutableString[])
    : []
  const attrs: { [key: string]: am.MaterializeValue } = {}
  if (value.attrs && typeof value.attrs === "object") {
    for (const [k, v] of Object.entries(value.attrs)) attrs[k] = v
  }
  return { type, parents, attrs, isEmbed: !!value.isEmbed }
}

// ---------------------------------------------------------------------------
// doc -> spans
// ---------------------------------------------------------------------------

/// Convert a wordgard document into the array of Automerge spans that
/// represents it.
export function spansFromDoc(
  adapter: SchemaAdapter,
  doc: Plot.Doc,
): am.Span[] {
  const spans: Span[] = []
  const content = doc.content
  content.forEach((node, i) => walk(adapter, node, [], i, spans))
  return spans as am.Span[]
}

/// Convert a slice of a document (e.g. clipboard content) into Automerge
/// spans. Plots cut open at the slice edges contribute their content without
/// a marker of their own: text before the first block marker, the way spans
/// describe a partial range.
export function spansFromSlice(
  adapter: SchemaAdapter,
  slice: Slice,
): am.Span[] {
  const stack: Frame[] = [{ tag: null, content: [] }]
  const top = () => stack[stack.length - 1]
  const closeTop = () => {
    const frame = stack.pop()!
    const tag = frame.tag as Plot.Tag
    const content =
      frame.content.length || tag.type.canBeEmpty
        ? frame.content
        : [createDefault(adapter, tag.type)]
    appendNode(top().content, tag.create(content))
  }
  for (const token of slice.content) {
    if (token.tokenType === Token.Type.Open) {
      stack.push({ tag: token as Plot.Tag, content: [] })
    } else if (token.tokenType === Token.Type.Close) {
      if (stack.length > 1) closeTop()
    } else {
      appendNode(top().content, token as Node)
    }
  }
  while (stack.length > 1) closeTop()
  const spans: Span[] = []
  stack[0].content.forEach((node, i) => walk(adapter, node, [], i, spans))
  return spans as am.Span[]
}

function walk(
  adapter: SchemaAdapter,
  node: Node,
  nodePath: Plot[],
  index: number,
  spans: Span[],
) {
  if (node.is(Leaf.Text)) {
    spans.push({
      type: "text",
      value: node.param,
      marks: amMarksFromMarks(adapter, node.marks),
    })
    return
  }

  const parent = nodePath.length ? nodePath[nodePath.length - 1] : null
  const parentType = parent ? parent.type : null

  if (node.isLeaf) {
    const blockName = adapter.blockNameForNode(node.type, parentType)
    if (blockName != null) {
      const mapping = adapter.mappingForNode(node.type)
      spans.push({
        type: "block",
        value: makeBlock(
          adapter,
          node,
          blockName,
          nodePath,
          mapping?.isEmbed || false,
        ),
      })
    }
    return
  }

  // Plot node.
  const blockName = adapter.blockNameForNode(node.type, parentType)
  let emit = false
  if (blockName != null) {
    if (node.type.inlineContent) {
      emit = !isRenderOnlyTextblock(adapter, node, parent, index)
    } else {
      emit = containerEmits(adapter, node)
    }
  }
  if (emit && blockName != null) {
    spans.push({
      type: "block",
      value: makeBlock(adapter, node, blockName, nodePath, false),
    })
  }

  const childPath = nodePath.concat(node)
  node.content.forEach((c, i) => walk(adapter, c, childPath, i, spans))
}

// A textblock is render-only (represented implicitly, via its parent's
// block marker) when it is the default first child of a mapped block
// container.
function isRenderOnlyTextblock(
  adapter: SchemaAdapter,
  node: Node,
  parent: Plot | null,
  index: number,
): boolean {
  if (parent == null || index !== 0) return false
  // Only when it is the container's *only* child. The implicit child is
  // materialised on the way back by the content that follows the container's
  // marker, so with siblings around it an empty or non-default first child
  // (the first cell of a table row, a blank first line in a column) would be
  // lost.
  if (parent.content.length !== 1) return false
  if (adapter.mappingForNode(parent.type) == null) return false
  const def = adapter.schema.defaultContentTag(parent.type)
  return def != null && def.type === node.type
}

// A mapped block container always emits its own marker: that marker is what
// opens it on the way back, and it is the only thing that marks where one
// container ends and the next begins (a list item holding a column layout, a
// table row of empty cells). Containers with no mapping of their own — a
// bullet list, say — still ride along in their children's `parents`.
function containerEmits(adapter: SchemaAdapter, node: Plot): boolean {
  return adapter.mappingForNode(node.type) != null
}

function makeBlock(
  adapter: SchemaAdapter,
  node: Node,
  blockName: string,
  nodePath: Plot[],
  isEmbed: boolean,
): BlockMarker {
  const mapping = adapter.mappingForNode(node.type)
  const rawAttrs = mapping?.attrs ? mapping.attrs.fromWordgard(node) : {}
  const attrs: { [key: string]: am.MaterializeValue } = {}
  for (const [k, v] of Object.entries(rawAttrs)) {
    if (v !== undefined) attrs[k] = v
  }
  return {
    type: new am.ImmutableString(blockName),
    parents: findParents(adapter, nodePath).map(n => new am.ImmutableString(n)),
    attrs,
    isEmbed,
  }
}

function findParents(adapter: SchemaAdapter, nodePath: Plot[]): string[] {
  const parents: string[] = []
  for (let i = 0; i < nodePath.length; i++) {
    const p = nodePath[i]
    const pParent = i > 0 ? nodePath[i - 1].type : null
    const name = adapter.blockNameForNode(p.type, pParent)
    if (name != null) parents.push(name)
  }
  return parents
}

// ---------------------------------------------------------------------------
// spans -> doc
// ---------------------------------------------------------------------------

type Frame = { tag: Plot.Tag | null; content: Node[] }

type OuterNode = { type: Plot.Type; param?: unknown; marks?: Mark.Set }

/// Build a wordgard document from an array of Automerge spans.
export function docFromSpans(
  adapter: SchemaAdapter,
  amSpans: am.Span[],
): Plot.Doc {
  const schema = adapter.schema
  const docType = schema.docTag.type
  const stack: Frame[] = [{ tag: null, content: [] }]

  const top = () => stack[stack.length - 1]

  const openPlot = (tag: Plot.Tag) => stack.push({ tag, content: [] })

  const closeTop = () => {
    const frame = stack.pop()!
    const type = (frame.tag as Plot.Tag).type
    const content =
      frame.content.length || type.canBeEmpty
        ? frame.content
        : [createDefault(adapter, type)]
    const node = (frame.tag as Plot.Tag).create(content)
    appendNode(top().content, node)
  }

  const topType = (): Plot.Type =>
    stack.length === 1 ? docType : (top().tag as Plot.Tag).type

  const ensureInline = () => {
    if (topType().inlineContent) return
    const wrap = schema.findWrapping(topType(), Leaf.Text)
    if (wrap == null) {
      throw new Error(
        `Cannot place inline content inside ${topType().name}`,
      )
    }
    for (const tag of wrap) openPlot(tag)
  }

  const appendText = (value: string, marks: Mark.Set) => {
    ensureInline()
    appendNode(top().content, Leaf.text(value, marks))
  }

  const emitBlock = (block: BlockMarker) => {
    const nodes = adapter.nodesForBlock(block.type.val)

    // Inline embed: place a leaf inside the current textblock.
    if (block.isEmbed || (nodes != null && nodes.isEmbed)) {
      if (nodes == null) return // unknown embed: drop
      ensureInline()
      const { param, marks } = nodes.attrs
        ? nodes.attrs.fromAutomerge(block)
        : {}
      const leaf = makeLeaf(nodes.content as Leaf.Type, param, marks)
      appendNode(top().content, leaf)
      return
    }

    const outer = outerNodeTypes(adapter, block)

    // Reconcile the open stack with the desired wrapper chain, sharing
    // a common prefix by type.
    const open = stack.slice(1)
    let i = 0
    while (
      i < outer.length &&
      i < open.length &&
      (open[i].tag as Plot.Tag).type === outer[i].type
    ) {
      i++
    }
    while (stack.length - 1 > i) closeTop()
    for (let j = i; j < outer.length; j++) {
      openPlot(makePlotTag(outer[j].type, outer[j].param, outer[j].marks))
    }

    if (nodes == null) {
      // Unknown structural block: fall back to a default textblock so
      // that the following text is preserved.
      ensureInline()
      return
    }

    const { param, marks } = nodes.attrs ? nodes.attrs.fromAutomerge(block) : {}
    if (nodes.content instanceof Plot.Type) {
      openPlot(makePlotTag(nodes.content, param, marks))
    } else {
      // A block-level leaf node (e.g. a horizontal rule or an embed).
      appendNode(top().content, makeLeaf(nodes.content as Leaf.Type, param, marks))
    }
  }

  for (const raw of amSpans) {
    if (raw.type === "block") {
      emitBlock(normalizeBlock(raw.value as { [key: string]: am.MaterializeValue }))
    } else {
      appendText(raw.value, marksFromAmMarks(adapter, raw.marks))
    }
  }

  while (stack.length > 1) closeTop()

  const content = stack[0].content
  if (content.length === 0 && !docType.canBeEmpty) {
    return schema.doc([createDefault(adapter, docType)])
  }
  return schema.doc(content)
}

function outerNodeTypes(
  adapter: SchemaAdapter,
  block: BlockMarker,
): OuterNode[] {
  const result: OuterNode[] = []
  for (const parent of block.parents) {
    const bn = adapter.nodesForBlock(parent.val)
    if (bn == null) continue
    if (bn.outer != null) result.push({ type: bn.outer })
    if (bn.content instanceof Plot.Type) result.push({ type: bn.content })
  }
  const self = adapter.nodesForBlock(block.type.val)
  if (self != null && self.outer != null) result.push({ type: self.outer })
  return result
}

function makePlotTag(
  type: Plot.Type,
  param: unknown,
  marks: Mark.Set | undefined,
): Plot.Tag {
  const p = param !== undefined ? param : type.default ? type.default.param : null
  return type.of(p, marks ?? Mark.none)
}

function makeLeaf(
  type: Leaf.Type,
  param: unknown,
  marks: Mark.Set | undefined,
): Leaf {
  const p = param !== undefined ? param : type.default ? type.default.param : null
  return type.of(p, marks ?? Mark.none)
}
