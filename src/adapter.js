import * as am from "@automerge/automerge"
import { Leaf, Mark, Node, Plot } from "wordgard/doc"
import {
  Cell,
  ColSpan,
  HeaderCell,
  Image,
  ImageAlt,
  RowSpan,
  Table,
  TableRow,
} from "wordgard/types"
import { SchemaAdapter, basicSchemaSpec } from "./wordgard/index.js"
import { srcForImage } from "./files.js"
import { Highlight, highlightParsers } from "./highlight.js"

// An embedded Patchwork document. Its parameter is the document's
// AutomergeUrl; its shape renders `<rich-embed doc-url="…">` (see
// embed-element.js), which draws the window chrome and mounts the document
// itself — so no manual node view is needed.
//
// It is an INLINE leaf, written with `isEmbed: true`, because that is how the
// Automerge rich-text schema spells an embed and how other editors on this
// datatype (chee's Swift richtext app) write theirs. A block-level embed node
// makes their documents fail to load with "Paragraph cannot contain child
// Embed"; CSS gives it block layout inside its paragraph instead.
// Which tool renders an embedded document. A mark rather than part of the
// parameter, so it rides along as a `tool-id` attribute on the element and
// stays out of the document's URL.
export const EmbedTool = Mark.Type.define("EmbedTool", {
  validate: "string",
  shape: { attribute: "tool-id", value: 0 },
})

export const Embed = Leaf.Type.define("Embed", {
  inline: true,
  validate: "string",
  selectable: true,
  shape: {
    element: "rich-embed",
    attributes: url => ({ "doc-url": url }),
  },
})

// Our own image leaf, replacing wordgard's, so the `src` may be the
// AutomergeUrl of a Patchwork file document as well as an ordinary URL: the
// document keeps the automerge URL (durable, host-independent) and only the
// rendered `<img>` gets the service-worker URL. It still maps to the standard
// `image` block, so plain-URL images stay interoperable.
export const RichImage = Leaf.Type.define("RichImage", {
  inline: true,
  validate: "string",
  selectable: true,
  shape: {
    element: "img",
    attributes: src => ({ src: srcForImage(src) }),
  },
  parseRules: [{ selector: "img[src]", readElement: element => element.src }],
})

// Columns. A `Columns` row holds `Column`s, each holding ordinary block
// content — the Notion arrangement. `orientation: "row"` tells wordgard the
// children sit side by side, so cursor motion across them behaves.
const ColumnGroup = Node.Group.define()

export const Column = Plot.define("Column", {
  group: ColumnGroup,
  blockContent: Node.Group.Content,
  isolating: true,
  defining: true,
  shape: { element: "div", attributes: { class: "rich-column" } },
})

export const Columns = Plot.define("Columns", {
  group: Node.Group.Content,
  blockContent: ColumnGroup,
  orientation: "row",
  defining: true,
  shape: { element: "div", attributes: { class: "rich-columns" } },
})

const amString = value => {
  if (value == null) return null
  return am.isImmutableString(value) ? value.val : String(value)
}

const numberMark = {
  fromAutomerge: value => (typeof value === "number" ? value : Number(value) || 1),
  fromWordgard: value => value,
}

const isImageBlock = block => block.node === Image
const withoutImage = list => list.filter(entry => !isImageBlock(entry))

// The schema adapter for the "rich" tool: the basic Automerge rich-text
// mapping, with our image node in place of the built-in one, plus the embed
// leaf and the column blocks.
export const richAdapter = new SchemaAdapter({
  ...basicSchemaSpec,
  elements: [
    ...basicSchemaSpec.elements.filter(element => element !== Image),
    RichImage,
    Columns,
    Column,
    Table,
    TableRow,
    Cell,
    HeaderCell,
    ColSpan,
    RowSpan,
    Highlight,
    EmbedTool,
    Embed,
  ],
  blocks: [
    ...withoutImage(basicSchemaSpec.blocks),
    {
      node: RichImage,
      block: "image",
      isEmbed: true,
      attrs: {
        fromAutomerge: block => {
          const src = amString(block.attrs.src) ?? ""
          const alt = amString(block.attrs.alt)
          const marks = alt != null ? ImageAlt.of(alt).addToSet(Mark.none) : Mark.none
          return { param: src, marks }
        },
        fromWordgard: node => {
          const attrs = { src: new am.ImmutableString(node.param) }
          const alt = node.mark(ImageAlt)
          if (alt != null) attrs.alt = alt
          return attrs
        },
      },
    },
    { node: Columns, block: "columns" },
    { node: Column, block: "column" },
    // Tables. The schema elements come from wordgard's `tables()` bundle; only
    // the block names live here. Nesting rides in each marker's `parents`.
    { node: Table, block: "table" },
    { node: TableRow, block: "table-row" },
    { node: Cell, block: "table-cell" },
    { node: HeaderCell, block: "table-header-cell" },
    {
      node: Embed,
      block: "embed",
      isEmbed: true,
      attrs: {
        fromAutomerge: block => {
          const tool = amString(block.attrs.tool)
          return {
            param: String(block.attrs.url ?? ""),
            marks: tool ? EmbedTool.of(tool).addToSet(Mark.none) : Mark.none,
          }
        },
        fromWordgard: node => {
          const attrs = { url: node.param }
          const tool = node.mark(EmbedTool)
          if (tool != null) attrs.tool = tool
          return attrs
        },
      },
    },
  ],
  marks: [
    ...basicSchemaSpec.marks,
    { mark: ColSpan, name: "colspan", parsers: numberMark },
    { mark: RowSpan, name: "rowspan", parsers: numberMark },
    // Highlights are stored by NAME ("pink"), so the theme decides what pink
    // looks like.
    { mark: Highlight, name: "highlight", parsers: highlightParsers },
  ],
})
