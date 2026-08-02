// "lush" — a collaborative rich text editor for Patchwork, built on the
// Wordgard editor and the Automerge bindings in src/wordgard. The entry module
// only carries plugin metadata; the datatype and the tool are lazily
// imported so the registry stays cheap to read.

export const plugins = [
  {
    type: "patchwork:datatype",
    id: "lush",
    name: "Lush",
    icon: "FileText",
    async load() {
      return (await import("./datatype.js")).LushDatatype
    },
  },
  {
    type: "patchwork:tool",
    id: "lush",
    name: "Lush",
    icon: "FileText",
    supportedDatatypes: ["lush", "rich"],
    async load() {
      return (await import("./tool.js")).default
    },
  },
]
