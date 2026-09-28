// Headless smoke test of the dev harness: run `pnpm dev:serve` first, then
// `pnpm check`. Screenshots land in dev/shots/.
import { chromium } from "playwright"
import { mkdir } from "node:fs/promises"

const url = process.env.RICH_DEV_URL ?? "http://localhost:5173/"
await mkdir(new URL("./shots/", import.meta.url), { recursive: true })

// The "chromium" channel is the new headless mode: unlike the old headless
// shell it runs native HTML5 drag and drop, which the block handles need.
const browser = await chromium.launch({ channel: "chromium", executablePath: process.env.CHROME_PATH })
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
// Click into a block's text. The block handle sits over the left edge, so aim
// well inside, and park the pointer away from the text afterwards.
async function clickInto(selector) {
  await page.locator(selector).click({ position: { x: 120, y: 6 } })
  await page.mouse.move(1000, 700)
  await page.waitForTimeout(100)
}
const blocks = () =>
  page.$$eval("wg-content > *", nodes =>
    nodes.map(node => `${node.tagName.toLowerCase()}:${node.textContent}`),
  )
const docJSON = () =>
  page.evaluate(() => JSON.stringify(window.richDev.editor.state.doc.toJSON()))

// Run a block type or command by name, the way the top bar's menus do
// (there is no slash menu).
async function run(name, on = page) {
  const ran = await on.evaluate(name => document.querySelector(".rich-tool").rich.run(name), name)
  check(`${name} is offered`, ran)
  await on.waitForTimeout(250)
}

// Later sections work on their own page: a note that has accumulated a dozen
// edits makes for brittle geometry.
async function freshPage() {
  const fresh = await browser.newPage({ viewport: { width: 1100, height: 800 } })
  fresh.on("pageerror", error => errors.push(String(error)))
  await fresh.goto(url)
  await fresh.waitForSelector("wg-content")
  await fresh.click("wg-content")
  // Typing in the same tick as the click loses the first keystroke.
  await fresh.waitForTimeout(200)
  return fresh
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

await run("Bulleted List")
await type("milk")
check(
  "bulleted list applied",
  (await blocks()).some(block => block.startsWith("ul:")),
)

// Registry-contributed command (dev/main.js registers it through the stub)
await page.keyboard.press("Enter")
await run("Signature")
check("registry command ran", (await page.textContent("wg-content")).includes("— chee"))

// Formatting is lush's Aa popover in the top bar; there is no floating bar
// and there are no block handles (dev/topbar-check.mjs covers the popover).
await page.keyboard.press("Home")
await page.keyboard.down("Shift")
await page.keyboard.press("End")
await page.keyboard.up("Shift")
await page.waitForTimeout(300)
check("no floating format bar", (await page.$$(".rich-format-bar")).length === 0)
check("no block handles", (await page.$$(".rich-gutter")).length === 0)
await page.click(".rich-aa")
await page.waitForSelector(".rich-format-popover")
await page.click(".rich-format-popover button[title='Bold']")
await page.waitForTimeout(150)
check("bold applied", (await page.$$("wg-content strong")).length > 0)
await page.keyboard.press("Escape")

// Columns
await page.keyboard.press("Backspace")
await run("2 columns")
await type("left side")
check("columns created", (await page.$$(".rich-columns .rich-column")).length === 2)
check(
  "cursor lands in the first column",
  (await docJSON()).includes(
    '"Column","content":[{"type":"Paragraph","content":[{"type":"Text","param":"left side"',
  ),
)
await shot("03-columns")

// Tables.
{
  const table = await freshPage()
  await table.keyboard.type("Notes", { delay: 40 })
  await table.keyboard.press("Enter")
  await run("Table", table)
  await table.waitForTimeout(100)
  await table.keyboard.type("cell", { delay: 40 })
  await table.waitForTimeout(200)
  check(
    "table has all its cells",
    (await table.$$("wg-content table th, wg-content table td")).length === 9,
  )
  const trip = await table.evaluate(() => window.richDev.roundTrip())
  check("tables round trip", trip.live === trip.rebuilt, trip.rebuilt.slice(0, 160))
  await table.screenshot({
    path: new URL("./shots/03b-table.png", import.meta.url).pathname,
    caret: "initial",
  })
  await table.close()
}

// Everything the editor holds must survive the automerge round trip.
const trip = await page.evaluate(() => window.richDev.roundTrip())
let diff = ""
if (trip.live !== trip.rebuilt) {
  let i = 0
  while (trip.live[i] === trip.rebuilt[i]) i++
  diff = `at ${i}\n  live:    …${trip.live.slice(Math.max(0, i - 60), i + 80)}\n  rebuilt: …${trip.rebuilt.slice(Math.max(0, i - 60), i + 80)}`
}
check("automerge round trip", trip.live === trip.rebuilt, diff)

// Pasting an image stores a file document and inserts an embed of it, on a
// line of its own — the way lush stores every photo.
await clickInto("wg-content > *:first-child")
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
    /"Embed","param":"([^"]+)"/,
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
check(
  "image renders",
  await page.evaluate(() =>
    [...document.querySelectorAll("wg-content > rich-embed")].some(embed => embed.shadowRoot?.querySelector("img")),
  ),
)
await shot("04-image")

// /plugins panel drives doc.plugins, and turning a plugin off takes effect.
await page.evaluate(() => {
  const editor = window.richDev.editor
  const first = editor.state.doc.content[0]
  editor.dispatch({ selection: { anchor: first.length - 1 } })
  editor.focus()
})
await page.keyboard.press("Enter")
await run("plugins")
await page.waitForTimeout(250)
check("plugins panel opens", await page.isVisible(".rich-plugins-panel"))
await shot("05-plugins")
const rows = await page.$$eval(".rich-plugin-id", items => items.map(item => item.textContent))
check(
  "panel lists plugins of both types",
  rows.includes("typography") && rows.includes("image"),
  rows.join(", "),
)
await page.click(".rich-plugin-row:has(.rich-plugin-id:text-is('typography')) input")
await page.waitForTimeout(400)
const pluginList = await page.evaluate(() => window.richDev.handle.doc().plugins)
check("toggle writes doc.plugins", !pluginList.includes("typography"), JSON.stringify(pluginList))
await page.keyboard.press("Escape")
await page.waitForTimeout(200)
await clickInto("wg-content > *:first-child")
await page.keyboard.press("End")
await type(" --")
await page.waitForTimeout(200)
check("disabled feature is gone", (await page.textContent("wg-content")).includes("--"))

check("no page errors", errors.length === 0, errors.slice(0, 3).join(" / "))

// Embedded documents draw their own window chrome and render image files as
// images.
const refs = await browser.newPage({ viewport: { width: 1100, height: 800 } })
await refs.bringToFront()
await refs.goto(url)
await refs.waitForSelector("wg-content")
const dropped = await refs.evaluate(async () => {
  const canvas = document.createElement("canvas")
  canvas.width = canvas.height = 16
  canvas.getContext("2d").fillRect(0, 0, 16, 16)
  const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"))
  const file = await window.repo.create2({
    "@patchwork": { type: "file" },
    content: new Uint8Array(await blob.arrayBuffer()),
    extension: "png",
    mimeType: "image/png",
    name: "square",
  })
  const note = await window.repo.create2({
    "@patchwork": { type: "rich" },
    title: "Another note",
    content: "",
  })
  const content = document.querySelector("wg-content")
  const rect = content.getBoundingClientRect()
  const data = new DataTransfer()
  data.setData(
    "text/x-patchwork-dnd",
    JSON.stringify({ source: "sideboard", items: [{ url: file.url }, { url: note.url }] }),
  )
  const point = { clientX: rect.left + 40, clientY: rect.top + 40 }
  for (const kind of ["dragover", "drop"]) {
    content.dispatchEvent(
      new DragEvent(kind, { bubbles: true, cancelable: true, dataTransfer: data, ...point }),
    )
  }
  return true
})
await refs.waitForTimeout(1200)
check("sidebar drop inserts embeds", (await refs.$$("rich-embed")).length === 2, String(dropped))
const titles = await refs.evaluate(() =>
  [...document.querySelectorAll("rich-embed")].map(
    e => e.shadowRoot?.querySelector(".rich-embed-title")?.textContent,
  ),
)
check("embeds show the document's name", titles.includes("Another note"), titles.join(", "))
check(
  "image documents render as images",
  await refs.evaluate(
    () =>
      [...document.querySelectorAll("rich-embed")].filter(e => e.shadowRoot?.querySelector("img"))
        .length === 1,
  ),
)
await refs.screenshot({
  path: new URL("./shots/07-embeds.png", import.meta.url).pathname,
  caret: "initial",
})

// The tool an embed renders with: a filterable menu, or an id typed by hand.
const pick = (selector, action = "click") =>
  refs.evaluate(
    ({ selector, action }) => {
      const root = document.querySelectorAll("rich-embed")[1].shadowRoot
      const element = root.querySelector(selector)
      if (!element) return null
      if (action === "click") element.click()
      return element.textContent
    },
    { selector, action },
  )
await pick(".rich-embed-kind")
await refs.waitForTimeout(300)
const tools = await refs.evaluate(() =>
  [...document.querySelectorAll("rich-embed")[1].shadowRoot.querySelectorAll(".rich-embed-tool")].map(
    tool => tool.dataset.tool,
  ),
)
check("embed offers the tools for its datatype", tools.includes("rich") && tools.includes(""), tools.join(", "))
await refs.evaluate(() => {
  const root = document.querySelectorAll("rich-embed")[1].shadowRoot
  const search = root.querySelector(".rich-embed-tool-search")
  search.value = "raw"
  search.dispatchEvent(new Event("input", { bubbles: true }))
})
await refs.waitForTimeout(200)
const filteredTools = await refs.evaluate(() =>
  [...document.querySelectorAll("rich-embed")[1].shadowRoot.querySelectorAll(".rich-embed-tool")].map(
    tool => tool.dataset.tool,
  ),
)
check("tool menu filters", filteredTools.join(",") === ",raw", filteredTools.join(","))
await refs.screenshot({
  path: new URL("./shots/08-tool-picker.png", import.meta.url).pathname,
  caret: "initial",
})
await refs.evaluate(() =>
  document
    .querySelectorAll("rich-embed")[1]
    .shadowRoot.querySelector('.rich-embed-tool[data-tool="raw"]')
    .click(),
)
await refs.waitForTimeout(400)
check(
  "choosing a tool sets it on the embed",
  (await refs.evaluate(() => document.querySelectorAll("rich-embed")[1]?.getAttribute("tool-id"))) ===
    "raw",
)
const embedTrip = await refs.evaluate(() => window.richDev.roundTrip())
check(
  "the tool is stored on the block",
  embedTrip.spans.includes('"tool":"raw"') && embedTrip.live === embedTrip.rebuilt,
)
await refs.evaluate(() => {
  const root = document.querySelectorAll("rich-embed")[1].shadowRoot
  root.querySelector(".rich-embed-kind").click()
  const search = root.querySelector(".rich-embed-tool-search")
  search.value = "some-other-tool"
  search.dispatchEvent(new Event("input", { bubbles: true }))
  search.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
})
await refs.waitForTimeout(400)
check(
  "an id can be typed in by hand",
  (await refs.evaluate(() => document.querySelectorAll("rich-embed")[1]?.getAttribute("tool-id"))) ===
    "some-other-tool",
)
// A real document written by the Swift richtext app: its pasted images are
// inline `embed` blocks, which used to fail schema validation on load.
const foreign = await browser.newPage({ viewport: { width: 1100, height: 800 } })
const foreignErrors = []
foreign.on("pageerror", error => foreignErrors.push(String(error)))
await foreign.bringToFront()
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

// A new note opens on its Title, and the block shortcuts (the same keys as the
// Swift app) say what each line is.
{
  const keys = await freshPage()
  const first = () => keys.$eval("wg-content > *", node => node.tagName)
  check("a new note opens on its Title", (await first()) === "H1")
  await keys.keyboard.type("a line", { delay: 30 })
  // Each from body text: a quote or a list wraps the block it is applied to,
  // so running them in a chain would nest rather than convert.
  for (const [key, tag] of [
    ["ControlOrMeta+Shift+H", "H2"],
    ["ControlOrMeta+Shift+J", "H3"],
    ["ControlOrMeta+Shift+T", "H1"],
    ["ControlOrMeta+Shift+9", "BLOCKQUOTE"],
    ["ControlOrMeta+Shift+8", "UL"],
    ["ControlOrMeta+Shift+7", "OL"],
    ["ControlOrMeta+Shift+M", "PRE"],
  ]) {
    await keys.keyboard.press("ControlOrMeta+Shift+B")
    await keys.waitForTimeout(120)
    check("ControlOrMeta+Shift+B makes a P", (await first()) === "P", await first())
    await keys.keyboard.press(key)
    await keys.waitForTimeout(150)
    check(`${key} makes a ${tag}`, (await first()) === tag, await first())
  }

  // A logline: a `context` block that renders the moment it was written.
  await keys.keyboard.press("ControlOrMeta+Shift+B")
  await keys.waitForTimeout(150)
  await keys.keyboard.press("ControlOrMeta+l")
  await keys.waitForTimeout(400)
  check("cmd-L inserts a logline", (await keys.$$("rich-logline")).length === 1)
  // Cmd-L is the address bar in a real browser, so the same command answers to
  // a key the page actually receives. (Headless has no address bar: this only
  // proves the alias is bound, not that Cmd-L arrives.)
  await keys.keyboard.press("ControlOrMeta+Shift+l")
  await keys.waitForTimeout(400)
  check("cmd-shift-L does too", (await keys.$$("rich-logline")).length === 2)
  const stamp = await keys.evaluate(
    () => document.querySelector("rich-logline").shadowRoot.querySelector(".rich-logline")?.textContent,
  )
  check("the logline says the time", /\d/.test(stamp ?? ""), stamp)
  const logged = JSON.parse(await keys.evaluate(() => window.richDev.roundTrip().spans)).find(
    span => span.value?.type === "context",
  )
  check(
    "it is stored as a context block with a timestamp",
    logged?.value?.isEmbed === true && Boolean(String(logged?.value?.attrs?.ts ?? "").length),
    JSON.stringify(logged),
  )
  const loglineTrip = await keys.evaluate(() => window.richDev.roundTrip())
  check("the logline round trips", loglineTrip.live === loglineTrip.rebuilt)
  await keys.screenshot({
    path: new URL("./shots/07-logline.png", import.meta.url).pathname,
    caret: "initial",
  })

  // An HTML block renders its source in a sandboxed frame, and the pencil
  // edits it.
  await keys.keyboard.press("ControlOrMeta+Alt+h")
  await keys.waitForTimeout(400)
  check("cmd-opt-H inserts an HTML block", (await keys.$$("rich-html")).length === 1)
  check("and opens its source, as lush does", await keys.isVisible(".rich-html-sheet textarea"))
  await keys.keyboard.press("Escape")
  await keys.waitForTimeout(150)
  check("which Escape closes", (await keys.$$(".rich-html-sheet")).length === 0)
  check(
    "it renders in a sandboxed frame",
    await keys.evaluate(() => {
      const frame = document.querySelector("rich-html").shadowRoot.querySelector("iframe")
      return frame?.getAttribute("sandbox") === "allow-scripts" && frame.srcdoc.includes("hello")
    }),
  )
  await keys.evaluate(() => document.querySelector("rich-html").shadowRoot.querySelector("button").click())
  await keys.waitForTimeout(250)
  check("the pencil opens the source", await keys.isVisible(".rich-html-sheet"))
  await keys.fill(".rich-html-sheet textarea", "<h1>hi</h1>")
  await keys.click(".rich-html-sheet button[type=submit]")
  await keys.waitForTimeout(300)
  check(
    "editing rewrites the block",
    (await keys.$eval("rich-html", node => node.getAttribute("source"))) === "<h1>hi</h1>",
  )
  const htmlSpan = JSON.parse(await keys.evaluate(() => window.richDev.roundTrip().spans)).find(
    span => span.value?.type === "html",
  )
  check(
    "it is stored as an html block",
    htmlSpan?.value?.isEmbed === true && String(htmlSpan?.value?.attrs?.html).includes("<h1>"),
    JSON.stringify(htmlSpan),
  )
  const htmlTrip = await keys.evaluate(() => window.richDev.roundTrip())
  check("the html block round trips", htmlTrip.live === htmlTrip.rebuilt)
  await keys.screenshot({
    path: new URL("./shots/08-html.png", import.meta.url).pathname,
    caret: "initial",
  })
  await keys.close()
}

// To-do lists: a third kind of list, whose items carry `checked`.
{
  const todo = await freshPage()
  await todo.keyboard.press("ControlOrMeta+Shift+B")
  await todo.keyboard.type("[] milk", { delay: 25 })
  await todo.waitForTimeout(300)
  check("`[] ` starts a to-do list", (await todo.$$("ul.rich-todo-list > li")).length === 1)
  await todo.keyboard.press("Enter")
  await todo.keyboard.type("bread", { delay: 25 })
  await todo.keyboard.press("Tab")
  await todo.waitForTimeout(250)
  check("to-do items nest", (await todo.$$("ul.rich-todo-list ul.rich-todo-list > li")).length === 1)

  const box = await todo.locator("ul.rich-todo-list > li").first().boundingBox()
  await todo.mouse.click(box.x + 8, box.y + 10)
  await todo.waitForTimeout(300)
  check(
    "clicking the box checks the item",
    (await todo.$$("ul.rich-todo-list > li[data-checked]")).length === 1,
  )
  const items = JSON.parse(await todo.evaluate(() => window.richDev.roundTrip().spans)).filter(
    span => span.value?.type === "todo-list-item",
  )
  check(
    "checked is a block attr",
    items.length === 2 && items[0].value.attrs.checked === true && !items[1].value.attrs.checked,
    JSON.stringify(items.map(item => item.value.attrs)),
  )
  const todoTrip = await todo.evaluate(() => window.richDev.roundTrip())
  check("to-do lists round trip", todoTrip.live === todoTrip.rebuilt)
  await todo.mouse.click(box.x + 8, box.y + 10)
  await todo.waitForTimeout(250)
  check(
    "clicking it again unchecks it",
    (await todo.$$("ul.rich-todo-list > li[data-checked]")).length === 0,
  )
  await todo.mouse.click(box.x + 60, box.y + 10)
  await todo.waitForTimeout(200)
  check(
    "clicking the words does not check it",
    (await todo.$$("ul.rich-todo-list > li[data-checked]")).length === 0,
  )
  await todo.mouse.click(box.x + 8, box.y + 10)
  await todo.waitForTimeout(250)

  // The four new marks, each with its own keybinding and its own bar button.
  await todo.keyboard.press("ControlOrMeta+Shift+B")
  await todo.keyboard.type("plain words", { delay: 25 })
  await todo.keyboard.down("Shift")
  for (let i = 0; i < 5; i++) await todo.keyboard.press("ArrowLeft")
  await todo.keyboard.up("Shift")
  await todo.waitForTimeout(300)
  await todo.click(".rich-aa")
  await todo.waitForSelector(".rich-format-popover")
  const barNames = await todo.$$eval(".rich-format-popover button", nodes => nodes.map(node => node.title))
  await todo.keyboard.press("Escape")
  check(
    "the Aa popover offers the new marks",
    ["Underline", "Strikethrough", "Superscript", "Subscript"].every(name =>
      barNames.includes(name),
    ),
    barNames.join(", "),
  )
  for (const [key, tag] of [
    ["ControlOrMeta+u", "u"],
    ["ControlOrMeta+/", "s"],
    ["ControlOrMeta+.", "sup"],
  ]) {
    await todo.keyboard.press(key)
    await todo.waitForTimeout(200)
    check(`${key} makes a <${tag}>`, (await todo.$$(`wg-content ${tag}`)).length === 1)
  }
  // One baseline at a time: subscript takes superscript off. (Cmd-, is the
  // browser's own, so the page gets the mark on Cmd-Shift-, instead.)
  await todo.keyboard.press("ControlOrMeta+Shift+,")
  await todo.waitForTimeout(200)
  check(
    "subscript replaces superscript",
    (await todo.$$("wg-content sub")).length === 1 && (await todo.$$("wg-content sup")).length === 0,
  )
  const marked = JSON.parse(await todo.evaluate(() => window.richDev.roundTrip().spans)).find(
    span => span.marks?.underline,
  )
  check(
    "the marks are stored by name",
    marked?.marks?.strikethrough === true &&
      marked?.marks?.subscript === true &&
      marked?.marks?.superscript === undefined,
    JSON.stringify(marked?.marks),
  )
  const markTrip = await todo.evaluate(() => window.richDev.roundTrip())
  check("the marks round trip", markTrip.live === markTrip.rebuilt)
  await todo.screenshot({
    path: new URL("./shots/09-todo.png", import.meta.url).pathname,
    caret: "initial",
  })
  await todo.close()
}

await browser.close()
console.log(problems.length ? `\n${problems.length} failing: ${problems.join(", ")}` : "\nall good")
process.exit(problems.length ? 1 : 0)
