// The catalog: the one place that knows every plugin type this tool tiers
// over, so the `/plugins` panel and the document's `plugins` array can talk
// about ids without caring which type they belong to.
//
// The document is the truth: `doc.plugins` lists the enabled full-tier ids.
// Core-tier plugins are always on. A doc with no array at all is a legacy doc
// and gets everything.
import { mergePlugins } from "./registry.js"
import { featurePlugins } from "./features.js"
import { slashCommands } from "./slash.js"
import { blockTypes } from "./block-types.js"

// Lazy, because features and slash commands import each other: reading them at
// module-eval time would depend on load order.
export const pluginTypes = () => [
  { type: "rich:feature", builtins: featurePlugins },
  { type: "rich:block", builtins: blockTypes },
  { type: "rich:slash", builtins: slashCommands },
]

function allPlugins() {
  return pluginTypes().flatMap(({ type, builtins }) => mergePlugins(type, builtins))
}

// Full-tier ids from the built-ins only: deterministic, no registry, so a new
// document's `plugins` array is reproducible.
export const builtinFullIds = () =>
  pluginTypes().flatMap(({ builtins }) =>
    builtins.filter(plugin => plugin.tier === "full").map(plugin => plugin.id),
  )

// One entry per known plugin id, for the panel.
export function pluginCatalog() {
  const entries = []
  const seen = new Set()
  for (const { type, builtins } of pluginTypes()) {
    for (const plugin of mergePlugins(type, builtins)) {
      if (!plugin?.id || seen.has(plugin.id)) continue
      seen.add(plugin.id)
      entries.push({
        id: plugin.id,
        type: plugin.type || type,
        name: plugin.name || plugin.id,
        tier: plugin.tier === "core" ? "core" : "full",
      })
    }
  }
  return entries
}

export function docSelector(doc) {
  return Array.isArray(doc?.plugins) ? doc.plugins : "all"
}

// A selector expanded to the concrete id set, core always included. This is
// what the tool hands to the plugin resolvers.
export function expandSelector(selector) {
  const ids = new Set(
    allPlugins()
      .filter(plugin => plugin.tier === "core")
      .map(plugin => plugin.id),
  )
  if (selector === "all") {
    for (const plugin of allPlugins()) if (plugin.tier !== "core") ids.add(plugin.id)
  } else if (Array.isArray(selector)) {
    for (const id of selector) ids.add(id)
  }
  return [...ids]
}
