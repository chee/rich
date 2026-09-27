// Lush's look: its fonts, sizes and spacing, the to-do boxes, the quote and
// code cards, pink links, and a dark scheme of rich's own (as well as a host's
// dark theme). Screenshots go to dev/shots/look-*.png. Run `pnpm dev:serve`
// first.
import { chromium } from "playwright"

const url = process.env.RICH_DEV_URL ?? "http://localhost:5173/"
const browser = await chromium.launch({ channel: "chromium", executablePath: process.env.CHROME_PATH })
const problems = []
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`)
  if (!ok) problems.push(name)
}
const shot = (page, name) => page.screenshot({ path: new URL(`./shots/${name}.png`, import.meta.url).pathname })
const block = (type, parents = [], attrs = {}) => ({ type: "block", value: { type, parents, attrs, isEmbed: false } })
const text = (value, marks) => (marks ? { type: "text", value, marks } : { type: "text", value })

const NOTE = [
  block("heading", [], { level: 1 }), text("Title here"),
  block("paragraph"), text("Body with "), text("bold", { strong: true }), text(" and "), text("link", { link: "https://x.y" }),
  text(" and "), text("pink", { highlight: "pink" }), text(" "), text("code", { code: true }), text(" x"), text("2", { superscript: true }),
  block("heading", [], { level: 2 }), text("Heading"),
  block("heading", [], { level: 3 }), text("Subheading"),
  block("unordered-list-item"), text("bullet"),
  block("unordered-list-item", ["unordered-list-item"]), text("nested"),
  block("unordered-list-item", ["unordered-list-item", "unordered-list-item"]), text("deeper"),
  block("ordered-list-item"), text("one"),
  block("ordered-list-item", ["ordered-list-item"]), text("one a"),
  block("todo-list-item"), text("open"),
  block("todo-list-item", [], { checked: true }), text("done"),
  block("todo-list-item", [], { state: "canceled" }), text("canceled"),
  block("todo-list-item", [], { state: "pending" }), text("pending"),
  block("blockquote"), text("quote line one"), block("paragraph", ["blockquote"]), text("quote line two"),
  block("code-block", [], { language: "javascript" }), text("let x = 1"),
  block("code-block", [], { language: "javascript" }), text("let y = 2"),
  block("paragraph"), text("serif text", { font: "serif" }), text(" and "), text("hand text", { font: "hand" }),
]

async function open(scheme, host) {
  const page = await browser.newPage({ viewport: { width: 1000, height: 900 }, colorScheme: scheme })
  await page.goto(url)
  await page.waitForSelector("wg-content")
  if (host) {
    // A host's own theme: only its fill and ink, as Patchwork and the site
    // editor set them.
    await page.evaluate(host => {
      document.documentElement.style.setProperty("--editor-fill", host.fill)
      document.documentElement.style.setProperty("--editor-line", host.line)
    }, host)
  }
  await page.evaluate(spans => window.richDev.mount(spans), NOTE)
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(400)
  return page
}

const style = (page, selector, pseudo = null) =>
  page.$eval(
    selector,
    (node, pseudo) => {
      const s = getComputedStyle(node, pseudo)
      return {
        family: s.fontFamily,
        size: s.fontSize,
        lineHeight: s.lineHeight,
        weight: s.fontWeight,
        color: s.color,
        background: s.backgroundColor,
        backgroundImage: s.backgroundImage,
        marginTop: s.marginTop,
        marginBottom: s.marginBottom,
        width: s.width,
        border: s.borderTopColor,
        borderWidth: s.borderTopWidth,
        radius: s.borderTopLeftRadius,
        mask: s.maskImage || s.webkitMaskImage,
        textDecoration: s.textDecorationLine,
        opacity: s.opacity,
      }
    },
    pseudo,
  )
const liWith = word => `wg-content li:has(> p:text-is("${word}"))`

// Light.
let page = await open("light")
await shot(page, "look-light")
const fonts = await page.evaluate(() =>
  ["Rich Jost", "Rich Fantasque", "Rich Merriweather", "Rich Caroni"].map(family => document.fonts.check(`16px "${family}"`) && [...document.fonts].some(face => face.family.replace(/"/g, "") === family && face.status === "loaded")),
)
check("lush's four faces are loaded", fonts.every(Boolean), JSON.stringify(fonts))
const body = await style(page, "wg-content")
check("body is Jost at 16px, Jost's own line height", body.family.startsWith('"Rich Jost"') && body.size === "16px" && body.lineHeight === "23.12px", JSON.stringify(body))
const h2 = await style(page, "wg-content h2")
check("headings: 10px before, 6px after", h2.marginTop === "10px" && h2.marginBottom === "6px", JSON.stringify(h2))
check("Title 1.6×, Heading 1.3×, Subheading 1.15×", (await style(page, "wg-content h1")).size === "25.6px" && h2.size === "20.8px" && (await style(page, "wg-content h3")).size === "18.4px")
const done = await style(page, `${liWith("done")} > p`)
const open_ = await style(page, `${liWith("open")} > p`)
check("a done to-do's text is not dimmed", done.color === open_.color && done.textDecoration === "none" && done.opacity === "1", JSON.stringify(done))
const doneBox = await style(page, liWith("done"), "::before")
check("done is a pink box", doneBox.background === "rgb(255, 105, 165)", JSON.stringify(doneBox))
check("with a tick", (await style(page, liWith("done"), "::after")).mask.includes("svg"))
const canceled = await style(page, liWith("canceled"), "::after")
check("canceled is a filled box with an X", (await style(page, liWith("canceled"), "::before")).background !== "rgba(0, 0, 0, 0)" && canceled.mask.includes("2625") && canceled.mask.includes("7375"), canceled.mask.slice(0, 60))
check("pending has a pink slash", (await style(page, liWith("pending"), "::after")).background === "rgb(255, 105, 165)")
const quote = await style(page, "wg-content blockquote")
const bar = await style(page, "wg-content blockquote", "::before")
check("a quote is lush's cream card", quote.background === "rgba(255, 240, 214, 0.36)" && quote.radius === "6px", JSON.stringify(quote))
check("with a 3.5px pink bar", bar.width === "3.5px" && bar.background === "rgba(255, 77, 151, 0.9)", JSON.stringify(bar))
const code = await style(page, "wg-content pre")
check("a code block is lush's card", code.background === "rgb(249, 252, 255)" && code.border === "rgb(227, 246, 255)" && code.radius === "8px" && code.family.startsWith('"Rich Fantasque"'), JSON.stringify(code))
check("links are pink", (await style(page, "wg-content a")).color === "rgb(255, 105, 165)")
const serif = await style(page, ".rich-font-serif")
check("serif is Merriweather at 0.94, light", serif.family.startsWith('"Rich Merriweather"') && serif.size === "15.04px" && serif.weight === "300", JSON.stringify(serif))
check("hand is Caroni at 1.15", (await style(page, ".rich-font-hand")).family.startsWith('"Rich Caroni"') && (await style(page, ".rich-font-hand")).size === "18.4px")
const lightFill = await style(page, ".rich-tool")
await page.close()

// Dark, with no host theme: rich's own.
page = await open("dark")
await shot(page, "look-dark")
const dark = await style(page, ".rich-tool")
check("the system's dark scheme darkens the page", dark.background !== lightFill.background && dark.background.startsWith("rgb(30"), `${lightFill.background} → ${dark.background}`)
const darkQuote = await style(page, "wg-content blockquote")
check("the dark quote card", darkQuote.background === "rgba(255, 255, 255, 0.035)" && darkQuote.color === dark.color, JSON.stringify(darkQuote))
check("the dark code card", (await style(page, "wg-content pre")).background === "rgb(26, 27, 30)")
check("links stay pink", (await style(page, "wg-content a")).color === "rgb(255, 105, 165)")
await page.close()

// A host's dark theme with a light system: its fill decides.
page = await open("light", { fill: "#1c1c1e", line: "#f2f2f7" })
await shot(page, "look-host-dark")
const hosted = await style(page, ".rich-tool")
const hostQuote = await style(page, "wg-content blockquote")
check("a host's dark fill is honoured", hosted.background === "rgb(28, 28, 30)" && hosted.color === "rgb(242, 242, 247)", JSON.stringify(hosted))
check("and the quote on it is readable", hostQuote.background === "rgba(255, 255, 255, 0.035)" && hostQuote.color === "rgb(242, 242, 247)", JSON.stringify(hostQuote))
check("so are the highlights", (await style(page, ".rich-highlight-pink")).color === "rgb(255, 176, 210)")
await page.close()

await browser.close()
if (problems.length) {
  console.log(`\n${problems.length} failing: ${problems.join(", ")}`)
  process.exit(1)
}
console.log("\nall ok")
