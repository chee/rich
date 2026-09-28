// Typing and restyling at full speed, the way hands do it: what the editor
// shows and what automerge holds must agree after every burst. Run
// `pnpm dev:serve` first.
import { chromium } from "playwright"

const url = process.env.RICH_DEV_URL ?? "http://localhost:5173/"
const browser = await chromium.launch({ channel: "chromium", executablePath: process.env.CHROME_PATH })
const problems = []
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`)
  if (!ok) problems.push(name)
}
const block = (type, parents = [], attrs = {}) => ({ type: "block", value: { type, parents, attrs, isEmbed: false } })
const text = (value, marks) => (marks ? { type: "text", value, marks } : { type: "text", value })

// The note as a line of block types and text, and whether a fresh editor on
// the same doc shows what this one does.
const state = page =>
  page.evaluate(() => {
    const round = window.richDev.roundTrip()
    const spans = window.richDev
      .spans()
      .map(span =>
        span.type === "text"
          ? span.value
          : `|${span.value.type}${span.value.parents.length ? `<${span.value.parents.join(",")}` : ""}${Object.keys(span.value.attrs).length ? JSON.stringify(span.value.attrs) : ""}`,
      )
      .join("")
    return { spans, agree: round.live === round.rebuilt }
  })

// Select all, delete, and type a title and a first line straight away: the
// first letter must not end up in a paragraph of its own, and no empty line
// may be left behind.
let wrong = []
for (let run = 0; run < 12; run++) {
  const page = await browser.newPage({ viewport: { width: 1000, height: 700 } })
  await page.goto(url)
  await page.waitForSelector("wg-content")
  await page.click("wg-content")
  await page.keyboard.press("Control+a")
  await page.keyboard.press("Backspace")
  await page.keyboard.type("My title")
  await page.keyboard.press("Enter")
  await page.keyboard.type("First")
  await page.waitForTimeout(250)
  const { spans, agree } = await state(page)
  if (spans !== "|paragraphMy title|paragraphFirst" || !agree) wrong.push(`${spans}${agree ? "" : " (editor differs)"}`)
  await page.close()
}
check("select all, delete, type at speed: 12 of 12 right", wrong.length === 0, wrong.join(" / "))

const page = await browser.newPage({ viewport: { width: 1000, height: 700 } })
const errors = []
page.on("pageerror", e => errors.push(String(e)))
await page.goto(url)
await page.waitForSelector("wg-content")
const mount = spans => page.evaluate(spans => window.richDev.mount(spans), spans).then(() => page.waitForTimeout(150))
const caretAtEnd = async word => {
  const box = await page.locator(`wg-content >> text=${word}`).first().boundingBox()
  await page.mouse.click(box.x + box.width - 1, box.y + box.height / 2)
  await page.keyboard.press("End")
}

// Mod-Shift-0 is To-do from any block. Wordgard's own paragraph binding has
// Ctrl-Shift-0, which is the same key wherever Mod is Ctrl.
for (const [name, start] of [
  ["a code block", block("code-block")],
  ["a heading", block("heading", [], { level: 1 })],
  ["a paragraph", block("paragraph")],
]) {
  await mount([start, text("thing")])
  await caretAtEnd("thing")
  await page.keyboard.press("Control+Shift+0")
  await page.waitForTimeout(100)
  const { spans } = await state(page)
  check(`Ctrl-Shift-0 makes ${name} a to-do`, spans === "|todo-list-itemthing", spans)
}

// Markdown triggers replace the line's style, as lush's do, even on a line of
// a list or a quote: `> ` after a to-do makes a quote, not a quote in it.
for (const [typed, expected] of [
  ["> ", "|todo-list-itemtask|blockquoteq"],
  ["- ", "|todo-list-itemtask|unordered-list-itemq"],
  ["1. ", "|todo-list-itemtask|ordered-list-itemq"],
  ["## ", '|todo-list-itemtask|heading{"level":2}q'],
  ["[x] ", '|todo-list-itemtask|todo-list-item{"checked":true}q'],
]) {
  await mount([block("todo-list-item"), text("task")])
  await caretAtEnd("task")
  await page.keyboard.press("Enter")
  await page.keyboard.type(`${typed}q`)
  await page.waitForTimeout(150)
  const { spans, agree } = await state(page)
  check(`${JSON.stringify(typed)} on a to-do line replaces its style`, spans === expected && agree, spans)
}
await mount([block("blockquote"), text("said")])
await caretAtEnd("said")
await page.keyboard.press("Enter")
await page.keyboard.type("- q")
await page.waitForTimeout(150)
check('"- " on a quote line makes a bullet, out of the quote', (await state(page)).spans === "|blockquotesaid|unordered-list-itemq", (await state(page)).spans)
await mount([block("paragraph"), text("plain")])
await caretAtEnd("plain")
await page.keyboard.press("Enter")
await page.keyboard.type("> q")
await page.waitForTimeout(150)
check('"> " on a plain line still makes a quote', (await state(page)).spans === "|paragraphplain|blockquoteq", (await state(page)).spans)

// Marks a block doesn't keep are gone from the editor too, and don't come
// back when the block turns back into Body.
const restyle = async (word, style) => {
  await caretAtEnd(word)
  if (!(await page.$(".rich-format-popover"))) await page.click(".rich-aa")
  await page.click(`.rich-format-popover .rich-style-${style}`)
  await page.waitForTimeout(120)
}
await mount([block("paragraph"), text("x"), block("paragraph"), text("cc", { code: true }), text(" plain"), block("paragraph"), text("bb", { strong: true })])
await restyle("plain", "code")
let now = await state(page)
check("inline code goes when its line becomes a code block", now.agree && now.spans.includes("|code-blockcc plain"), now.spans)
await restyle("plain", "code")
now = await state(page)
const codeMarks = await page.evaluate(() => window.richDev.spans().find(span => span.type === "text" && span.value.includes("cc"))?.marks ?? {})
check("and stays gone back in Body", now.agree && !codeMarks.code, JSON.stringify(codeMarks))
await restyle("bb", "h1")
now = await state(page)
check("bold goes when its line becomes a Title", now.agree, now.spans)
await restyle("bb", "h1")
const boldMarks = await page.evaluate(() => window.richDev.spans().find(span => span.type === "text" && span.value === "bb")?.marks ?? {})
check("and stays gone back in Body", (await state(page)).agree && !boldMarks.strong, JSON.stringify(boldMarks))

// On a long note a keystroke writes a splice and the title, not a pass over
// every line: well under what reading the whole note back costs.
{
  const long = [block("heading", [], { level: 1 }), text("Long note")]
  for (let i = 0; i < 3000; i++) long.push(block("paragraph"), text(`Paragraph number ${i} with some text in it to make it longer.`))
  await mount(long)
  await page.waitForTimeout(300)
  const whole = await page.evaluate(() => {
    const { handle, editor, am } = window.richDev
    window.writes = []
    const change = handle.change.bind(handle)
    handle.change = (fn, options) => {
      const start = performance.now()
      const result = change(fn, options)
      window.writes.push(performance.now() - start)
      return result
    }
    let at = null
    editor.state.doc.iterate(0, editor.state.doc.contentLength, (node, pos) => {
      if (at == null && node.isText && node.param.includes("number 1500 ")) at = pos + node.param.length
    })
    editor.dispatch({ selection: { anchor: at } })
    editor.focus()
    const start = performance.now()
    am.spans(handle.doc(), ["content"])
    return performance.now() - start
  })
  for (const kind of ["plain", "bold"]) {
    if (kind === "bold") await page.keyboard.press("ControlOrMeta+b")
    await page.evaluate(() => (window.writes = []))
    await page.keyboard.type("abcdefghij", { delay: 60 })
    await page.waitForTimeout(300)
    const writes = (await page.evaluate(() => window.writes)).sort((a, b) => a - b)
    const median = writes[Math.floor(writes.length / 2)] ?? Infinity
    check(`${kind} typing on a 3000-line note writes fast`, median < Math.max(40, whole / 3), `median ${median.toFixed(1)}ms a keystroke, reading the note back ${whole.toFixed(1)}ms`)
  }
  const { title, agree } = await page.evaluate(() => ({ title: String(window.richDev.handle.doc().title), agree: (r => r.live === r.rebuilt)(window.richDev.roundTrip()) }))
  check("and keeps the title and the note", title === "Long note" && agree, title)
  await page.evaluate(() => {
    const { editor } = window.richDev
    editor.dispatch({ selection: { anchor: 1 + "Long note".length }, scrollIntoView: true })
    editor.focus()
  })
  await page.keyboard.type("!", { delay: 30 })
  await page.waitForTimeout(200)
  check("typing on the first line still retitles it", (await page.evaluate(() => String(window.richDev.handle.doc().title))) === "Long note!")
}

check("no page errors", errors.length === 0, errors.slice(0, 3).join(" / "))
await browser.close()
if (problems.length) {
  console.log(`\n${problems.length} failing: ${problems.join(", ")}`)
  process.exit(1)
}
console.log("\nall ok")
