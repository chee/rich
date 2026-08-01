// Stand-in for the host's plugin registry while developing outside Patchwork.
const registries = new Map()

export function getRegistry(type) {
  if (!registries.has(type)) {
    const plugins = new Map()
    const listeners = new Set()
    registries.set(type, {
      get: id => plugins.get(id),
      all: () => [...plugins.values()],
      filter: fn => [...plugins.values()].filter(fn),
      register(plugin) {
        plugins.set(plugin.id, plugin)
        for (const listener of listeners) listener()
      },
      async load(id) {
        const plugin = plugins.get(id)
        if (!plugin) return undefined
        if (!plugin.module && plugin.load) plugin.module = await plugin.load()
        return plugin
      },
      on(event, callback) {
        listeners.add(callback)
        return () => listeners.delete(callback)
      },
    })
  }
  return registries.get(type)
}

export function getAllRegistries() {
  return registries
}
