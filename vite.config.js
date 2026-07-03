import { defineConfig } from "vite"
import cssInjectedByJsPlugin from "vite-plugin-css-injected-by-js"
import external from "@inkandswitch/patchwork-bootloader/externals"

export default defineConfig({
  base: "./",
  plugins: [cssInjectedByJsPlugin()],
  resolve: {
    // The (symlinked) @automerge/wordgard lib and the tool must share ONE
    // copy of wordgard, or node/mark type identity breaks between the
    // adapter's schema and the editor's schema.
    dedupe: ["wordgard"],
  },
  build: {
    emptyOutDir: true,
    minify: false,
    sourcemap: true,
    rollupOptions: {
      // Wordgard's dist annotates its namespace-populating IIFEs with
      // /* @__PURE__ */, but those IIFEs have side effects (they attach
      // properties like `link.button`). Honouring the annotation drops
      // them and leaves bundles returning `[schemaElement, undefined, …]`,
      // which crashes GardState's `flatten`. Ignore the annotations.
      treeshake: { annotations: false, moduleSideEffects: true },
      // @automerge/automerge, the patchwork packages, codemirror and solid
      // are provided by the host importmap. Everything else (wordgard,
      // @automerge/wordgard, style-mod, crelt, …) is bundled.
      external,
      input: "./src/index.js",
      output: {
        format: "es",
        entryFileNames: "[name].js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name][extname]",
      },
      preserveEntrySignatures: "strict",
    },
  },
})
