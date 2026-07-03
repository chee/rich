# rich

A collaborative **rich text** editor for Patchwork, built on the
[Wordgard](https://wordgard.net) editor and the
[`@automerge/wordgard`](../../../wordgard/automerge-wordgard) bindings.

Edits sync through an Automerge rich-text field (`content`) that follows the
[Automerge rich text schema](https://automerge.org/docs/reference/under-the-hood/rich-text-schema/),
so a `rich` document can be co-edited by multiple peers — and, because it uses
the shared schema, interoperates with other rich-text tools built on the same
model (e.g. `@automerge/prosemirror`).

## Features

- Paragraphs, headings, blockquotes, code blocks, bullet/ordered lists.
- Bold, italic, inline code, and links.
- Undo/redo and a menu bar.
- **Drag a document from the sidebar into the editor to embed it.** The dropped
  document is inserted as a block that renders a live `<patchwork-view>` of that
  document inline.

## How it works

- `src/adapter.js` — a `SchemaAdapter` extending `@automerge/wordgard`'s
  `basicSchemaSpec` with an `Embed` leaf node (parameter = an `AutomergeUrl`)
  whose shape renders `<patchwork-view doc-url="…">`.
- `src/datatype.js` — the `rich` datatype. `init` seeds a `content` rich-text
  field with an empty paragraph so every peer starts from the same structure.
- `src/tool.js` — the render function. Builds a Wordgard editor wired to the
  handle via `automergeSyncPlugin`, and registers `dragover`/`drop` handlers
  that parse the sidebar drag payload (`src/dnd.js`) and insert an `Embed`.

## Build & sync

This is a **bundled** tool (Wordgard isn't in the host importmap, so it is
bundled; `@automerge/automerge`, `@automerge/automerge-repo` and the patchwork
packages stay external and come from the host).

```bash
pnpm install
pnpm build          # emits dist/index.js
pushwork sync       # publish; writes pushwork.url into package.json
```

> Note: `@automerge/wordgard` is referenced with a `link:` spec while it is
> unpublished. `vite.config.js` sets `resolve.dedupe: ["wordgard"]` so the
> linked library and the tool share a single copy of Wordgard (node/mark type
> identity must hold across both).

## License

MIT
