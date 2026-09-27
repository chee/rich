import * as am from "@automerge/automerge"
import { Leaf, Mark, Node, Plot } from "wordgard/doc"
import {
  BlockCell,
  BlockHeaderCell,
  Blockquote,
  CodeBlock,
  CodeBlockLanguage,
  Code,
  Emphasis,
  Heading,
  Image,
  LineBreak,
  ListItem,
  Paragraph,
  Strikethrough,
  Strong,
  Subscript,
  Superscript,
  Table,
  TableRow,
  Underline,
} from "wordgard/types"
import { SchemaAdapter, basicSchemaSpec } from "./wordgard/index.js"
import { srcForImage } from "./files.js"
import { Highlight, highlightParsers } from "./highlight.js"
import { Logline } from "./logline.js"
import { HtmlBlock } from "./html-block.js"
import { Checked, TodoList, TodoState, todoParsers } from "./todo-list.js"

// The document is the one chee's Swift notes app (lush) writes: automerge
// rich text whose block markers and marks are named and shaped exactly as
// lush names and shapes them. Everything here is a mapping onto that.

// Which tool renders an embedded document. A mark rather than part of the
// parameter, so it rides along as a `tool-id` attribute on the element and
// stays out of the document's URL.
export const EmbedTool = Mark.Type.define("EmbedTool", {
  // embeds are block leaves, so the default (inline leaves) won't do
  target: Node.Group.Leaf,
  validate: "string",
  shape: { attribute: "tool-id", value: 0 },
})

// An embedded document: a photo, a sound, a video, any file, or a Patchwork
// document. Lush writes all of them as one `embed` block holding the URL, on
// a line of its own, and the element works out how to draw it from what the
// URL points at (see embed-element.js).
export const Embed = Leaf.Type.define("Embed", {
  group: Node.Group.Content,
  validate: "string",
  selectable: true,
  shape: {
    element: "rich-embed",
    attributes: url => ({ "doc-url": url }),
  },
})

// An `image` block, which lush reads but no longer writes: the `src` may be
// the AutomergeUrl of a file document as well as an ordinary URL. Only the
// rendered `<img>` gets the service-worker URL.
export const RichImage = Leaf.Type.define("RichImage", {
  group: Node.Group.Content,
  validate: "string",
  selectable: true,
  shape: {
    element: "img",
    attributes: src => ({ src: srcForImage(src), class: "rich-image" }),
  },
  parseRules: [{ selector: "img[src]", readElement: element => element.src }],
})

// Columns. A `Columns` row holds `Column`s, each holding ordinary block
// content. `orientation: "row"` tells wordgard the children sit side by side,
// so cursor motion across them behaves.
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

// The typeface a run of text is set in: lush's `font` mark, "serif" or
// "hand". ("Code" in lush's font row is the `code` mark, not a font.)
export const FONTS = ["serif", "hand"]

export const Font = Mark.Type.define("Font", {
  rank: 40,
  spanning: true,
  validate: "string",
  shape: {
    element: "span",
    attributes: value => ({ class: `rich-font rich-font-${FONTS.includes(value) ? value : "other"}` }),
  },
})

// How far a block that isn't a list item is indented: lush's `indent` attr,
// 20pt a level. Lists nest instead.
export const Indent = Mark.Type.define("Indent", {
  target: [Paragraph, Heading, CodeBlock],
  validate: "number",
  keepOnSplit: true,
  keepOnTypeChange: true,
  shape: { attribute: "data-indent", value: level => String(level) },
})

const amString = value => {
  if (value == null) return null
  return am.isImmutableString(value) ? value.val : typeof value === "string" ? value : null
}

const withMark = (marks, mark) => (mark ? mark.addToSet(marks) : marks)

const readIndent = block => {
  const indent = block.attrs.indent
  return typeof indent === "number" && indent > 0 ? Indent.of(Math.floor(indent)) : null
}

const writeIndent = (node, attrs = {}) => {
  const indent = Indent.isInSet(node.tag.marks)
  if (indent && indent.value > 0) attrs.indent = indent.value
  return attrs
}

const headingLevel = block => {
  const level = block.attrs.level
  return typeof level === "number" ? Math.min(6, Math.max(1, Math.floor(level))) : 1
}

// A logline's facts, as the leaf's JSON: strings plain, the rest as they are.
const plainFacts = attrs => {
  const facts = {}
  for (const name of Object.keys(attrs).sort()) {
    const value = attrs[name]
    if (value == null) continue
    const text = amString(value)
    if (text != null) facts[name] = text
    else if (typeof value === "number" || typeof value === "boolean") facts[name] = value
  }
  return facts
}

// The schema adapter for the "rich" tool.
export const richAdapter = new SchemaAdapter({
  elements: [
    ...basicSchemaSpec.elements.filter(element => element !== Image),
    LineBreak,
    CodeBlockLanguage,
    RichImage,
    Columns,
    Column,
    Table,
    TableRow,
    BlockCell,
    BlockHeaderCell,
    Highlight,
    EmbedTool,
    Embed,
    Logline,
    HtmlBlock,
    TodoList,
    Checked,
    TodoState,
    Underline,
    Strikethrough,
    Superscript,
    Subscript,
    Font,
    Indent,
  ],
  blocks: [
    {
      node: Paragraph,
      block: "paragraph",
      owns: ["indent"],
      attrs: {
        fromAutomerge: block => ({ marks: withMark(Mark.none, readIndent(block)) }),
        fromWordgard: node => writeIndent(node),
      },
    },
    {
      node: Heading,
      block: "heading",
      owns: ["level", "indent"],
      attrs: {
        fromAutomerge: block => ({
          param: headingLevel(block),
          marks: withMark(Mark.none, readIndent(block)),
        }),
        fromWordgard: node => writeIndent(node, { level: node.tag.param }),
      },
    },
    { node: Blockquote, block: "blockquote" },
    {
      node: CodeBlock,
      block: "code-block",
      owns: ["language", "indent"],
      attrs: {
        fromAutomerge: block => {
          const language = amString(block.attrs.language)
          let marks = withMark(Mark.none, readIndent(block))
          if (language) marks = CodeBlockLanguage.of(language).addToSet(marks)
          return { marks }
        },
        fromWordgard: node => {
          const attrs = writeIndent(node)
          const language = CodeBlockLanguage.isInSet(node.tag.marks)
          if (language?.value) attrs.language = language.value
          return attrs
        },
      },
    },
    {
      node: ListItem,
      within: {
        BulletList: "unordered-list-item",
        OrderedList: "ordered-list-item",
        TodoList: "todo-list-item",
      },
      owns: ["checked", "state"],
      attrs: {
        fromAutomerge: block => ({ marks: todoParsers.fromAutomerge(block) }),
        fromWordgard: todoParsers.fromWordgard,
      },
    },
    {
      node: RichImage,
      block: "image",
      isEmbed: true,
      // `alt` rides along as an extra
      owns: ["src", "url"],
      attrs: {
        fromAutomerge: block => ({ param: amString(block.attrs.url) ?? amString(block.attrs.src) ?? "" }),
        fromWordgard: node => ({ src: node.param }),
      },
    },
    { node: Columns, block: "columns" },
    { node: Column, block: "column" },
    // Tables. The schema elements come from wordgard's `tables()` bundle; only
    // the block names live here. Nesting rides in each marker's `parents`.
    { node: Table, block: "table" },
    { node: TableRow, block: "table-row" },
    { node: BlockCell, block: "table-cell" },
    { node: BlockHeaderCell, block: "table-header-cell" },
    {
      node: Embed,
      block: "embed",
      isEmbed: true,
      // `alt`, `width` and `height` ride along untouched as extras.
      owns: ["url", "tool"],
      attrs: {
        fromAutomerge: block => {
          const tool = amString(block.attrs.tool)
          return {
            param: amString(block.attrs.url) ?? amString(block.attrs.src) ?? "",
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
    {
      node: HtmlBlock,
      block: "html",
      isEmbed: true,
      owns: ["html"],
      attrs: {
        fromAutomerge: block => ({ param: amString(block.attrs.html) ?? "" }),
        fromWordgard: node => ({ html: node.param }),
      },
    },
    // A logline. Each fact is its own attr, the way lush writes them; the
    // leaf carries all of them as JSON, including ones from providers this
    // editor has never heard of.
    {
      node: Logline,
      block: "context",
      isEmbed: true,
      owns: "*",
      attrs: {
        fromAutomerge: block => ({ param: JSON.stringify(plainFacts(block.attrs)) }),
        fromWordgard: node => {
          let facts = {}
          try {
            facts = JSON.parse(node.param || "{}")
          } catch {
            // an unreadable logline has no facts
          }
          const attrs = {}
          for (const [name, value] of Object.entries(facts)) {
            if (value == null) continue
            attrs[name] = typeof value === "number" || typeof value === "boolean" ? value : String(value)
          }
          return attrs
        },
      },
    },
  ],
  marks: [
    { mark: Strong, name: "strong" },
    { mark: Emphasis, name: "em" },
    { mark: Code, name: "code" },
    basicSchemaSpec.marks.find(mark => mark.name === "link"),
    // Highlights are stored by NAME ("pink"), so the theme decides what pink
    // looks like.
    { mark: Highlight, name: "highlight", parsers: highlightParsers },
    { mark: Underline, name: "underline" },
    { mark: Strikethrough, name: "strikethrough" },
    { mark: Superscript, name: "superscript" },
    { mark: Subscript, name: "subscript" },
    {
      mark: Font,
      name: "font",
      parsers: {
        fromAutomerge: value => (typeof value === "string" ? value : "serif"),
        fromWordgard: value => String(value),
      },
    },
  ],
})
