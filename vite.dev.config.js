// Dev harness: serves dev/index.html with an in-memory repo and a stub plugin
// registry, so the editor can be exercised outside a Patchwork host.
import { defineConfig } from "vite"
import wasm from "vite-plugin-wasm"
import topLevelAwait from "vite-plugin-top-level-await"

export default defineConfig({
  root: "dev",
  plugins: [wasm(), topLevelAwait()],
  resolve: {
    dedupe: ["wordgard", "@automerge/automerge", "@automerge/automerge-repo"],
    alias: {
      "@inkandswitch/patchwork-plugins": new URL("./dev/plugins-stub.js", import.meta.url)
        .pathname,
      "@inkandswitch/patchwork-filesystem": new URL(
        "./dev/filesystem-stub.js",
        import.meta.url,
      ).pathname,
      "@inkandswitch/patchwork-elements": new URL("./dev/elements-stub.js", import.meta.url)
        .pathname,
    },
  },
  optimizeDeps: {
    exclude: ["@automerge/automerge"],
    include: ["@automerge/automerge-repo", "eventemitter3"],
  },
})
