// Lush's faces, shipped with the editor: Jost for the text, Merriweather for
// the serif mark, Fantasque Sans Mono for code and Caroni for the hand mark
// (all under the SIL Open Font License; see fonts/README.md).
//
// They are registered through the FontFace API rather than @font-face in
// rich.css, because that stylesheet is injected into the host page, where a
// relative url() would be read against the page rather than this module. A
// face registered this way still loads only once some text asks for it, so
// the large Merriweather files cost nothing until a note uses the serif.
const FACES = [
  ["Rich Jost", new URL("./fonts/jost.woff2", import.meta.url), { weight: "100 900" }],
  ["Rich Merriweather", new URL("./fonts/merriweather.woff2", import.meta.url), { weight: "300 900", stretch: "87% 112%" }],
  ["Rich Merriweather", new URL("./fonts/merriweather-italic.woff2", import.meta.url), { weight: "300 900", stretch: "87% 112%", style: "italic" }],
  ["Rich Fantasque", new URL("./fonts/fantasque-regular.woff2", import.meta.url), { weight: "400" }],
  ["Rich Fantasque", new URL("./fonts/fantasque-bold.woff2", import.meta.url), { weight: "700" }],
  ["Rich Fantasque", new URL("./fonts/fantasque-italic.woff2", import.meta.url), { weight: "400", style: "italic" }],
  ["Rich Fantasque", new URL("./fonts/fantasque-bolditalic.woff2", import.meta.url), { weight: "700", style: "italic" }],
  ["Rich Caroni", new URL("./fonts/caroni.woff2", import.meta.url), { weight: "400" }],
]

let registered = false

export function registerFonts() {
  if (registered || typeof FontFace === "undefined" || !globalThis.document?.fonts) return
  registered = true
  for (const [family, url, descriptors] of FACES) {
    try {
      document.fonts.add(new FontFace(family, `url("${url.href}") format("woff2")`, { display: "swap", ...descriptors }))
    } catch (error) {
      console.warn(`rich: could not register ${family}`, error)
    }
  }
}
