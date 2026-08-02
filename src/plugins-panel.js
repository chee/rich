// The `/plugins` panel: the editable view of `doc.plugins`. Full-tier plugins
// are checkboxes bound to that array; core-tier ones are shown as always on.
import { el } from "./dom.js"
import { pluginCatalog } from "./plugin-catalog.js"

export function openPluginsPanel({ parent, handle, onClose = () => {} }) {
  const existing = parent.querySelector(".lush-plugins-panel")
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
      { class: entry.tier === "core" ? "lush-plugin-row locked" : "lush-plugin-row" },
      el("input", {
        type: "checkbox",
        checked: entry.tier === "core" ? true : enabled(entry.id),
        disabled: entry.tier === "core",
        onchange: () => toggle(entry.id),
      }),
      el("span", { class: "lush-plugin-name" }, entry.name),
      el("span", { class: "lush-plugin-id" }, entry.id),
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
    { class: "lush-plugins-panel" },
    el(
      "div",
      { class: "lush-plugins-header" },
      el("span", {}, "Plugins"),
      el("button", { class: "lush-plugins-close", type: "button", onclick: close }, "×"),
    ),
    el("div", { class: "lush-plugins-body" }, full.map(row), [
      core.length ? el("div", { class: "lush-plugins-section" }, "always on") : null,
      ...core.map(row),
    ]),
  )

  parent.append(panel)
  document.addEventListener("keydown", onKey, true)
  document.addEventListener("mousedown", onOutside, true)
  return close
}
