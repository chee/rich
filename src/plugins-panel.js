// The `/plugins` panel: the editable view of `doc.plugins`. Full-tier plugins
// are checkboxes bound to that array; core-tier ones are shown as always on.
import { el } from "./dom.js"
import { pluginCatalog } from "./plugin-catalog.js"

export function openPluginsPanel({ parent, handle, onClose = () => {} }) {
  const existing = parent.querySelector(".rich-plugins-panel")
  if (existing) existing.remove()

  const enabled = id => {
    const list = handle.doc()?.plugins
    // A doc with no array is a legacy doc: everything is on.
    return Array.isArray(list) ? list.includes(id) : true
  }

  const toggle = id => {
    handle.change(doc => {
      if (!Array.isArray(doc.plugins)) doc.plugins = []
      const index = doc.plugins.indexOf(id)
      if (index >= 0) doc.plugins.splice(index, 1)
      else doc.plugins.push(id)
    })
  }

  const entries = pluginCatalog()
  const row = entry =>
    el(
      "label",
      { class: entry.tier === "core" ? "rich-plugin-row locked" : "rich-plugin-row" },
      el("input", {
        type: "checkbox",
        checked: entry.tier === "core" ? true : enabled(entry.id),
        disabled: entry.tier === "core",
        onchange: () => toggle(entry.id),
      }),
      el("span", { class: "rich-plugin-name" }, entry.name),
      el("span", { class: "rich-plugin-id" }, entry.id),
    )

  const close = () => {
    panel.remove()
    document.removeEventListener("keydown", onKey, true)
    document.removeEventListener("mousedown", onOutside, true)
    onClose()
  }

  const onKey = event => {
    if (event.key === "Escape") {
      event.preventDefault()
      close()
    }
  }

  const onOutside = event => {
    if (!panel.contains(event.target)) close()
  }

  const full = entries.filter(entry => entry.tier === "full")
  const core = entries.filter(entry => entry.tier === "core")

  const panel = el(
    "div",
    { class: "rich-plugins-panel" },
    el(
      "div",
      { class: "rich-plugins-header" },
      el("span", {}, "Plugins"),
      el("button", { class: "rich-plugins-close", type: "button", onclick: close }, "×"),
    ),
    el("div", { class: "rich-plugins-body" }, full.map(row), [
      core.length ? el("div", { class: "rich-plugins-section" }, "always on") : null,
      ...core.map(row),
    ]),
  )

  parent.append(panel)
  document.addEventListener("keydown", onKey, true)
  document.addEventListener("mousedown", onOutside, true)
  return close
}
