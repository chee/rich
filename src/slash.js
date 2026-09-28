// The `rich:slash` commands: things a note can insert or do (a picture, a
// logline, a table, …). The top bar's menus and the keyboard shortcuts run
// them, and a host's registry can add more. (There is no slash menu: lush
// has none.)
import { Dialog } from "wordgard/editor"
import { insertLogline } from "./logline.js"
import { insertHtmlBlock } from "./html-block.js"

// Both of these run only when a command does, so they arrive as their own
// chunks.
const images = () => import("./images.js")
const pluginsPanel = () => import("./plugins-panel.js")

// `key` is a wordgard key name, or a list of them when the first is one the
// browser keeps for itself; keys.js binds them. Strings, so the whole
// descriptor is still postMessage-able.
const command = (id, name, group, icon, keywords, run, key) => ({
  type: "rich:slash",
  id,
  name,
  group,
  icon,
  keywords,
  tier: "core",
  run,
  key,
})

export const slashCommands = [
  command(
    "image",
    "Image",
    "Media",
    "image",
    ["picture", "photo", "upload", "file"],
    async wg => (await images()).uploadImage(wg),
    ["Mod-Shift-a", "Mod-Alt-a"],
  ),
  command(
    "image-url",
    "Image from URL",
    "Media",
    "link",
    ["picture", "web", "link"],
    insertImageFromUrl,
  ),
  command(
    "logline",
    "Logline",
    "Note",
    "clock",
    ["time", "date", "stamp", "context", "where", "when"],
    insertLogline,
    ["Mod-l", "Mod-Shift-l"],
  ),
  command(
    "html",
    "HTML",
    "Media",
    "code",
    ["markup", "web", "iframe", "embed"],
    insertHtmlBlock,
    "Mod-Alt-h",
  ),
  command(
    "columns",
    "2 columns",
    "Layout",
    "columns",
    ["side", "split", "row"],
    wg => insertColumns(wg, 2),
    "Mod-Alt-2",
  ),
  command("columns-3", "3 columns", "Layout", "columns3", ["side", "split", "row"], wg =>
    insertColumns(wg, 3),
  ),
  command(
    "table",
    "Table",
    "Layout",
    "table",
    ["grid", "rows", "cells"],
    wg => insertTable(wg, 3, 3),
    "Mod-Alt-t",
  ),
  {
    type: "rich:slash",
    id: "plugins",
    name: "Plugins",
    group: "Note",
    icon: "plugins",
    keywords: ["extensions", "features", "settings"],
    tier: "core",
    run: (wg, context) =>
      pluginsPanel().then(panel =>
        panel.openPluginsPanel({ parent: context.element, handle: context.handle }),
      ),
  },
]

const insertColumns = (wg, count) => import("./topbar.js").then(bar => bar.insertColumns(wg, count))
const insertTable = (wg, rows, columns) => import("./topbar.js").then(bar => bar.insertTable(wg, rows, columns))

function insertImageFromUrl(wg) {
  const { result } = Dialog.show(wg, {
    class: "rich-dialog",
    label: "Image URL",
    input: { name: "src", type: "url", placeholder: "https://…" },
    submitLabel: "Insert",
  })
  result.then(async form => {
    const src = form?.elements?.src?.value?.trim()
    if (src) (await images()).insertImageUrl(wg, src)
  })
}
