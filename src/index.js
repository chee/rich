// "rich" — a collaborative rich text editor for Patchwork, built on the
// Wordgard editor and the Automerge bindings in src/wordgard. The entry module
// only carries plugin metadata; the datatype and the tool are lazily
// imported so the registry stays cheap to read.

export const plugins = [
  {
    type: "patchwork:datatype",
    id: "rich",
    name: "Rich Text",
    icon: "FileText",
    async load() {
      return (await import("./datatype.js")).RichDatatype
    },
  },
  {
    type: "patchwork:tool",
    id: "rich",
    name: "Rich Text",
    icon: "FileText",
    supportedDatatypes: ["rich"],
    async load() {
      return (await import("./tool.js")).default
    },
  },
]
