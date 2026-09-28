# Rich

A collaborative **rich text** editor for Patchwork — a notes app, built on the
[Wordgard](https://wordgard.net) editor and the
[`@automerge/wordgard`](../automerge-wordgard) bindings.

Edits sync through an Automerge rich-text field (`content`) that follows the
[Automerge rich text schema](https://automerge.org/docs/reference/under-the-hood/rich-text-schema/),
so a `rich` document can be co-edited by multiple peers — and, because it uses
the shared schema, interoperates with other rich-text tools built on the same
model (e.g. `@automerge/prosemirror`).

## The editor

Rich is a web lush: it reads and writes the same automerge notes as chee's
Swift notes app, in exactly the shape lush does (see **The document** below),
and it looks and behaves like lush's editor.

- **The top bar.** A translucent bar floats over the note, which fades out
  beneath it as you scroll. In the middle, a pill with **Aa** and a
  **paperclip**; on the right, **•••** and **info**.
- **Aa** opens lush's format popover, row for row: B, I, U, S, link,
  superscript and subscript; the fonts **Serif**, **Hand** and **Code**; a
  highlighter with five swatches (pink, yellow, sky, sea, mint) and none; the
  block styles, each drawn in its own style with a tick on the current one —
  Title, Heading, Subheading, Body, Code; Bulleted, Numbered and To-do lists;
  Quote — and an indent/outdent pill. In a code block, a language picker.
  As in lush, a style goes on every line the selection touches, with the
  style's own attrs (an indent doesn't survive it), in one undo; picking the
  style a line already has puts it back to Body. The pill nests list items
  line by line (so does Tab) and gives other lines lush's `indent`. The link button
  (and Cmd-K) opens lush's Link sheet: `example.com` becomes
  `https://example.com`, `me@x.org` becomes `mailto:me@x.org`. At phone width
  the popover is lush's bottom **Format** island instead.
- **The paperclip**: Choose Photo…, Record Audio, Live Transcription, Attach
  File…, Logline, Logline…, Table, Columns, HTML Block, Patchwork Doc…. What
  they put in the note goes after the line the caret is in, with the caret
  on a line of its own below it. Logline… is lush's logline sheet (when,
  where, weather, details; double-click a logline to edit it), and an HTML
  block opens its source beside what it draws.
- **Tables and columns** have lush's **•••** at their top-trailing corner: Add
  Row, Add Column, Remove Last Row, Remove Last Column and Header Row (a column
  layout: Add Column, Remove Last Column). Tab walks the cells.
- **•••**: Duplicate (a new note from `repo.create`, seeded from this one, with
  no shared history; offered for notes, where there is a repo — a host whose
  document is something else, like the site editor's posts, duplicates it its
  own way), Copy Link, Find… and Find and Replace… (Cmd-F,
  Cmd-Opt-F, Cmd-G), Export as Markdown… and as HTML…, Move Checked to Bottom,
  Hide Checked Items, Delete Checked Items, the table verbs when the caret is
  in a table, Plugins….
- **Info** (the (i) button): the note's counts (words, characters, blocks by
  kind, to-dos by state, links, attachments, automerge changes) and an
  **Outline** of its headings to jump to.
- **The look is lush's**: Jost at 16px with Jost's own line height,
  Merriweather for the serif mark, Caroni for the hand, Fantasque Sans Mono
  for code (src/fonts, loaded by fonts.js); headings 10pt before and 6pt
  after; drawn bullets and lush's four to-do boxes (right-click one for its
  states); the cream quote card with its pink bar; the pale-blue code card;
  pink links. It has a dark scheme of its own, and a host's `--editor-fill`
  decides which scheme applies.
- **Markdown triggers**, as in lush: `-`/`*` bullet, `1.` numbered, `#`–`###`
  Title/Heading/Subheading, `>` quote, `[]`/`[ ]` to-do, `[x]` done, `[-]`
  canceled, `[/]` pending. Like lush's, they replace the line's style, so `> `
  on a to-do line makes a quote rather than a quote inside the to-do.
- **Keys**, as in lush: Cmd-Shift-T/H/J/B/M for Title/Heading/Subheading/
  Body/Code, Cmd-Shift-8/7/0/9 for bullets/numbers/to-dos/quote, Cmd-U,
  Cmd-/ strikethrough, Cmd-K link, Cmd-Ctrl-+/- super/subscript, Cmd-L
  logline, Cmd-Opt-L logline form, Cmd-Opt-T table, Tab/Shift-Tab and
  Cmd-]/Cmd-[ to indent.
- **Slash menu.** `/` at the start of a block (or after a space) still offers
  the block types and the commands.
- **Smart typography.** `--` → em dash, `...` → ellipsis, curly quotes.
- **Embeds.** Photos, sounds, videos, files and Patchwork documents are all
  `embed` blocks holding a URL, each on a line of its own; the element draws
  a file by its mime type and a document as a live `<patchwork-view>`. An
  embedded tool is **asleep** until you click into it.

## The document

The note is lush's: `content` is automerge rich text, `title` (and
`@patchwork.title`) is written from the first line on every write.

- Blocks: `paragraph` (`indent`), `heading` (`level` 1–3, `indent`),
  `code-block` (one marker **per line**, `language`), `unordered-list-item`,
  `ordered-list-item`, `todo-list-item` (`checked: true`, or
  `state: "canceled" | "pending"`), `blockquote` (first line, `indent`; the
  following lines are `paragraph` with `parents: ["blockquote"]`), and the embeds
  `embed` (`url`, `tool`), `context` (a logline), `html`, all with
  `parents: []`. Tables (`table`, `table-row`, `table-cell`,
  `table-header-cell`, cells holding blocks) and `columns`/`column` sit at
  the top level. List nesting is the item's own type repeated in `parents`.
- Marks: `strong` (not inside headings), `em`, `code`, `link` (a plain URL),
  `highlight` (by name), `underline`, `strikethrough`, `superscript`,
  `subscript`, `font` (`serif` or `hand`). Every mark expands both ways.
- Soft line breaks are U+2028 in the text.
- Anything rich doesn't model — a block attr (an embed's `alt`, a logline's
  provider extras), a mark, a whole block (a calendar event) — is kept and
  written back as it came, and attr strings are Str scalars, as lush writes
  them.
- Older rich notes (embeds inside paragraphs, JSON links, multi-line code
  blocks) still open, and are written the lush way from then on.

## Drafts

A draft is the host's copy-on-write branch of a document: open a note inside
one and the drafts module forks it, so what you type stays in the draft until
it is merged. The tool's part is to **show the fork**. It subscribes to
`draft:baseline` — answered by whichever provider is above it, and by nobody at
all on main — and gets back the fork point, either the heads the draft branched
from or the ones a pinned history entry sits at.

The note reads as it now is, with what the draft added marked in place and what
it took out struck through where it was. The diff is against the document at
those heads, so it covers edits that arrived from other peers too, not only the
ones typed here. A note the host has pinned to a point in its history opens
read-only.

The diff itself is in `src/wordgard/diff.ts`, over the same linearised "atoms"
(one per document position) the sync plugin uses to reconcile remote changes.
It works the way diff(1) does: **whole blocks first**, then inside the ones that
were paired off, **by words**. A diff free to match anything against anything
reads terribly on prose, where every paragraph begins with a capital letter and
ends in a full stop — it will happily explain that you kept the `c`, the `t` and
the `leep`. Blocks a hunk replaces are paired in order and diffed inside;
whatever is left over on one side is the run of blocks the draft added or
removed, shown whole.

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
  they are, then repaired, then as plain text. Unknown blocks are retained as
  generic selectable atoms with their type, parent, attributes and embed flag
  intact. A note never fails to open because a peer wrote something unexpected.
  `dev/fixtures/swift-embed.automerge` is a real document from the Swift app;
  `pnpm check` opens it.

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
// rich:block — a block type: appears under "Turn into" in the slash menu
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
  `src/block-menu.js`, `src/format-bar.js`, `src/images.js`, `src/lists.js` —
  the built-in plugins and the menus.
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
- `src/drafts.js` — the `draft:baseline` subscription and the decorations it
  turns into: added text marked, removed text drawn back in as a widget.
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
channel (set `CHROME_PATH` to use a particular build), keys are pressed as
`ControlOrMeta+…` so they work on Linux too, screenshots must pass `caret: "initial"`
(playwright's caret-hiding style injection makes Wordgard's DOM observer
crash), and typing needs a `delay` or the keystrokes outrun the editor.

One binding detail: `src/wordgard/traversal.ts` marks **every** mapped block
container, and treats a container's first textblock as implicit only when it is
that container's *only* child. Without it, a table row of empty cells, a list
item holding a column layout, or a blank first line in a column are lost on the
way back — the implicit child is only materialised by content that follows the
container's marker. (A cell's or a column's first line with attrs of its own,
an indent, gets a marker too.)

Block styles and indents (`src/block-style.js`) are edits to the note's spans —
the lines lush sees — read back into the editor as one change. That is how they
restyle exactly the lines lush would, and why the editor always holds what a
fresh load of the note would show. Changes from peers go in the same way: the
diff compares closes by the node they close, so its slice always fits and goes
in unfitted.

A browser detail, since it cost an afternoon: **a `<button draggable="true">`
never starts a native drag** — browsers don't drag form controls. The grip is a
`<div role="button" draggable="true">`.

Two Wordgard details worth remembering: `nodeFromDOM(element)` gives a correct
position but a node from when that element was rendered — read the live node at
that position instead. And an extension value is a plugin's identity, so
rebuilding feature extensions on every reconfigure tears down and recreates
every plugin; `src/tool.js` caches them per plugin id.

## License

AGPL-3.0-or-later. See [LICENSE](./LICENSE).
