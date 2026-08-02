// Stand-in for @inkandswitch/patchwork-elements outside Patchwork: navigation
// is logged, and <patchwork-view> renders a placeholder so embeds are visible.
export function openDocument(element, url, toolId) {
  console.log("openDocument", url, toolId ?? "")
  element.dispatchEvent(new CustomEvent("dev:open-document", { detail: { url, toolId }, bubbles: true }))
}

if (!customElements.get("patchwork-view")) {
  customElements.define(
    "patchwork-view",
    class extends HTMLElement {
      connectedCallback() {
        this.textContent = `patchwork-view ${this.getAttribute("doc-url") ?? ""}`
        this.style.cssText =
          "display:grid;place-items:center;font:12px/1.4 monospace;color:#888;background:#f4f4f4;min-height:80px;padding:8px;overflow:hidden"
      }
    },
  )
}
