import { Leaf, Node } from "wordgard/doc"
import { SchemaAdapter, basicSchemaSpec } from "@automerge/wordgard"

// A block-level embed leaf. Its parameter is the AutomergeUrl of the
// embedded document. Its shape renders a `<patchwork-view doc-url="…">`,
// the host custom element that mounts another Patchwork document inline —
// so no manual node view is needed: Wordgard renders the atom and the
// element mounts itself.
export const Embed = Leaf.Type.define("Embed", {
  validate: "string",
  group: Node.Group.Content,
  selectable: true,
  shape: {
    element: "patchwork-view",
    attributes: url => ({ "doc-url": url }),
  },
})

// The schema adapter for the "rich" tool: the basic Automerge rich-text
// mapping plus the embed block.
export const richAdapter = new SchemaAdapter({
  ...basicSchemaSpec,
  elements: [...basicSchemaSpec.elements, Embed],
  blocks: [
    ...basicSchemaSpec.blocks,
    {
      node: Embed,
      block: "embed",
      attrs: {
        fromAutomerge: block => ({ param: String(block.attrs.url ?? "") }),
        fromWordgard: node => ({ url: node.param }),
      },
    },
  ],
})
