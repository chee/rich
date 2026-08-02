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
}

/// Reverse (block-name -> nodes) mapping.
export interface BlockNodes {
  content: Node.Type
  outer: Plot.Type | null
  isEmbed: boolean
  attrs: BlockAttrParsers | null
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
    this.elements = spec.elements
    this.schema = Schema.define(spec.elements)

    for (const block of spec.blocks || []) {
      const content = nodeType(block.node)
      const within = block.within || null
      const mapping: NodeMapping = {
        content,
        blockName: block.block ?? null,
        within,
        isEmbed: block.isEmbed || false,
        attrs: block.attrs || null,
      }
      this.nodeMappings.set(content, mapping)

      if (block.block != null) {
        this.blocksByName.set(block.block, {
          content,
          outer: null,
          isEmbed: mapping.isEmbed,
          attrs: mapping.attrs,
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

  /// The configuration passed to `am.updateSpans`, deriving mark
  /// expansion behaviour from each mark's `inclusive` flag.
  updateSpansConfig(): am.UpdateSpansConfig {
    const perMarkExpand: { [name: string]: "both" | "none" } = {}
    for (const mapping of this.markMappings.values()) {
      perMarkExpand[mapping.name] = mapping.type.inclusive ? "both" : "none"
    }
    return { defaultExpand: "both", perMarkExpand }
  }
}

/// Convert a wordgard mark set to an Automerge mark set.
export function amMarksFromMarks(
  adapter: SchemaAdapter,
  marks: Mark.Set,
): am.MarkSet {
  const result: { [key: string]: am.MarkValue } = {}
  for (const mark of marks) {
    const mapping = adapter.markMappings.get(mark.type)
    if (mapping == null) continue
    result[mapping.name] = mapping.parsers
      ? mapping.parsers.fromWordgard(mark.value)
      : (true as am.MarkValue)
  }
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
  for (const [name, value] of Object.entries(amMarks)) {
    // Filter tombstoned marks.
    if (value == null) continue
    const mapping = adapter.marksByName.get(name)
    if (mapping == null) continue
    const mark = mapping.parsers
      ? mapping.type.of(mapping.parsers.fromAutomerge(value))
      : mapping.type.default
    if (mark != null) marks = mark.addToSet(marks)
  }
  return marks
}
