# rich

A collaborative **rich text** editor for Patchwork — a notes app, built on the
[Wordgard](https://wordgard.net) editor and the
[`@automerge/wordgard`](../automerge-wordgard) bindings.

Edits sync through an Automerge rich-text field (`content`) that follows the
[Automerge rich text schema](https://automerge.org/docs/reference/under-the-hood/rich-text-schema/),
so a `rich` document can be co-edited by multiple peers — and, because it uses
the shared schema, interoperates with other rich-text tools built on the same
model (e.g. `@automerge/prosemirror`).

## The editor

- **No toolbar.** A clean page: centred column, the first block styled as the
  note's title, a placeholder in an empty note.
- **Slash menu.** `/` at the start of a block (or after a space). It shows two
  kinds of thing, kept apart: **block types** to turn this block into, and
  **commands** that insert or do something. Arrow keys move, Enter/Tab run,
  Escape dismisses.
- **Block handles.** Hovering a block shows a gutter: `+` inserts a block below
  and opens the slash menu; the grip **drags** the block to reorder and
  **clicks** to open its menu — turn into another block type, colour it,
  duplicate, delete. Blocks inside a column get handles too. The hover band
  extends left of the text so the controls stay grabbable.
- **Columns.** `/columns`, or drag a block against another block's left or
  right edge and it offers to put them side by side (a vertical drop
  indicator); against a block already in a column, it adds a column to that
  row. `Columns`/`Column` are real schema nodes mapping to `columns`/`column`
  Automerge blocks, so a layout round-trips.
- **Tables.** `/table` — wordgard's table support, mapped to
  `table`/`table-row`/`table-cell` blocks.
- **Highlights.** Five of them — pink, yellow, sky, sea, mint — in the bar that
  appears over a selection. Each is a pairing of a background (the editor's own
  fill, nudged towards the hue) and a text colour that sits deep against it.
  `light-dark()` picks between them, so they follow the `color-scheme` the
  editor is actually wearing rather than the reader's OS. The document stores
  the *name*, so the look belongs to the theme.
- **Images are file documents.** Pasting, dropping or picking an image creates a
  Patchwork `file` doc (a `UnixFileEntry`: `content`/`extension`/`mimeType`/
  `name`) and stores its AutomergeUrl in the image block; only the rendered
  `<img>` resolves that to a service-worker URL, so notes stay portable. An
  image block with an ordinary URL still works (`/image-url`).
- **Selection formatting.** A floating bar over the selection: bold, italic,
  code, link, H1/H2, quote.
- **Smart typography.** `--` → em dash, `...` → ellipsis, curly quotes.
- **Document embeds.** Drag a document from the sidebar into the editor and it
  is inserted as an embed rendering a live `<patchwork-view>` of that document.

## Sharing a document with other editors

`rich` documents are edited by other apps too (chee's Swift *richtext* app),
so the shapes have to line up:

- **Embeds are inline** (`{type: "embed", isEmbed: true, attrs: {url}}`), which
  is how the shared schema spells an embed and how the Swift app writes pasted
  images. Modelling `Embed` as a block-level node made those documents fail to
  load with *"Node type Paragraph cannot contain child Embed"*; it is an inline
  leaf with block layout from CSS instead.
- **Images** are `{type: "image", attrs: {src}}`. The Swift app's reader treats
  `embed`, `image` and any `isEmbed` block alike and reads `attrs.url ??
  attrs.src`, so images written here show up there.
- `src/compat.js` is the safety net: `docFromSpansCompat` tries the spans as
  they are, then repaired (unknown blocks become paragraphs, unknown parents
  are dropped, `isEmbed` is normalised to what this adapter expects), then as
  plain text. A note never fails to open because a peer wrote something
  unexpected. `dev/fixtures/swift-embed.automerge` is a real document from the
  Swift app; `pnpm check` opens it.

## Plugins

Features and slash commands are host-registrable plugins, not fields on the
component. `src/registry.js` merges the built-ins with whatever the host
registry holds; `src/plugin-catalog.js` enumerates every id across types.

**The document decides which are on.** `doc.plugins` is an array of enabled
full-tier plugin ids, seeded at creation with the built-in full-tier ids.
Core-tier plugins are always on. `/plugins` opens a panel that edits the array,
and the editor reconfigures live (the feature extensions live in a
`GardState.Compartment`). A doc with no `plugins` array at all is a legacy doc
and gets everything.

Three plugin types:

```js
// rich:block — a block type: appears under "Turn into" in the slash menu and
// in the block handle's menu
{type: "rich:block", id: "callout", name: "Callout", icon: "<path d='…'/>",
 keywords: ["aside"], tier: "full",
 async load() { return {active(state) {…}, apply(wg) {…}} }}

// rich:slash — a command: inserts or does something
{type: "rich:slash", id: "signature", name: "Signature", group: "Mine",
 keywords: ["sign"], tier: "full", icon: "<path d='…'/>",
 async load() { return {run(wg, context) { /* dispatch on the editor */ }} }}

// rich:feature — Wordgard extensions
{type: "rich:feature", id: "spellcheck", name: "Spellcheck", tier: "full",
 async load() { return {extensions(context) { return [/* extensions */] }} }}
```

A slash command's `run(wg, context)` gets the editor and that same context.
Registry entries are serializable **descriptions** — metadata only, behaviour
behind `async load()` — because a plugin description may be structured-cloned
to a worker; function-valued fields can't survive that. The tool's own built-ins
carry their behaviour inline. `context` carries
`{handle, element, adapter, slashCommands()}`.

## How it works

- `src/adapter.js` — a `SchemaAdapter` extending `@automerge/wordgard`'s
  `basicSchemaSpec`: an `Embed` leaf (parameter = an `AutomergeUrl`, rendered as
  `<patchwork-view doc-url="…">`), the `Columns`/`Column` plots, and a
  `RichImage` leaf replacing wordgard's `Image` so an image `src` may be an
  AutomergeUrl. Nesting is expressed in the Automerge encoding through each
  block marker's `parents`, so columns are portable.
- `src/datatype.js` — the `rich` datatype. `init` seeds a `content` rich-text
  field with an empty paragraph so every peer starts from the same structure.
- `src/tool.js` — the render function: schema + editing bundles + history +
  `automergeSyncPlugin`, then whatever `doc.plugins` resolves to.
- `src/features.js`, `src/slash.js`, `src/block-types.js`, `src/blocks.js`,
  `src/block-menu.js`, `src/format-bar.js`, `src/images.js` — the built-in
  plugins and the menus.
- `src/highlight.js` — the named highlight mark; `src/icons.js` — menu glyphs.
- `src/embed-element.js` — `<rich-embed>`, the window an embedded document
  draws for itself (shadow DOM, so the editor can't wipe its chrome). Image
  file documents render as an `<img>`, everything else mounts a
  `<patchwork-view>`; the look follows `space`'s canvas windows. The type badge
  in its titlebar opens a filterable list of the tools registered for that
  datatype — or type an id and press Enter to use one the registry doesn't know
  about. The choice is a mark on the embed (`tool` on the block, `tool-id` on
  the element), so it belongs to the document. The element only *asks*, by
  dispatching `rich-embed-tool`; the editor owns the change.
- `src/files.js` — file documents in, service-worker URLs out.
- `src/wordgard/` — the Automerge bindings, vendored.
- `src/registry.js`, `src/plugin-catalog.js`, `src/plugins-panel.js` — the
  plugin machinery and the `/plugins` UI.

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

## Developing outside Patchwork

`dev/` is a harness: an in-memory repo, a stub plugin registry (with one
contributed slash command, to exercise the seam), and a headless smoke test.

```bash
pnpm dev:serve      # http://localhost:5173
pnpm check          # drives the page in headless chromium; shots in dev/shots/
```

Three things to know if you extend the test: it launches the `"chromium"`
channel because the old headless shell doesn't run native HTML5 drag-and-drop
(the block handles need it), screenshots must pass `caret: "initial"`
(playwright's caret-hiding style injection makes Wordgard's DOM observer
crash), and typing needs a `delay` or the keystrokes outrun the editor.

One binding detail: `src/wordgard/traversal.ts` marks **every** mapped block
container, and treats a container's first textblock as implicit only when it is
that container's *only* child. Without it, a table row of empty cells, a list
item holding a column layout, or a blank first line in a column are lost on the
way back — the implicit child is only materialised by content that follows the
container's marker.

A browser detail, since it cost an afternoon: **a `<button draggable="true">`
never starts a native drag** — browsers don't drag form controls. The grip is a
`<div role="button" draggable="true">`.

Two Wordgard details worth remembering: `nodeFromDOM(element)` gives a correct
position but a node from when that element was rendered — read the live node at
that position instead. And an extension value is a plugin's identity, so
rebuilding feature extensions on every reconfigure tears down and recreates
every plugin; `src/tool.js` caches them per plugin id.

## License

MIT
