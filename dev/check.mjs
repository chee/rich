// Headless smoke test of the dev harness: run `pnpm dev:serve` first, then
// `pnpm check`. Screenshots land in dev/shots/.
import { chromium } from "playwright"
import { mkdir } from "node:fs/promises"

const url = process.env.RICH_DEV_URL ?? "http://localhost:5173/"
await mkdir(new URL("./shots/", import.meta.url), { recursive: true })

// The "chromium" channel is the new headless mode: unlike the old headless
// shell it runs native HTML5 drag and drop, which the block handles need.
const browser = await chromium.launch({ channel: "chromium" })
const page = await browser.newPage({ viewport: { width: 1100, height: 800 } })
const problems = []
const errors = []
page.on("pageerror", error => errors.push(String(error)))
page.on("console", message => {
  if (message.type() === "error") errors.push(message.text())
})

const shot = name =>
  page.screenshot({
    path: new URL(`./shots/${name}.png`, import.meta.url).pathname,
    // playwright's default caret-hiding injects a style, which wordgard's DOM
    // observer reads as a content mutation and crashes on.
    caret: "initial",
  })

function check(name, condition, detail = "") {
  console.log(`${condition ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`)
  if (!condition) problems.push(name)
}

const type = (text, delay = 40) => page.keyboard.type(text, { delay })
const blocks = () =>
  page.$$eval("wg-content > *", nodes =>
    nodes.map(node => `${node.tagName.toLowerCase()}:${node.textContent}`),
  )
const docJSON = () =>
  page.evaluate(() => JSON.stringify(window.richDev.editor.state.doc.toJSON()))

// Run a slash command by name.
async function slash(query, expected) {
  await type(`/${query}`)
  await page.waitForSelector(".rich-slash-item", { timeout: 2000 })
  const names = await page.$$eval(".rich-slash-name", items => items.map(item => item.textContent))
  if (expected) {
    check(`slash /${query} lists ${expected}`, names.includes(expected), names.join(", "))
  }
  await page.keyboard.press("Enter")
  await page.waitForTimeout(250)
}

await page.goto(url)
await page.waitForSelector("wg-content")

check("no toolbar", (await page.$$(".wg-menubar")).length === 0)
check("placeholder", await page.isVisible("wg-placeholder"))
check(
  "doc seeds plugins array",
  await page.evaluate(() => Array.isArray(window.richDev.handle.doc().plugins)),
  await page.evaluate(() => JSON.stringify(window.richDev.handle.doc().plugins)),
)

await page.click("wg-content")
await type("Shopping list")
await page.keyboard.press("Enter")

// Slash menu
await type("/")
await page.waitForSelector(".rich-slash-item", { timeout: 2000 })
const itemCount = await page.$$eval(".rich-slash-item", items => items.length)
check("slash menu opens", itemCount > 8, `${itemCount} items`)
await shot("01-slash-menu")

await type("bul")
const filtered = await page.$$eval(".rich-slash-name", items => items.map(item => item.textContent))
check("slash filters", filtered.length === 1 && filtered[0] === "Bulleted list", filtered.join(", "))
await page.keyboard.press("Enter")
await type("milk")
check(
  "slash applied",
  (await blocks()).some(block => block.startsWith("ul:")),
)

// Registry-contributed command (dev/main.js registers it through the stub)
await page.keyboard.press("Enter")
await slash("sig", "Signature")
check("registry command ran", (await page.textContent("wg-content")).includes("— chee"))

// Escape dismisses
await page.keyboard.press("Enter")
await type("/")
await page.waitForSelector(".rich-slash-item")
await page.keyboard.press("Escape")
await page.waitForTimeout(100)
check("escape closes menu", (await page.$$(".rich-slash-item")).length === 0)
await page.keyboard.press("Backspace")

// Format bar
await page.keyboard.press("Home")
await page.keyboard.down("Shift")
await page.keyboard.press("End")
await page.keyboard.up("Shift")
await page.waitForTimeout(300)
check("format bar shows on selection", await page.isVisible(".rich-format-bar.visible"))
await page.click(".rich-format-button[title='Bold']")
await page.waitForTimeout(150)
check("bold applied", (await page.$$("wg-content strong")).length > 0)

// Block gutter: hovering the text, then moving out to the gutter, keeps it up
await page.locator("wg-content > *").first().hover()
await page.waitForTimeout(150)
check("gutter appears on hover", await page.isVisible(".rich-gutter.visible"))
const gutterBox = await page.locator(".rich-gutter").boundingBox()
await page.mouse.move(gutterBox.x + gutterBox.width / 2, gutterBox.y + gutterBox.height / 2)
await page.waitForTimeout(200)
check("gutter stays reachable", await page.isVisible(".rich-gutter.visible"))
await shot("02-gutter")

// A real drag of the grip, with the mouse.
async function dragBlockTo(targetSelector, atBottom = false) {
  const grip = await page.locator(".rich-gutter-grip").boundingBox()
  const target = await page.locator(targetSelector).boundingBox()
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2)
  await page.mouse.down()
  await page.mouse.move(
    target.x + target.width / 2,
    atBottom ? target.y + target.height - 2 : target.y + 2,
    { steps: 12 },
  )
  await page.waitForTimeout(150)
  const indicator = await page.isVisible(".rich-drop-indicator.visible")
  await page.mouse.up()
  await page.waitForTimeout(300)
  return indicator
}

const beforeDrag = await blocks()
const sawIndicator = await dragBlockTo("wg-content > *:last-child", true)
const afterDrag = await blocks()
check("drop indicator follows the drag", sawIndicator)
check("drag reorders blocks", beforeDrag[0] !== afterDrag[0], `${beforeDrag[0]} -> ${afterDrag[0]}`)

// "+" inserts a block and opens the menu
await page.locator("wg-content > *").first().hover()
await page.waitForTimeout(150)
await page.locator(".rich-gutter-button").first().click()
await page.waitForTimeout(250)
check("plus opens slash menu", (await page.$$(".rich-slash-item")).length > 0)
await page.keyboard.press("Escape")

// Columns
await page.keyboard.press("Backspace")
await slash("col", "2 columns")
await type("left side")
check("columns created", (await page.$$(".rich-columns .rich-column")).length === 2)
check(
  "cursor lands in the first column",
  (await docJSON()).includes(
    '"Column","content":[{"type":"Paragraph","content":[{"type":"Text","param":"left side"',
  ),
)
await shot("03-columns")

// Blocks inside a column get their own handle, and can be dragged between
// columns.
await page.locator(".rich-column > *").first().hover()
await page.waitForTimeout(200)
check("gutter works inside a column", await page.isVisible(".rich-gutter.visible"))
await dragBlockTo(".rich-column:last-child", true)
const moved = await docJSON()
check(
  "block drags between columns",
  moved.lastIndexOf('"param":"left side"') > moved.indexOf('"type":"Column"'),
  moved.slice(moved.indexOf('"Columns"'), moved.indexOf('"Columns"') + 220),
)

// Everything the editor holds must survive the automerge round trip.
const trip = await page.evaluate(() => window.richDev.roundTrip())
let diff = ""
if (trip.live !== trip.rebuilt) {
  let i = 0
  while (trip.live[i] === trip.rebuilt[i]) i++
  diff = `at ${i}\n  live:    …${trip.live.slice(Math.max(0, i - 60), i + 80)}\n  rebuilt: …${trip.rebuilt.slice(Math.max(0, i - 60), i + 80)}`
}
check("automerge round trip", trip.live === trip.rebuilt, diff)

// Pasting an image stores a file document and inserts an image block.
await page.locator("wg-content > *").first().click()
await page.keyboard.press("End")
await page.evaluate(async () => {
  const canvas = document.createElement("canvas")
  canvas.width = canvas.height = 8
  const context = canvas.getContext("2d")
  context.fillStyle = "hotpink"
  context.fillRect(0, 0, 8, 8)
  const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"))
  const data = new DataTransfer()
  data.items.add(new File([blob], "pink.png", { type: "image/png" }))
  document
    .querySelector("wg-content")
    .dispatchEvent(
      new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: data }),
    )
})
await page.waitForTimeout(700)
const imageSrc = await page.evaluate(() => {
  const found = JSON.stringify(window.richDev.editor.state.doc.toJSON()).match(
    /"RichImage","param":"([^"]+)"/,
  )
  return found ? found[1] : null
})
check("pasted image is stored as a file doc", Boolean(imageSrc?.startsWith("automerge:")), String(imageSrc))
if (imageSrc) {
  const fileDoc = await page.evaluate(async src => {
    const handle = await window.repo.find(src)
    const doc = handle.doc()
    return { mimeType: doc.mimeType, type: doc["@patchwork"]?.type, bytes: doc.content?.length }
  }, imageSrc)
  check(
    "file doc is a UnixFileEntry",
    fileDoc.type === "file" && fileDoc.mimeType === "image/png" && fileDoc.bytes > 0,
    JSON.stringify(fileDoc),
  )
}
check("image renders", (await page.$$("wg-content img")).length > 0)
await shot("04-image")

// /plugins panel drives doc.plugins, and turning a plugin off takes effect.
await slash("plugins")
await page.waitForTimeout(250)
check("plugins panel opens", await page.isVisible(".rich-plugins-panel"))
await shot("05-plugins")
const rows = await page.$$eval(".rich-plugin-id", items => items.map(item => item.textContent))
check(
  "panel lists plugins of both types",
  rows.includes("format-bar") && rows.includes("image"),
  rows.join(", "),
)
await page.click(".rich-plugin-row:has(.rich-plugin-id:text-is('format-bar')) input")
await page.waitForTimeout(400)
const pluginList = await page.evaluate(() => window.richDev.handle.doc().plugins)
check("toggle writes doc.plugins", !pluginList.includes("format-bar"), JSON.stringify(pluginList))
await page.keyboard.press("Escape")
await page.waitForTimeout(200)
await page.locator("wg-content > *").first().click()
await page.keyboard.down("Shift")
await page.keyboard.press("End")
await page.keyboard.up("Shift")
await page.waitForTimeout(300)
check("disabled feature is gone", (await page.$$(".rich-format-bar")).length === 0)

check("no page errors", errors.length === 0, errors.slice(0, 3).join(" / "))

// A real document written by the Swift richtext app: its pasted images are
// inline `embed` blocks, which used to fail schema validation on load.
const foreign = await browser.newPage({ viewport: { width: 1100, height: 800 } })
const foreignErrors = []
foreign.on("pageerror", error => foreignErrors.push(String(error)))
await foreign.goto(`${url}?fixture=swift-embed`)
await foreign.waitForSelector("wg-content", { timeout: 8000 })
await foreign.waitForTimeout(500)
check("foreign document loads", (await foreign.$$("wg-content > *")).length > 5)
check("foreign inline embed renders", (await foreign.$$("patchwork-view")).length === 1)
const foreignTrip = await foreign.evaluate(() => window.richDev.roundTrip())
check("foreign document round trips", foreignTrip.live === foreignTrip.rebuilt)
check("foreign document loads clean", foreignErrors.length === 0, foreignErrors.slice(0, 2).join(" / "))
await foreign.screenshot({
  path: new URL("./shots/06-foreign.png", import.meta.url).pathname,
  caret: "initial",
})

await browser.close()
console.log(problems.length ? `\n${problems.length} failing: ${problems.join(", ")}` : "\nall good")
process.exit(problems.length ? 1 : 0)
