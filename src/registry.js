// The extension seam. `rich` reads its own features and slash commands out of
// the host plugin registry, merged with its built-ins, so another bundle can
// contribute to this editor without the tool knowing about it. Same shape as
// the chat tool's registry helpers.
//
// Registry entries are serializable DESCRIPTIONS: metadata only, behaviour
// behind `async load()` (function-valued fields can't be structured-cloned to
// the worker that reads the registry). Built-ins carry their behaviour inline.
import { getRegistry } from "@inkandswitch/patchwork-plugins"

export function getPlugin(type, id) {
  try {
    return getRegistry(type)?.get?.(id)
  } catch {
    return undefined
  }
}

export async function loadPlugin(type, id) {
  try {
    const registry = getRegistry(type)
    if (!registry?.load) return null
    return (await registry.load(id)) ?? null
  } catch {
    return null
  }
}

export function onRegistryChange(type, callback) {
  try {
    const registry = getRegistry(type)
    if (!registry?.on) return () => {}
    const off = registry.on("changed", callback)
    return typeof off === "function" ? off : () => registry.off?.("changed", callback)
  } catch {
    return () => {}
  }
}

export function listPlugins(type) {
  try {
    const registry = getRegistry(type)
    if (!registry) return []
    if (typeof registry.filter === "function") return registry.filter(() => true)
    return Array.isArray(registry) ? registry : []
  } catch {
    return []
  }
}

// Built-ins win on id conflict: a registry description of the same id would
// shadow the inline behaviour with a not-yet-loaded stub.
export function mergePlugins(type, builtins) {
  const byId = new Map()
  for (const plugin of listPlugins(type)) if (plugin?.id) byId.set(plugin.id, plugin)
  for (const plugin of builtins) if (plugin?.id) byId.set(plugin.id, plugin)
  return [...byId.values()]
}

// "all" → everything, "core" → tier:"core" only, string[] → an explicit set of
// ids (matched across every plugin type).
export function selectPlugins(plugins, selector) {
  if (selector === "all") return plugins
  if (selector === "core") return plugins.filter(p => p.tier === "core")
  if (Array.isArray(selector)) return plugins.filter(p => selector.includes(p.id))
  return []
}

export function resolvePlugins(type, builtins, selector) {
  return selectPlugins(mergePlugins(type, builtins), selector)
}

// A live list of active plugins with their behaviour flattened to the top
// level — inline for built-ins, out of `.module` for registry contributions.
// Consumers read `.get()` synchronously; it refills as loads resolve, whenever
// the registry changes, and whenever `refresh()` is called (the selector may be
// a function, so the caller can change what's active).
export function loadedPlugins(type, builtins, selector, onChange = () => {}) {
  const selected = () => (typeof selector === "function" ? selector() : selector)
  let current = resolvePlugins(type, builtins, selected())
  const cache = new Map()
  let generation = 0

  async function refresh() {
    const active = resolvePlugins(type, builtins, selected())
    const mine = ++generation
    const loaded = await Promise.all(
      active.map(async plugin => {
        if (cache.has(plugin.id)) return cache.get(plugin.id)
        let merged = plugin
        if (plugin.module) merged = { ...plugin, ...plugin.module }
        else if (typeof plugin.load === "function") {
          const result = await loadPlugin(type, plugin.id)
          if (result?.module) merged = { ...result, ...result.module }
        }
        cache.set(plugin.id, merged)
        return merged
      }),
    )
    if (mine !== generation) return
    current = loaded
    onChange(current)
  }

  const off = onRegistryChange(type, () => {
    cache.clear()
    refresh()
  })
  refresh()

  return { get: () => current, refresh, dispose: off }
}
