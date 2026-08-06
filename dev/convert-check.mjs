// Markdown-style prefixes convert a line that already has content, and the
// org.automerge.richtext clipboard format round trips.
import { chromium } from "playwright"

const url = process.env.RICH_DEV_URL ?? "http://localhost:5173/"
const browser = await chromium.launch({ channel: "chromium" })
const context = await browser.newContext({ viewport: { width: 1100, height: 800 } })
await context.grantPermissions(["clipboard-read", "clipboard-write"])
const page = await context.newPage()
const problems = []
const errors = []
page.on("pageerror", error => errors.push(String(error)))
page.on("console", message => {
  if (message.type() === "error") errors.push(message.text())
})

function check(name, condition, detail = "") {
  console.log(`${condition ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`)
  if (!condition) problems.push(name)
}

const type = (text, delay = 30) => page.keyboard.type(text, { delay })
const moveTo = edge =>
  page.evaluate(edge => {
    const editor = window.richDev.editor
    editor.dispatch({
      selection: { anchor: editor.state.sel.head.textblockParent[edge] },
      userEvent: "select",
    })
    editor.focus()
  }, edge)
const lineStart = () => moveTo("start")
const lineEnd = () => moveTo("end")
const bodyText = () => page.keyboard.press("Meta+Shift+B")
const shape = () =>
  page.$eval("wg-content", node => {
    const walk = element =>
      [...element.children]
        .map(child => {
          const tag = child.tagName.toLowerCase()
          const inner = walk(child)
          const text = child.firstChild?.nodeType === 3 ? child.firstChild.data : ""
          return inner ? `${tag}[${text}${inner}]` : `${tag}[${child.textContent}]`
        })
        .join("")
    return walk(node)
  })

await page.goto(url)
await page.waitForSelector("wg-content")
await page.click("wg-content")
await page.waitForTimeout(300)

await bodyText()
await type("alpha")
await lineStart()
await type("- ")
await page.waitForTimeout(100)
check("dash converts a non-empty line to a bullet", (await shape()) === "ul[li[p[alpha]]]", await shape())

await page.keyboard.press("Meta+z")
await page.waitForTimeout(100)
check("undo puts the typed dash back", (await shape()) === "p[- alpha]", await shape())
await page.keyboard.press("Meta+Shift+z")
await page.waitForTimeout(100)
check("redo converts again", (await shape()) === "ul[li[p[alpha]]]", await shape())

await lineEnd()
await page.keyboard.press("Enter")
await bodyText()
await type("beta")
await lineStart()
await type("## ")
await page.waitForTimeout(100)
check("hashes convert a non-empty line to a heading", (await shape()).endsWith("h2[beta]"), await shape())

await lineEnd()
await page.keyboard.press("Enter")
await bodyText()
await type("gamma")
await lineStart()
await type("> ")
await page.waitForTimeout(100)
check("gt converts a non-empty line to a quote", (await shape()).endsWith("blockquote[p[gamma]]"), await shape())

await lineEnd()
await page.keyboard.press("Enter")
await bodyText()
await type("delta")
await lineStart()
await type("1. ")
await page.waitForTimeout(100)
check("number converts a non-empty line to an ordered list", (await shape()).endsWith("ol[li[p[delta]]]"), await shape())

await lineEnd()
await page.keyboard.press("Enter")
await bodyText()
await type("epsilon")
await lineStart()
await type("[] ")
await page.waitForTimeout(100)
check(
  "brackets convert a non-empty line to a todo",
  /ul\[li\[p\[epsilon\]\]\]$/.test(await shape()),
  await shape(),
)

const trip = await page.evaluate(() => window.richDev.roundTrip())
check("converted doc round trips", trip.live === trip.rebuilt)

// Spans clipboard: a synthetic copy fills a DataTransfer, a synthetic paste
// reads one back.
const copied = await page.evaluate(() => {
  const editor = window.richDev.editor
  editor.dispatch({ selection: { anchor: 0, head: editor.state.doc.length } })
  const dt = new DataTransfer()
  editor.contentDOM.dispatchEvent(
    new ClipboardEvent("copy", { clipboardData: dt, bubbles: true, cancelable: true }),
  )
  return {
    spans: dt.getData("org.automerge.richtext"),
    html: dt.getData("text/html"),
    text: dt.getData("text/plain"),
  }
})
check("copy writes org.automerge.richtext", copied.spans.length > 0, copied.spans.slice(0, 120))
check("copy still writes text/html", copied.html.length > 0)
check("copy still writes text/plain", copied.text.length > 0)
let parsed = []
try {
  parsed = JSON.parse(copied.spans)
} catch {}
check(
  "spans JSON is the automerge shape with plain strings",
  parsed.some(s => s.type === "block" && typeof s.value?.type === "string") &&
    parsed.some(s => s.type === "text" && typeof s.value === "string") &&
    parsed.some(s => s.value?.type === "unordered-list-item"),
  JSON.stringify(parsed.slice(0, 3)),
)

const before = await shape()
await page.evaluate(json => {
  const editor = window.richDev.editor
  editor.dispatch({ selection: { anchor: 0, head: editor.state.doc.length } })
  const dt = new DataTransfer()
  dt.setData("org.automerge.richtext", json)
  dt.setData("text/plain", "should not be used")
  editor.contentDOM.dispatchEvent(
    new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }),
  )
}, copied.spans)
await page.waitForTimeout(150)
const afterPaste = await shape()
check("pasting spans over the selection rebuilds the blocks", afterPaste === before, afterPaste)
const trip2 = await page.evaluate(() => window.richDev.roundTrip())
check("pasted doc round trips", trip2.live === trip2.rebuilt)

// A selection that starts and ends mid-block still copies as spans: leading
// content cut from its block rides as bare text, trailing open blocks close.
const partial = await page.evaluate(() => {
  const editor = window.richDev.editor
  editor.dispatch({ selection: { anchor: 4, head: editor.state.doc.length - 3 } })
  const dt = new DataTransfer()
  editor.contentDOM.dispatchEvent(
    new ClipboardEvent("copy", { clipboardData: dt, bubbles: true, cancelable: true }),
  )
  return dt.getData("org.automerge.richtext")
})
let partialSpans = []
try {
  partialSpans = JSON.parse(partial)
} catch {}
check(
  "partial selection copies as spans",
  partialSpans.some(s => s.type === "text") && partialSpans.some(s => s.type === "block"),
  partial.slice(0, 160),
)
await page.evaluate(json => {
  const editor = window.richDev.editor
  editor.dispatch({ selection: { anchor: 0, head: editor.state.doc.length } })
  const dt = new DataTransfer()
  dt.setData("org.automerge.richtext", json)
  editor.contentDOM.dispatchEvent(
    new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }),
  )
}, partial)
await page.waitForTimeout(150)
check("partial spans paste cleanly", (await shape()).length > 0, await shape())
const trip3 = await page.evaluate(() => window.richDev.roundTrip())
check("partial paste round trips", trip3.live === trip3.rebuilt)

// A Swift-style payload with an unknown block still pastes (repair path).
await page.evaluate(() => {
  const editor = window.richDev.editor
  editor.dispatch({ selection: { anchor: 0, head: editor.state.doc.length } })
  const dt = new DataTransfer()
  dt.setData(
    "org.automerge.richtext",
    JSON.stringify([
      { type: "block", value: { type: "paragraph", parents: [], attrs: {}, isEmbed: false } },
      { type: "text", value: "from swift", marks: { strong: true } },
      { type: "block", value: { type: "mystery-block", parents: [], attrs: {}, isEmbed: false } },
      { type: "text", value: "survives" },
    ]),
  )
  editor.contentDOM.dispatchEvent(
    new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }),
  )
})
await page.waitForTimeout(150)
const swifty = await shape()
check(
  "unknown blocks are repaired to paragraphs",
  swifty.includes("from swift") && swifty.includes("survives"),
  swifty,
)

// Spans JSON off the wire has plain-string parents and embed blocks; nesting
// and loglines must survive the paste (chee's "loglines don't paste" bug).
await page.evaluate(() => {
  const editor = window.richDev.editor
  editor.dispatch({ selection: { anchor: 0, head: editor.state.doc.length } })
  const dt = new DataTransfer()
  dt.setData(
    "org.automerge.richtext",
    JSON.stringify([
      { type: "block", value: { type: "paragraph", parents: [], attrs: {}, isEmbed: false } },
      {
        type: "block",
        value: {
          type: "context",
          parents: ["paragraph"],
          attrs: { ts: "2026-08-04T16:45:29Z", location: "London, England", weather: "27°C Overcast" },
          isEmbed: true,
        },
      },
      { type: "block", value: { type: "unordered-list-item", parents: [], attrs: {}, isEmbed: false } },
      { type: "text", value: "outer" },
      {
        type: "block",
        value: { type: "unordered-list-item", parents: ["unordered-list-item"], attrs: {}, isEmbed: false },
      },
      { type: "text", value: "nested" },
    ]),
  )
  editor.contentDOM.dispatchEvent(
    new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }),
  )
})
await page.waitForTimeout(150)
const wire = await shape()
check("logline blocks paste", wire.includes("rich-logline"), wire)
check(
  "plain-string parents keep list nesting",
  wire.includes("ul[li[p[outer]ul[li[p[nested]]]]]"),
  wire,
)
const wireTrip = await page.evaluate(() => window.richDev.roundTrip())
check("logline paste round trips", wireTrip.live === wireTrip.rebuilt)

// Real copy: the async rewrite should land the web custom format on the
// clipboard; a real paste then finds the spans through clipboard.read().
const WEB_FORMAT = "web application/vnd.inkandswitch.automerge.richtext"
const supported = await page.evaluate(
  format => ClipboardItem.supports?.(format) ?? false,
  WEB_FORMAT,
)
check("ClipboardItem.supports the web format", supported)
if (supported) {
  await page.evaluate(() => {
    const editor = window.richDev.editor
    editor.dispatch({ selection: { anchor: 0, head: editor.state.doc.length }, userEvent: "select" })
    editor.focus()
  })
  await page.keyboard.press("Meta+c")
  await page.waitForTimeout(2500)
  const onClipboard = await page.evaluate(async format => {
    try {
      for (const item of await navigator.clipboard.read()) {
        if (item.types.includes(format)) return (await (await item.getType(format)).text()).slice(0, 80)
      }
      return "absent"
    } catch (e) {
      return "read failed: " + String(e)
    }
  }, WEB_FORMAT)
  check(
    "copy republishes spans as the web custom format",
    onClipboard.startsWith("[{"),
    onClipboard,
  )
  const beforeRealPaste = await shape()
  await page.evaluate(() => {
    const editor = window.richDev.editor
    editor.dispatch({ selection: { anchor: editor.state.doc.length }, userEvent: "select" })
    editor.focus()
  })
  await page.keyboard.press("Meta+v")
  await page.waitForTimeout(600)
  check(
    "real paste reads the web format back",
    (await shape()) === beforeRealPaste + beforeRealPaste,
    await shape(),
  )
}

check("no page errors", errors.length === 0, errors.slice(0, 3).join(" / "))
await browser.close()
console.log(problems.length ? `\n${problems.length} failing: ${problems.join(", ")}` : "\nall good")
process.exit(problems.length ? 1 : 0)
