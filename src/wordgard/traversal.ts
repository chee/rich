import { Plot, Leaf, Node, Mark, Slice, Token } from "wordgard/doc"
import * as am from "@automerge/automerge"
import {
  SchemaAdapter,
  BlockMarker,
  BlockExtras,
  UnknownBlock,
  UnknownEmbed,
  amMarksFromMarks,
  decodeAttrs,
  encodeAttrs,
  marksFromAmMarks,
} from "./schema.js"

/// A soft line break inside a block: the Swift app's NSTextView writes
/// U+2028 LINE SEPARATOR, which the editor shows as a line break leaf.
export const LINE_SEPARATOR = "\u2028"

// The block names that nest as a table's or a column layout's cells. The
// Swift app writes `table-cell` in the parents of blocks inside a header
// cell too, so as a parent the two mean "the cell this block is in".
const CELL_BLOCKS = ["table-cell", "table-header-cell"]

const isLineBreak = (adapter: SchemaAdapter, node: Node) =>
  node.isLeaf && adapter.schema.lineBreak != null && node.type === adapter.schema.lineBreak.type

// The code block a line break (or a newline) splits into another marker.
const isCodeBlock = (adapter: SchemaAdapter, plot: Plot | null) =>
  plot != null && adapter.blockNameForNode(plot.type, null) === "code-block"

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
    // sorted: automerge hands them over in no particular order
    const given = value.attrs as { [key: string]: am.MaterializeValue }
    for (const k of Object.keys(given).sort()) attrs[k] = given[k]
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
  if (node.is(UnknownBlock) || node.is(UnknownEmbed)) {
    spans.push({ type: "block", value: node.param })
    return
  }

  const parent = nodePath.length ? nodePath[nodePath.length - 1] : null
  const parentType = parent ? parent.type : null
  const parentBlock = parentType ? adapter.blockNameForNode(parentType, null) : null

  if (node.is(Leaf.Text)) {
    const marks = amMarksFromMarks(adapter, node.marks, parentBlock)
    if (isCodeBlock(adapter, parent) && node.param.includes("\n")) {
      // One marker per line in a code block, the way the Swift app writes
      // them. A newline typed as text (no line break leaf) is a line too.
      node.param.split("\n").forEach((part, i) => {
        if (i > 0) spans.push({ type: "block", value: codeLine(adapter, parent!, nodePath) })
        if (part) spans.push({ type: "text", value: part, marks })
      })
      return
    }
    spans.push({ type: "text", value: node.param, marks })
    return
  }

  if (isLineBreak(adapter, node)) {
    if (isCodeBlock(adapter, parent)) {
      spans.push({ type: "block", value: codeLine(adapter, parent!, nodePath) })
    } else {
      spans.push({
        type: "text",
        value: LINE_SEPARATOR,
        marks: amMarksFromMarks(adapter, node.marks, parentBlock),
      })
    }
    return
  }

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
  const emit = blockName != null && emits(adapter, node, parent, index)
  if (emit && blockName != null) {
    spans.push({
      type: "block",
      value: makeBlock(adapter, node, blockName, nodePath, false),
    })
  }

  const childPath = nodePath.concat(node)
  node.content.forEach((c, i) => walk(adapter, c, childPath, i, spans))
}

// The marker a code block's next line starts with: the block's own.
function codeLine(adapter: SchemaAdapter, block: Plot, nodePath: Plot[]): BlockMarker {
  const outer = nodePath.slice(0, -1)
  const grand = outer.length ? outer[outer.length - 1].type : null
  return makeBlock(adapter, block, adapter.blockNameForNode(block.type, grand)!, outer, false)
}

// Whether a mapped plot writes a marker of its own. Both the span writer and
// the index map ask this, so they always agree.
function emits(adapter: SchemaAdapter, node: Plot, parent: Plot | null, index: number): boolean {
  if (node.type.inlineContent) {
    return !isRenderOnlyTextblock(adapter, node, parent, index) && !startsWithUnknownStructuralBlock(node)
  }
  // A list item that holds only a nested list (lush lets any item nest,
  // the first one too) has no line of its own: its nested items' parents
  // open it again on the way back.
  if (isBareListItem(adapter, node)) return false
  return containerEmits(adapter, node)
}

function isBareListItem(adapter: SchemaAdapter, node: Plot): boolean {
  const mapping = adapter.mappingForNode(node.type)
  if (mapping?.within == null) return false
  const first = node.content[0]
  return first != null && !first.isLeaf && first.type.hasRole(Node.Role.List)
}

function startsWithUnknownStructuralBlock(node: Plot): boolean {
  const first = node.content[0]
  return first?.is(UnknownBlock) === true && !first.param.isEmbed
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
  if (adapter.mappingForNode(parent.type) == null) return false
  const def = adapter.schema.defaultContentTag(parent.type)
  if (def == null || def.type !== node.type) return false
  // A cell's or a column's first paragraph with attrs of its own (an indent)
  // needs a marker to hold them. (A list item's or a quote's first line is
  // the container's own marker, which holds what that line has.)
  if (!node.isLeaf && CELL_BLOCKS.concat("column").includes(adapter.blockNameForNode(parent.type, null) ?? "") && hasOwnAttrs(adapter, node as Plot)) return false
  if (node.content.length > 0) return true
  // Only when it is the container's *only* child. The implicit child is
  // materialised on the way back by the content that follows the container's
  // marker, so with siblings around it an empty or non-default first child
  // (the first cell of a table row, a blank first line in a column) would be
  // lost.
  if (parent.content.length !== 1) return false
  return true
}

// Whether a block has attrs a marker would carry.
function hasOwnAttrs(adapter: SchemaAdapter, node: Plot): boolean {
  if (BlockExtras.isInSet(node.marks)) return true
  const attrs = adapter.mappingForNode(node.type)?.attrs?.fromWordgard(node) ?? {}
  return Object.values(attrs).some(value => value !== undefined)
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
  // Whatever this schema doesn't model goes back as it came.
  const extras = BlockExtras.isInSet(node.marks)
  if (extras) {
    try {
      Object.assign(attrs, decodeAttrs(JSON.parse(extras.value)))
    } catch {
      // unreadable extras are none
    }
  }
  for (const [k, v] of Object.entries(rawAttrs)) {
    if (v === undefined) continue
    // Strings as Str scalars, the way the Swift app writes them: a JS
    // string would be stored as collaborative text, and each editor would
    // rewrite the other's block on every save.
    attrs[k] = typeof v === "string" ? new am.ImmutableString(v) : v
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
    if (name != null) parents.push(name === "table-header-cell" ? "table-cell" : name)
  }
  return parents
}

// ---------------------------------------------------------------------------
// doc positions <-> automerge indexes
// ---------------------------------------------------------------------------

/// One entry per element of the Automerge text sequence the document
/// round-trips to — a block marker or a single character — in document
/// order. `pos` is the wordgard position of the atom that produced it,
/// so the array index of an entry is its Automerge index.
export type IndexUnit = { pos: number; kind: "open" | "leaf" | "char" }

export function indexUnits(adapter: SchemaAdapter, doc: Plot.Doc): IndexUnit[] {
  const units: IndexUnit[] = []
  let pos = 0
  const walkNode = (node: Node, nodePath: Plot[], index: number) => {
    const parent = nodePath.length ? nodePath[nodePath.length - 1] : null
    const parentType = parent ? parent.type : null
    if (node.is(Leaf.Text)) {
      const text = node.param
      const code = isCodeBlock(adapter, parent)
      for (let i = 0; i < text.length; i++) {
        // a newline in a code block is a block marker in automerge
        units.push({ pos: pos++, kind: code && text[i] === "\n" ? "open" : "char" })
      }
      return
    }
    if (isLineBreak(adapter, node)) {
      units.push({ pos, kind: isCodeBlock(adapter, parent) ? "open" : "leaf" })
      pos++
      return
    }
    if (node.is(UnknownBlock) || node.is(UnknownEmbed)) {
      units.push({ pos, kind: "leaf" })
      pos++
      return
    }
    if (node.isLeaf) {
      if (adapter.blockNameForNode(node.type, parentType) != null) {
        units.push({ pos, kind: "leaf" })
      }
      pos++
      return
    }
    const blockName = adapter.blockNameForNode(node.type, parentType)
    if (blockName != null && emits(adapter, node, parent, index)) units.push({ pos, kind: "open" })
    pos++
    const childPath = nodePath.concat(node)
    node.content.forEach((c, i) => walkNode(c, childPath, i))
    pos++
  }
  doc.content.forEach((node, i) => walkNode(node, [], i))
  return units
}

/// The Automerge index of a wordgard position: the number of sequence
/// elements before it.
export function indexFromPos(units: IndexUnit[], pos: number): number {
  let lo = 0
  let hi = units.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (units[mid].pos < pos) lo = mid + 1
    else hi = mid
  }
  return lo
}

/// The wordgard position where a cursor at the given Automerge index
/// should be drawn. A cursor on a block marker lands at the start of
/// that block's content; past the end, after the last element.
export function posFromIndex(units: IndexUnit[], index: number): number {
  if (index >= units.length) {
    return units.length ? units[units.length - 1].pos + 1 : 0
  }
  const unit = units[index]
  return unit.kind === "open" ? unit.pos + 1 : unit.pos
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
  const lineBreak = schema.lineBreak

  const cellTypes = new Set<Node.Type>()
  for (const name of CELL_BLOCKS) {
    const nodes = adapter.nodesForBlock(name)
    if (nodes) cellTypes.add(nodes.content)
  }
  const sameType = (a: Node.Type, b: Node.Type) =>
    a === b || (cellTypes.has(a) && cellTypes.has(b))

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

  const inCode = () =>
    stack.length > 1 && adapter.blockNameForNode(topType(), null) === "code-block"

  const appendText = (value: string, marks: Mark.Set) => {
    ensureInline()
    // Soft line breaks (and, in a code block, newlines left by an older
    // encoding) become line break leaves.
    const breaks = new RegExp(inCode() ? "[\\n\\u2028]" : "\\u2028")
    const parts = lineBreak ? value.split(breaks) : [value]
    parts.forEach((part, i) => {
      if (i > 0) appendNode(top().content, lineBreak!.withMarks(inCode() ? Mark.none : marks))
      if (part) appendNode(top().content, Leaf.text(part, marks))
    })
  }

  // Close and open plots until the open stack is the given wrapper chain,
  // sharing a common prefix by type.
  const reconcile = (outer: OuterNode[]) => {
    const open = stack.slice(1)
    let i = 0
    while (
      i < outer.length &&
      i < open.length &&
      sameType((open[i].tag as Plot.Tag).type, outer[i].type)
    ) {
      i++
    }
    while (stack.length - 1 > i) closeTop()
    for (let j = i; j < outer.length; j++) {
      openPlot(makePlotTag(outer[j].type, outer[j].param, outer[j].marks))
    }
  }

  const isTextblockName = (name: string) => {
    const nodes = adapter.nodesForBlock(name)
    return nodes != null && nodes.content instanceof Plot.Type && nodes.content.inlineContent
  }

  // The node's param and marks, with the attrs the mapping doesn't own
  // riding along as extras.
  const nodeAttrs = (
    nodes: NonNullable<ReturnType<SchemaAdapter["nodesForBlock"]>>,
    block: BlockMarker,
  ) => {
    const read = nodes.attrs ? nodes.attrs.fromAutomerge(block) : {}
    let marks = read.marks ?? Mark.none
    if (nodes.owns !== "*") {
      const extra: { [key: string]: am.MaterializeValue } = {}
      let any = false
      for (const [k, v] of Object.entries(block.attrs)) {
        if (nodes.owns.includes(k) || v === undefined) continue
        extra[k] = v
        any = true
      }
      if (any) marks = BlockExtras.of(JSON.stringify(encodeAttrs(extra))).addToSet(marks)
    }
    return { param: read.param, marks }
  }

  const emitBlock = (block: BlockMarker) => {
    const nodes = adapter.nodesForBlock(block.type.val)
    const embed = nodes ? nodes.isEmbed : block.isEmbed

    // An embed is a line of its own. Older versions of this editor wrote
    // them inside a paragraph (with the paragraph in their parents); the
    // empty paragraph that held one goes, and the rest of the paragraph
    // carries on after it.
    if (embed) {
      const legacy = block.parents.some(p => isTextblockName(p.val))
      if (legacy) {
        const frame = top()
        if (stack.length > 1 && topType().inlineContent && frame.content.length === 0) stack.pop()
      }
      const parents = block.parents.filter(p => !isTextblockName(p.val))
      reconcile(outerNodeTypes(adapter, parents, null))
      let leaf: Node
      if (nodes == null || !(nodes.content instanceof Leaf.Type)) {
        leaf = UnknownEmbed.of(block)
      } else {
        const { param, marks } = nodeAttrs(nodes, block)
        leaf = makeLeaf(nodes.content as Leaf.Type, param, marks)
      }
      while (stack.length > 1 && !schema.canContain(topType(), leaf.type)) closeTop()
      appendNode(top().content, leaf)
      return
    }

    const outer = outerNodeTypes(adapter, block.parents, block)

    // The next line of a code block: the Swift app writes a marker per
    // line, the editor holds the block whole.
    if (nodes != null && block.type.val === "code-block" && inCode()) {
      const open = stack.slice(1, -1)
      const { param, marks } = nodeAttrs(nodes, block)
      const tag = top().tag as Plot.Tag
      if (
        open.length === outer.length &&
        open.every((frame, i) => sameType((frame.tag as Plot.Tag).type, outer[i].type)) &&
        Mark.sameSet(tag.marks, marks) &&
        (param === undefined || param === tag.param)
      ) {
        appendNode(top().content, lineBreak ? lineBreak : Leaf.text("\n"))
        return
      }
    }

    reconcile(outer)

    if (nodes == null) {
      while (stack.length > 1) closeTop()
      ensureInline()
      appendNode(top().content, UnknownBlock.of(block))
      return
    }

    const { param, marks } = nodeAttrs(nodes, block)
    if (nodes.content instanceof Plot.Type) {
      openPlot(makePlotTag(nodes.content, param, marks))
    } else {
      appendNode(top().content, makeLeaf(nodes.content as Leaf.Type, param, marks))
    }
  }

  // Blocks the Swift app used to write as their own types, and now writes
  // as a paragraph with a font mark on its text.
  let blockFont: string | null = null

  for (const raw of amSpans) {
    if (raw.type === "block") {
      let block = normalizeBlock(raw.value as { [key: string]: am.MaterializeValue })
      blockFont = null
      const name = block.type.val
      if ((name === "serif" || name === "hand") && adapter.nodesForBlock(name) == null) {
        blockFont = name
        block = { ...block, type: new am.ImmutableString("paragraph") }
      }
      emitBlock(block)
    } else {
      const amMarks = blockFont && !(raw.marks && "font" in raw.marks)
        ? { ...raw.marks, font: blockFont }
        : raw.marks
      appendText(raw.value, marksFromAmMarks(adapter, amMarks))
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
  parents: am.ImmutableString[],
  block: BlockMarker | null,
): OuterNode[] {
  const result: OuterNode[] = []
  for (const parent of parents) {
    const bn = adapter.nodesForBlock(parent.val)
    if (bn == null) continue
    if (bn.outer != null) result.push({ type: bn.outer })
    // A textblock can't hold blocks: a parent naming one is left over from
    // an older encoding.
    if (bn.content instanceof Plot.Type && !bn.content.inlineContent) {
      result.push({ type: bn.content })
    }
  }
  const self = block ? adapter.nodesForBlock(block.type.val) : null
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
