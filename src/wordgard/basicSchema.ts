import { Plot, Leaf, Node, Mark } from "wordgard/doc"
import {
  Doc,
  Paragraph,
  Heading,
  Blockquote,
  CodeBlock,
  BulletList,
  OrderedList,
  ListItem,
  Image,
  ImageAlt,
  Strong,
  Emphasis,
  Code,
  Link,
} from "wordgard/types"
import * as am from "@automerge/automerge"
import { SchemaAdapter, BlockMarker, MappedSchemaSpec } from "./schema.js"

function amString(value: am.MaterializeValue | undefined): string | null {
  if (value == null) return null
  if (am.isImmutableString(value)) return value.val
  return String(value)
}

function readHeadingLevel(block: BlockMarker): number {
  const level = block.attrs.level
  return typeof level === "number" ? level : 1
}

/// The specification behind {@link basicSchemaAdapter}, exported so
/// that custom adapters can extend it (e.g. to add extra node types)
/// rather than redefining the common mappings from scratch.
export const basicSchemaSpec: MappedSchemaSpec = {
  elements: [
    Doc,
    Paragraph,
    Heading,
    Blockquote,
    CodeBlock,
    BulletList,
    OrderedList,
    ListItem,
    Image,
    ImageAlt,
    Strong,
    Emphasis,
    Code,
    Link,
  ],
  blocks: [
    { node: Paragraph, block: "paragraph" },
    {
      node: Heading,
      block: "heading",
      attrs: {
        fromAutomerge: block => ({ param: readHeadingLevel(block) }),
        fromWordgard: node => ({ level: (node as Plot).tag.param as number }),
      },
    },
    { node: Blockquote, block: "blockquote" },
    { node: CodeBlock, block: "code-block" },
    {
      node: ListItem,
      within: {
        BulletList: "unordered-list-item",
        OrderedList: "ordered-list-item",
      },
    },
    {
      node: Image,
      block: "image",
      isEmbed: true,
      attrs: {
        fromAutomerge: block => {
          const src = amString(block.attrs.src) ?? ""
          const alt = amString(block.attrs.alt)
          const marks: Mark.Set = alt != null ? ImageAlt.of(alt).addToSet(Mark.none) : Mark.none
          return { param: src, marks }
        },
        fromWordgard: node => {
          const leaf = node as Leaf<string>
          const alt = node.mark(ImageAlt)
          const attrs: { [key: string]: am.MaterializeValue } = {
            src: new am.ImmutableString(leaf.param),
          }
          if (alt != null) attrs.alt = alt
          return attrs
        },
      },
    },
  ],
  marks: [
    { mark: Strong, name: "strong" },
    { mark: Emphasis, name: "em" },
    { mark: Code, name: "code" },
    {
      mark: Link,
      name: "link",
      parsers: {
        fromAutomerge: value => {
          if (typeof value === "string") {
            try {
              const parsed = JSON.parse(value)
              return typeof parsed?.href === "string" ? parsed.href : value
            } catch {
              return value
            }
          }
          return ""
        },
        fromWordgard: value => JSON.stringify({ href: value, title: "" }),
      },
    },
  ],
}

/// The default {@link SchemaAdapter}. It maps a common subset of the
/// wordgard schema to the
/// {@link https://automerge.org/docs/reference/under-the-hood/rich-text-schema/ | Automerge rich-text schema}
/// so that documents can be shared with, for example,
/// `@automerge/prosemirror`.
export const basicSchemaAdapter = new SchemaAdapter(basicSchemaSpec)
