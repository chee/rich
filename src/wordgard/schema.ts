import { Plot, Leaf, Node, Mark, Schema } from "wordgard/doc"
import * as am from "@automerge/automerge"

/// A block marker as it is stored in an Automerge rich-text field.
/// Occupies a single character in the Automerge index space.
export type BlockMarker = {
  type: am.ImmutableString
  parents: am.ImmutableString[]
  attrs: { [key: string]: am.MaterializeValue }
  isEmbed?: boolean
}

export const UnknownBlock = Leaf.Type.define<BlockMarker>("UnknownBlock", {
  inline: true,
  validate: value => {
    if (value == null || typeof value !== "object") {
      throw new TypeError("Invalid unknown block")
    }
  },
  selectable: true,
  shape: {
    element: "span",
    attributes: block => ({
      class: "rich-unknown-block",
      "data-block-type": block.type.val,
      title: `Unsupported block: ${block.type.val}`,
    }),
  },
})

/// A block that another editor wrote as an embed (`isEmbed: true`) and
/// this schema has no node for — a calendar event, say. It sits on its own
/// line, like every embed, and keeps the whole marker so it is written back
/// untouched.
export const UnknownEmbed = Leaf.Type.define<BlockMarker>("UnknownEmbed", {
  group: Node.Group.Content,
  validate: value => {
    if (value == null || typeof value !== "object") {
      throw new TypeError("Invalid unknown embed")
    }
  },
  selectable: true,
  shape: {
    element: "rich-card",
    attributes: block => ({
      "block-type": block.type.val,
      attrs: JSON.stringify(encodeAttrs(block.attrs)),
    }),
  },
})

/// Block attrs this schema doesn't model, carried on the block's node so
/// they are written back as they were read (an embed's `alt`, a logline's
/// provider extras). The value is JSON, in the encoding of {@link
/// encodeAttrs}.
export const BlockExtras = Mark.Type.define<string>("BlockExtras", {
  target: Node.Group.Block,
  validate: "string",
  keepOnSplit: true,
  keepOnTypeChange: false,
  shape: { attribute: "data-extras", value: () => null },
})

/// Marks another editor wrote that this schema has no mapping for, kept
/// on the text as JSON (`{"name": value}`) so they survive a write.
export const ForeignMarks = Mark.Type.define<string>("ForeignMarks", {
  validate: "string",
  inclusive: false,
  spanning: true,
  shape: { element: "span", attributes: { class: "rich-foreign-marks" } },
})

// Attr values as JSON, keeping the automerge scalar types apart: a Str
// (ImmutableString) is a bare JSON string, collaborative text is
// `{"$text": …}`, and the scalars JSON can't say are tagged.
function encodeValue(value: unknown): unknown {
  if (am.isImmutableString(value)) return (value as am.ImmutableString).val
  if (typeof value === "string") return { $text: value }
  if (value instanceof Date) return { $date: value.getTime() }
  if (value instanceof Uint8Array) return { $bytes: Array.from(value) }
  if (value instanceof am.Counter) return { $counter: value.value }
  if (Array.isArray(value)) return value.map(encodeValue)
  if (value != null && typeof value === "object") {
    const out: { [key: string]: unknown } = {}
    for (const [k, v] of Object.entries(value)) out[k] = encodeValue(v)
    return out
  }
  return value
}

function decodeValue(value: unknown): am.MaterializeValue {
  if (typeof value === "string") return new am.ImmutableString(value)
  if (Array.isArray(value)) return value.map(decodeValue) as am.MaterializeValue
  if (value != null && typeof value === "object") {
    const tagged = value as { [key: string]: unknown }
    const keys = Object.keys(tagged)
    if (keys.length === 1) {
      if (typeof tagged.$text === "string") return tagged.$text
      if (typeof tagged.$date === "number") return new Date(tagged.$date)
      if (Array.isArray(tagged.$bytes)) return new Uint8Array(tagged.$bytes as number[])
      if (typeof tagged.$counter === "number") return new am.Counter(tagged.$counter) as unknown as am.MaterializeValue
    }
    const out: { [key: string]: am.MaterializeValue } = {}
    for (const [k, v] of Object.entries(tagged)) out[k] = decodeValue(v)
    return out
  }
  return value as am.MaterializeValue
}

/// Encode block attrs as JSON-safe values (see {@link BlockExtras}).
export function encodeAttrs(attrs: { [key: string]: am.MaterializeValue }): { [key: string]: unknown } {
  // sorted, so the same attrs always make the same JSON (and mark)
  const out: { [key: string]: unknown } = {}
  for (const k of Object.keys(attrs).sort()) if (attrs[k] !== undefined) out[k] = encodeValue(attrs[k])
  return out
}

/// The inverse of {@link encodeAttrs}. Plain strings come back as Str
/// scalars, the way the Swift app writes them.
export function decodeAttrs(json: { [key: string]: unknown }): { [key: string]: am.MaterializeValue } {
  const out: { [key: string]: am.MaterializeValue } = {}
  for (const [k, v] of Object.entries(json)) out[k] = decodeValue(v)
  return out
}

/// Parsers that translate between an Automerge block marker and the
/// wordgard node used to represent it. `fromAutomerge` produces the
/// content node's parameter and marks, `fromWordgard` reads the block
/// attributes back out of the node.
export interface BlockAttrParsers {
  fromAutomerge: (block: BlockMarker) => { param?: unknown; marks?: Mark.Set }
  fromWordgard: (node: Node) => { [key: string]: am.MaterializeValue }
}

/// A single node <-> block mapping passed to a {@link SchemaAdapter}.
export interface BlockMappingSpec {
  /// The wordgard node type (or a singleton tag/leaf of that type).
  node: Node.Type.Ref<any>
  /// The Automerge block name this node maps to. Mutually exclusive
  /// with {@link BlockMappingSpec.within}.
  block?: string
  /// When the Automerge block name depends on the enclosing plot, map
  /// parent node names to block names here (e.g. a list item is an
  /// `ordered-list-item` inside an `OrderedList` and an
  /// `unordered-list-item` inside a `BulletList`).
  within?: { [parentNodeName: string]: string }
  /// Whether this block is an inline embed (like an image) rather than
  /// a structural block.
  isEmbed?: boolean
  /// How to translate block attributes to and from the node.
  attrs?: BlockAttrParsers
  /// The attrs `attrs` reads and writes. Every other attr is kept as it
  /// was (see {@link BlockExtras}). `"*"` means the parsers handle all
  /// of them.
  owns?: readonly string[] | "*"
}

/// Parsers translating a mark value between Automerge and wordgard.
export interface MarkParsers {
  fromAutomerge: (value: am.MarkValue) => unknown
  fromWordgard: (value: unknown) => am.MarkValue
}

/// A single mark <-> mark mapping passed to a {@link SchemaAdapter}.
export interface MarkMappingSpec {
  /// The wordgard mark (singleton) or mark type.
  mark: Mark<any> | Mark.Type<any>
  /// The Automerge mark name.
  name: string
  /// How to translate the mark's value. Omit for parameter-less marks.
  parsers?: MarkParsers
}

/// The specification passed to the {@link SchemaAdapter} constructor.
export interface MappedSchemaSpec {
  /// The wordgard schema elements (node types, mark types, the
  /// document type, and any overrides). These are used to build the
  /// {@link Schema} and are also the elements registered with the
  /// editor by {@link init}.
  elements: readonly Schema.Element[]
  /// The block mappings.
  blocks?: readonly BlockMappingSpec[]
  /// The mark mappings.
  marks?: readonly MarkMappingSpec[]
}

/// Normalised, resolved node mapping.
export interface NodeMapping {
  content: Node.Type
  blockName: string | null
  within: { [parentNodeName: string]: string } | null
  isEmbed: boolean
  attrs: BlockAttrParsers | null
  owns: readonly string[] | "*"
}

/// Reverse (block-name -> nodes) mapping.
export interface BlockNodes {
  content: Node.Type
  outer: Plot.Type | null
  isEmbed: boolean
  attrs: BlockAttrParsers | null
  owns: readonly string[] | "*"
}

/// Normalised mark mapping.
export interface MarkMapping {
  name: string
  type: Mark.Type
  parsers: MarkParsers | null
}

function nodeType(ref: Node.Type.Ref<any>): Node.Type {
  return Node.Type.get(ref)
}

function markType(mark: Mark<any> | Mark.Type<any>): Mark.Type {
  return mark instanceof Mark.Type ? mark : mark.type
}

/// A `SchemaAdapter` describes how a wordgard {@link Schema} maps to
/// the block markers and marks stored in an Automerge rich-text field.
export class SchemaAdapter {
  /// The wordgard schema.
  readonly schema: Schema
  /// The schema elements (used to configure the editor).
  readonly elements: readonly Schema.Element[]
  /// Forward node mappings keyed by content node type.
  readonly nodeMappings: Map<Node.Type, NodeMapping> = new Map()
  /// Reverse mappings keyed by Automerge block name.
  readonly blocksByName: Map<string, BlockNodes> = new Map()
  /// Mark mappings keyed by mark type.
  readonly markMappings: Map<Mark.Type, MarkMapping> = new Map()
  /// Mark mappings keyed by Automerge mark name.
  readonly marksByName: Map<string, MarkMapping> = new Map()

  constructor(spec: MappedSchemaSpec) {
    const always = [UnknownBlock, UnknownEmbed, BlockExtras, ForeignMarks]
    this.elements = [...spec.elements, ...always.filter(e => !spec.elements.includes(e))]
    this.schema = Schema.define(this.elements)

    for (const block of spec.blocks || []) {
      const content = nodeType(block.node)
      const within = block.within || null
      const mapping: NodeMapping = {
        content,
        blockName: block.block ?? null,
        within,
        isEmbed: block.isEmbed || false,
        attrs: block.attrs || null,
        owns: block.owns ?? [],
      }
      this.nodeMappings.set(content, mapping)

      if (block.block != null) {
        this.blocksByName.set(block.block, {
          content,
          outer: null,
          isEmbed: mapping.isEmbed,
          attrs: mapping.attrs,
          owns: mapping.owns,
        })
      }
      if (within != null) {
        for (const [parentName, blockName] of Object.entries(within)) {
          const outer = this.schema.getNode(parentName)
          if (outer == null || !(outer instanceof Plot.Type)) {
            throw new Error(
              `within mapping references unknown plot type ${parentName}`,
            )
          }
          this.blocksByName.set(blockName, {
            content,
            outer,
            isEmbed: mapping.isEmbed,
            attrs: mapping.attrs,
            owns: mapping.owns,
          })
        }
      }
    }

    for (const mark of spec.marks || []) {
      const type = markType(mark.mark)
      const mapping: MarkMapping = {
        name: mark.name,
        type,
        parsers: mark.parsers || null,
      }
      this.markMappings.set(type, mapping)
      this.marksByName.set(mark.name, mapping)
    }
  }

  /// Resolve the Automerge block name for a node given its parent plot
  /// type (used for `within` mappings).
  blockNameForNode(type: Node.Type, parent: Plot.Type | null): string | null {
    const mapping = this.nodeMappings.get(type)
    if (mapping == null) return null
    if (mapping.blockName != null) return mapping.blockName
    if (mapping.within != null && parent != null) {
      return mapping.within[parent.name] ?? null
    }
    return null
  }

  /// Get the forward node mapping for a node type, if any.
  mappingForNode(type: Node.Type): NodeMapping | undefined {
    return this.nodeMappings.get(type)
  }

  /// Resolve the wordgard nodes used to represent a block name.
  nodesForBlock(blockName: string): BlockNodes | undefined {
    return this.blocksByName.get(blockName)
  }

  /// The configuration passed to `am.updateSpans`. Every mark expands
  /// both ways, the way the Swift app writes them (its `update_spans`
  /// uses the default config, and its incremental marks `ExpandMark::Both`),
  /// so both editors leave the same expand metadata behind.
  updateSpansConfig(): am.UpdateSpansConfig {
    return { defaultExpand: "both" }
  }

  /// Marks not stored inside a block, by block name: headings are bold
  /// already, code blocks are code already.
  excludedMarks: { [blockName: string]: readonly string[] } = {
    heading: ["strong"],
    "code-block": ["code"],
  }
}

/// Convert a wordgard mark set to an Automerge mark set.
export function amMarksFromMarks(
  adapter: SchemaAdapter,
  marks: Mark.Set,
  blockName?: string | null,
): am.MarkSet {
  const result: { [key: string]: am.MarkValue } = {}
  for (const mark of marks) {
    if (mark.type === ForeignMarks) {
      try {
        Object.assign(result, JSON.parse(mark.value as string))
      } catch {
        // an unreadable foreign mark is no mark
      }
      continue
    }
    const mapping = adapter.markMappings.get(mark.type)
    if (mapping == null) continue
    result[mapping.name] = mapping.parsers
      ? mapping.parsers.fromWordgard(mark.value)
      : (true as am.MarkValue)
  }
  const excluded = blockName ? adapter.excludedMarks[blockName] : null
  if (excluded) for (const name of excluded) delete result[name]
  return result
}

/// Convert an Automerge mark set to a wordgard mark set. Marks with no
/// mapping are dropped.
export function marksFromAmMarks(
  adapter: SchemaAdapter,
  amMarks: am.MarkSet | undefined,
): Mark.Set {
  if (amMarks == null) return Mark.none
  let marks = Mark.none
  let foreign: { [name: string]: unknown } | null = null
  for (const [name, value] of Object.entries(amMarks)) {
    // Filter tombstoned marks.
    if (value == null) continue
    const mapping = adapter.marksByName.get(name)
    if (mapping == null) {
      ;(foreign ??= {})[name] = value instanceof Date ? value.toISOString() : value
      continue
    }
    const mark = mapping.parsers
      ? mapping.type.of(mapping.parsers.fromAutomerge(value))
      : mapping.type.default
    if (mark != null) marks = mark.addToSet(marks)
  }
  if (foreign) marks = ForeignMarks.of(JSON.stringify(foreign)).addToSet(marks)
  return marks
}
